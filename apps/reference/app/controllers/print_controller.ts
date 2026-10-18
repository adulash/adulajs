import { readFile } from 'node:fs/promises'
import { relative, resolve, isAbsolute } from 'node:path'
import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import {
  AdulaError,
  htmlToPdf,
  imageDataUri,
  renderPrintHtml,
  type ResourceDescription,
} from 'adula'
import { adula, requestActor } from '#services/adula'
import { identity } from '#services/initial_setup'
import { positiveId } from '#controllers/admin/support'

/**
 * Printable record view. HTML by default (browser print to PDF); `?format=pdf`
 * converts through Gotenberg when GOTENBERG_URL is configured.
 */
export default class PrintController {
  async handle(ctx: HttpContext) {
    const actor = await requestActor(ctx)
    const runtime = adula()
    let name: string
    try {
      name = runtime.registry.get(ctx.params.resource).name
    } catch {
      throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
    }
    const id = positiveId(ctx.params.id)
    const shown = await runtime.resources.show(name, id, actor)
    const resource = runtime.resources.describe(name, actor)
    const childData = await runtime.resources.children(name, id, actor)
    const children: Record<
      string,
      { rows: (typeof shown.data)[]; fields: ResourceDescription['fields'] }
    > = {}
    for (const [key, group] of Object.entries(childData)) {
      const field = resource.fields.find((entry) => entry.key === key)
      if (!field || field.type !== 'hasMany') continue
      const child = runtime.resources.describe(field.resource, actor)
      children[key] = {
        rows: group.rows,
        fields: child.fields.filter((entry) => child.list.includes(entry.key)),
      }
    }
    const brand = await identity()
    const user = ctx.auth.getUserOrFail()
    const html = renderPrintHtml({
      identity: {
        name: brand.company,
        logoUrl: await printableLogo(brand.logo),
      },
      resource,
      record: shown.data,
      related: shown.related,
      lookups: await runtime.resources.lookups(name, actor),
      children,
      printedBy: user.fullName ?? user.email,
    })
    ctx.response.header('Cache-Control', 'no-store')
    if (ctx.request.input('format') !== 'pdf')
      return ctx.response.header('Content-Type', 'text/html; charset=utf-8').send(html)
    const gotenberg = env.get('GOTENBERG_URL')
    if (!gotenberg)
      throw new AdulaError(
        501,
        'E_PDF_UNAVAILABLE',
        'تحويل PDF غير مفعّل؛ استخدم الطباعة من المتصفح'
      )
    const pdf = await htmlToPdf(html, { gotenbergUrl: gotenberg })
    return ctx.response
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${name}-${id}.pdf"`)
      .send(pdf)
  }
}

/**
 * Inlines the project logo from public/ as a data URI. Remote or unknown logos are
 * left out so the PDF renderer never fetches a URL from inside the deployment.
 */
async function printableLogo(logo: string | null) {
  if (!logo || /^[a-z][a-z0-9+.-]*:/i.test(logo) || logo.startsWith('//')) return null
  const root = app.publicPath()
  const file = resolve(root, `.${new URL(logo, 'http://logo.invalid').pathname}`)
  const inside = relative(root, file)
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null
  try {
    return imageDataUri(await readFile(file), file)
  } catch {
    return null
  }
}
