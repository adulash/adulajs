import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import { createResourceController } from 'adula'
import type { Actor, ResourceDescription } from 'adula'
import { adula, requestActor } from '#services/adula'
import { testFixturesEnabled } from '#start/test_fixtures'
import { localizeResource, requestLanguage } from '#services/languages'
const fixtureRenderers = testFixturesEnabled ? await import('#tests/fixtures/presentation') : null

type Mode = 'index' | 'form' | 'show'
const modes: Mode[] = ['index', 'form', 'show']

/**
 * Presence of `inertia/pages/<resource>/<mode>.tsx` replaces the generated page.
 * Scanned once at boot: sources in development, the Vite manifest in production builds.
 */
function discoverPageOverrides() {
  const found = new Set<string>()
  const roots = [app.makePath('inertia/pages')]
  if (testFixturesEnabled) roots.push(app.makePath('tests/fixtures/frontend/pages'))
  for (const pages of roots) {
    if (!existsSync(pages)) continue
    for (const entry of readdirSync(pages, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      for (const mode of modes)
        if (existsSync(join(pages, entry.name, `${mode}.tsx`))) found.add(`${entry.name}/${mode}`)
    }
  }
  if (roots.some((path) => existsSync(path))) return found
  const manifest = app.publicPath('assets/.vite/manifest.json')
  if (!existsSync(manifest)) return found
  for (const key of Object.keys(JSON.parse(readFileSync(manifest, 'utf8')))) {
    const match = /^inertia\/pages\/([^/]+)\/(index|form|show)\.tsx$/.exec(key)
    if (match) found.add(`${match[1]}/${match[2]}`)
  }
  return found
}
const overrides = discoverPageOverrides()
export function pageFor(resource: string, mode: Mode) {
  return overrides.has(`${resource}/${mode}`) ? `${resource}/${mode}` : 'resources/page'
}
/** Override pages receive the generic payload; the cast only widens the page name resolved at boot. */
const generic = (page: string) => page as 'resources/page'

async function actorOf(ctx: HttpContext) {
  return requestActor(ctx)
}

export function childDescriptions(description: ResourceDescription, actor: Actor, language = 'ar') {
  const children: Record<string, ResourceDescription> = {}
  for (const field of description.fields) {
    if (field.type !== 'hasMany') continue
    try {
      children[field.key] = localizeResource(
        adula().resources.describe(field.resource, actor),
        language
      )
    } catch {
      // A child the actor cannot view is omitted; the deferred rows are authorized separately.
    }
  }
  return children
}

export default createResourceController(
  async (ctx) => {
    const runtime = adula()
    return { ...runtime, actor: await requestActor(ctx) }
  },
  async (ctx, resource, result) => {
    const runtime = adula()
    const actor = await actorOf(ctx)
    const page = pageFor(resource.name, 'index')
    const custom = await fixtureRenderers?.index(ctx, page, runtime, actor, result)
    if (custom !== undefined) return custom
    return ctx.inertia.render(generic(page), {
      view: async () => ({
        mode: 'index' as const,
        resource: localizeResource(
          runtime.resources.describe(resource.name, actor),
          requestLanguage(ctx)
        ),
        lookups: await runtime.resources.lookups(resource.name, actor),
        savedViews: await runtime.savedViews.list(resource.name, actor),
      }),
      result: ctx.inertia
        .scroll(result, (value) => ({
          pageName: 'cursor',
          currentPage: (ctx.request.input('cursor') as string | undefined) ?? null,
          nextPage: value.meta.nextCursor,
          previousPage: null,
        }))
        .matchOn('id'),
    })
  },
  async (ctx, resource, editor) => {
    const page = pageFor(resource.name, 'form')
    const custom = await fixtureRenderers?.form(ctx, page, editor)
    if (custom !== undefined) return custom
    const actor = await actorOf(ctx)
    const shown = editor.record
      ? await adula().resources.show(resource.name, Number(editor.record.id), actor)
      : null
    const permissions = shown ? shown.permissions : {}
    return ctx.inertia.render(generic(page), {
      view: { mode: 'form', editor: localizeResource(editor, requestLanguage(ctx)), permissions },
    })
  },
  async (ctx, resource, result) => {
    const runtime = adula()
    const actor = await actorOf(ctx)
    const id = Number(result.data.id)
    const language = requestLanguage(ctx)
    const description = localizeResource(runtime.resources.describe(resource.name, actor), language)
    let pending: ReturnType<typeof runtime.resources.details> | undefined
    const details = () => (pending ??= runtime.resources.details(resource.name, id, actor))
    return ctx.inertia.render(generic(pageFor(resource.name, 'show')), {
      view: async () => ({
        mode: 'show' as const,
        resource: description,
        result,
        lookups: await runtime.resources.lookups(resource.name, actor),
        childResources: childDescriptions(description, actor, language),
      }),
      // One deferred request and one record read serve both sections (#31).
      childrenData: ctx.inertia.defer(() => details().then((loaded) => loaded.children), 'details'),
      activity: ctx.inertia.defer(() => details().then((loaded) => loaded.activity), 'details'),
    })
  }
)
