import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError } from 'adula'
import { adula, requestActor } from '#services/adula'
import { wantsJson } from '#controllers/admin/support'

const flag = (value: unknown) => value === true || value === 'true' || value === '1'

function resourceName(ctx: HttpContext) {
  try {
    return adula().registry.get(ctx.params.resource).name
  } catch {
    throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
  }
}

/**
 * Import batches owned by the signed-in user (session) or the token owner (/api/v1).
 * The UI uploads a multipart `file`; API clients send JSON { fileName, content }.
 */
export default class ImportsController {
  async index(ctx: HttpContext) {
    const batches = await adula().imports.list(await requestActor(ctx))
    if (wantsJson(ctx)) return { data: batches }
    return ctx.inertia.render('work/imports', { batches })
  }

  async store(ctx: HttpContext) {
    const actor = await requestActor(ctx)
    const name = resourceName(ctx)
    const options = {
      mode: ctx.request.input('mode') || undefined,
      matchField: ctx.request.input('matchField') || undefined,
      dryRun: flag(ctx.request.input('dryRun')),
    }
    // Authorize before reading the upload.
    adula().imports.targets(name, actor, options.mode === 'upsert' ? 'upsert' : 'create')
    const json = ctx.request.input('content')
    if (typeof json === 'string' && !ctx.request.file('file')) {
      const batch = await adula().imports.create(name, actor, {
        ...options,
        fileName: ctx.request.input('fileName'),
        content: json,
        format: ctx.request.input('format'),
        encoding: ctx.request.input('encoding'),
      })
      return ctx.response.created({ data: batch })
    }
    const extnames = adula().imports.extensions()
    const file = ctx.request.file('file', { size: '5mb', extnames })
    if (!file || !file.isValid || !file.tmpPath)
      throw new AdulaError(422, 'E_IMPORT_FILE', file?.errors[0]?.message ?? 'اختر ملفاً للاستيراد')
    const bytes = await readFile(file.tmpPath)
    // Text formats (CSV) are read as UTF-8; binary adapters such as XLSX receive the bytes.
    const binary = adula()
      .imports.adapters()
      .some((adapter) => adapter.binary && adapter.extensions.includes(file.extname ?? ''))
    const batch = await adula().imports.create(name, actor, {
      ...options,
      fileName: file.clientName,
      mimeType: file.type && file.subtype ? `${file.type}/${file.subtype}` : undefined,
      content: binary ? bytes : bytes.toString('utf8'),
    })
    return ctx.response.created({ data: batch })
  }

  /** A CSV header template (UTF-8 with BOM) of the fields the actor may import. */
  async template(ctx: HttpContext) {
    const name = resourceName(ctx)
    const mode = ctx.request.input('mode') === 'upsert' ? 'upsert' : 'create'
    const template = adula().imports.template(name, await requestActor(ctx), mode)
    return ctx.response
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${template.fileName}"`)
      .header('Cache-Control', 'no-store')
      .send(template.content)
  }

  async show(ctx: HttpContext) {
    return { data: await adula().imports.show(ctx.params.id, await requestActor(ctx)) }
  }

  async start(ctx: HttpContext) {
    const dryRun = ctx.request.input('dryRun')
    return {
      data: await adula().imports.start(
        ctx.params.id,
        await requestActor(ctx),
        ctx.request.input('mapping'),
        {
          mode: ctx.request.input('mode') || undefined,
          matchField: ctx.request.input('matchField') || undefined,
          dryRun: dryRun === undefined || dryRun === null ? undefined : flag(dryRun),
        }
      ),
    }
  }
}
