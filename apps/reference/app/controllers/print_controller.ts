import { readFile } from 'node:fs/promises'
import { relative, resolve, isAbsolute } from 'node:path'
import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import adulaConfig from '#config/adula'
import { AdulaError, PrintTemplates, htmlToPdf, imageDataUri } from 'adula'
import { adula, requestActor } from '#services/adula'
import { identity } from '#services/initial_setup'
import { knex, positiveId } from '#controllers/admin/support'

/** The resource name of a route parameter, or 404 when it is not registered. */
export function printableResource(name: unknown) {
  try {
    return adula().registry.get(String(name)).name
  } catch {
    throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
  }
}

/** The company name and inlined logo printed on every document. */
export async function printIdentity() {
  const brand = await identity()
  return { name: brand.company, logoUrl: await printableLogo(brand.logo) }
}

/**
 * Printable record view. HTML by default (browser print to PDF); `?format=pdf`
 * converts through Gotenberg when GOTENBERG_URL is configured. `?template=<key>` picks
 * a code or administrator print template (ADR 048); without it the generic layout prints.
 * Every print is recorded in the record's activity (`printed`, template, version, format).
 */
export default class PrintController {
  async handle(ctx: HttpContext) {
    const actor = await requestActor(ctx)
    const runtime = adula()
    const name = printableResource(ctx.params.resource)
    const id = positiveId(ctx.params.id)
    const format = ctx.request.input('format') === 'pdf' ? 'pdf' : 'html'
    const gotenberg = env.get('GOTENBERG_URL')
    if (format === 'pdf' && !gotenberg)
      throw new AdulaError(
        501,
        'E_PDF_UNAVAILABLE',
        'تحويل PDF غير مفعّل؛ استخدم الطباعة من المتصفح'
      )
    const template = ctx.request.input('template')
    const user = ctx.auth.getUserOrFail()
    const templates = new PrintTemplates(knex(), runtime.registry)
    const printed = await templates.print(runtime.resources, name, id, actor, {
      template: typeof template === 'string' && template ? template : undefined,
      identity: await printIdentity(),
      printedBy: user.fullName ?? user.email,
      timeZone: adulaConfig.timeZone,
    })
    ctx.response.header('Cache-Control', 'no-store')
    if (format !== 'pdf') {
      await templates.recordPrinted(name, id, actor, printed.template, 'html')
      return ctx.response.header('Content-Type', 'text/html; charset=utf-8').send(printed.html)
    }
    // Audited only once the conversion succeeded: a failed PDF printed nothing.
    const pdf = await htmlToPdf(printed.html, { gotenbergUrl: gotenberg! })
    await templates.recordPrinted(name, id, actor, printed.template, 'pdf')
    return ctx.response
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${name}-${id}.pdf"`)
      .send(pdf)
  }

  /** Templates the actor may print this resource with, and whether PDF is configured. */
  async templates(ctx: HttpContext) {
    const actor = await requestActor(ctx)
    const runtime = adula()
    const name = printableResource(ctx.params.resource)
    const templates = await new PrintTemplates(knex(), runtime.registry).available(
      runtime.resources,
      name,
      actor
    )
    return { data: { templates, pdf: Boolean(env.get('GOTENBERG_URL')) } }
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
