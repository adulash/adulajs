import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import attachmentManager from '@jrmc/adonis-attachment/services/main'
import drive from '@adonisjs/drive/services/main'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { adula, requestActor } from '#services/adula'
import {
  AdulaError,
  PENDING_UPLOAD_LIMIT,
  attachmentPolicy,
  attachmentUrl,
  buildAbility,
  findAttachment,
  pendingUploadCount,
  redeemUploadGrant,
  registerUpload,
} from 'adula'
import type { Actor, AttachmentRecord } from 'adula'

const notFound = () => new AdulaError(404, 'E_NOT_FOUND', 'المرفق غير موجود')

/** RFC 5987: an ASCII fallback plus the UTF-8 name so Arabic titles survive every browser. */
function contentDisposition(name: string) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file'
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export default class AttachmentsController {
  async store(ctx: HttpContext) {
    const { request, response } = ctx
    const runtime = adula()
    const actor = await requestActor(ctx)
    const knex = db.connection().getWriteClient()
    // A grant issued by module code for one record replaces the resource-wide role rule.
    const grantToken = request.input('grant')
    const grant =
      grantToken === undefined || grantToken === null || grantToken === ''
        ? null
        : await redeemUploadGrant(knex, runtime.registry, grantToken, actor.id)
    if (grantToken && !grant)
      throw new AdulaError(403, 'E_UPLOAD_GRANT', 'انتهت صلاحية إذن الرفع أو لا يخصك')
    const resourceName = grant ? grant.resource : request.input('resource')
    const fieldName = grant ? grant.field : request.input('field')
    if (
      typeof resourceName !== 'string' ||
      !runtime.registry.all().some((entry) => entry.name === resourceName)
    )
      throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
    const resource = runtime.registry.get(resourceName)
    const field =
      typeof fieldName === 'string' && Object.hasOwn(resource.fields, fieldName)
        ? resource.fields[fieldName]
        : undefined
    if (!field || field.type !== 'attachment' || (!grant && !resource.form.includes(fieldName)))
      throw new AdulaError(422, 'E_FIELD_INVALID', 'الحقل ليس حقل مرفقات')
    if (!grant) {
      const ability = buildAbility(actor.rules, runtime.registry.all())
      const level = Math.max(
        field.permissionLevel ?? 0,
        resource.hidden?.includes(fieldName) ? 1 : 0
      )
      const allowed =
        actor.permissionLevel >= level &&
        (['create', 'update'] as const).some(
          (action) =>
            resource.actions.includes(action) &&
            ability.can(action, resource.name) &&
            ability.can(action, resource.name, fieldName)
        )
      if (!allowed) throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية لرفع مرفق لهذا الحقل')
    }
    // Unbound uploads are pruned after a day; cap them so one user cannot fill the disk.
    if ((await pendingUploadCount(knex, actor.id)) >= PENDING_UPLOAD_LIMIT)
      throw new AdulaError(
        429,
        'E_UPLOAD_LIMIT',
        'لديك ملفات مرفوعة كثيرة لم تُحفظ في سجل. احفظ السجلات المفتوحة أو انتظر حتى تُنظَّف.'
      )
    const file = request.file('file', attachmentPolicy(field))
    if (!file) throw new AdulaError(422, 'E_FILE_REQUIRED', 'اختر ملفاً للرفع')
    if (!file.isValid)
      throw new AdulaError(
        422,
        'E_FILE_INVALID',
        file.errors.map((error) => error.message).join('، ')
      )
    const extname = (file.extname ?? '').toLowerCase()
    const safeExtname = /^[a-z0-9]{1,32}$/.test(extname) ? extname : 'bin'
    const originalName =
      (file.clientName.split(/[\\/]/).pop() || '').slice(0, 255) || `file.${safeExtname}`
    const disk = env.get('DRIVE_DISK')
    const attachment = await attachmentManager.createFromFile(file)
    attachment.name = `${randomUUID()}.${safeExtname}`
    attachment.setOptions({ folder: `resources/${resource.name}/${fieldName}`, disk })
    await attachmentManager.write(attachment)
    const path = (attachment.path ?? '').replaceAll('\\', '/')
    try {
      const row = await registerUpload(knex, {
        disk,
        path,
        name: attachment.name,
        originalName,
        size: attachment.size,
        mimeType: attachment.mimeType || 'application/octet-stream',
        extname: safeExtname,
        data: { ...attachment.toObject(), path },
        uploadedBy: actor.id,
        impersonatorId: actor.impersonatorId,
        resource: resource.name,
        field: fieldName,
        grant,
      })
      return response.created({
        data: {
          id: row.id,
          name: row.originalName,
          size: row.size,
          mimeType: row.mimeType,
          url: attachmentUrl(row.id),
        },
      })
    } catch (error) {
      await attachmentManager.remove(attachment)
      throw error
    }
  }

  async show(ctx: HttpContext) {
    const { params, response } = ctx
    const runtime = adula()
    const actor = await requestActor(ctx)
    const id = Number(params.id)
    const row = await findAttachment(
      db.connection().getWriteClient(),
      /^\d+$/.test(String(params.id)) ? id : undefined
    )
    if (!row) throw notFound()
    await this.#authorize(row, actor, runtime)
    const disk = drive.use(row.disk as never)
    if (!(await disk.exists(row.path)))
      throw new AdulaError(500, 'E_ATTACHMENT_FILE_MISSING', 'ملف المرفق غير متاح على وحدة التخزين')
    response.header('Content-Type', row.mimeType)
    response.header('Content-Length', String(row.size))
    response.header('Content-Disposition', contentDisposition(row.originalName))
    response.header('X-Content-Type-Options', 'nosniff')
    response.header('Cache-Control', 'private, no-store')
    return response.stream(await disk.getStream(row.path))
  }

  /** Bound files inherit the record's view policy; unbound uploads belong to their uploader only. */
  async #authorize(row: AttachmentRecord, actor: Actor, runtime: ReturnType<typeof adula>) {
    if (row.recordId === null || row.resource === null || row.field === null) {
      if (row.uploadedBy !== actor.id) throw notFound()
      return
    }
    if (!runtime.registry.all().some((entry) => entry.name === row.resource)) throw notFound()
    let shown
    try {
      shown = await runtime.resources.show(row.resource, row.recordId, actor)
    } catch (error) {
      if (error instanceof AdulaError && [403, 404].includes(error.status)) throw notFound()
      throw error
    }
    const value = shown.data[row.field]
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Number((value as { id?: unknown }).id) !== row.id
    )
      throw notFound()
  }
}
