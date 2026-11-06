import type { Knex } from 'knex'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from '../core/activity.js'
import { registerUpload, isAttachmentId } from '../attachments/attachment_service.js'
import { derivePrimaryTheme, normalizeColor, type DerivedTheme } from './colors.js'
import type { LogoImage } from './logo.js'

/**
 * Appearance and occasion themes (ADR 053). The base identity is one system setting; dated
 * occasions live in `appearance_occasions`; logos are `attachments` rows bound to this owner,
 * so backups and storage migration carry them like profile pictures (ADR 050). Nothing is
 * scheduled: `resolve()` picks the active occasion for today's date in the system time zone,
 * so the base identity returns by itself the day after an occasion ends.
 */
export const APPEARANCE_SETTING_KEY = 'appearance.identity'
export const APPEARANCE_LOGO_OWNER = Object.freeze({ resource: 'core_appearance', field: 'logo' })
/** The `record_id` of the base identity's logo; occasions use their own id. */
export const BASE_LOGO_RECORD = 0
const RESOURCE = 'core.appearance'
const CACHE_MS = 30_000

export const APPEARANCE_TEXT_LIMITS = Object.freeze({
  company: 120,
  loginTitle: 120,
  loginDescription: 300,
  guestTitle: 120,
  guestDescription: 300,
  name: 80,
  banner: 160,
})

export type AppearanceIdentity = {
  company: string | null
  logoId: number | null
  loginTitle: string | null
  loginDescription: string | null
  guestTitle: string | null
  guestDescription: string | null
  primaryColor: string | null
}
export type AppearanceOccasion = {
  id: number
  name: string
  startsOn: string
  endsOn: string
  primaryColor: string | null
  logoId: number | null
  banner: string | null
  loginTitle: string | null
  loginDescription: string | null
}
export type ResolvedAppearance = {
  company: string | null
  logoId: number | null
  login: { title: string | null; description: string | null }
  guestHome: { title: string | null; description: string | null }
  banner: string | null
  occasion: { id: number; name: string; startsOn: string; endsOn: string } | null
  theme: DerivedTheme | null
}
export type AppearanceLogo = {
  id: number
  disk: string
  path: string
  mimeType: string
  size: number
  /** null while uploaded but not yet saved with the identity or an occasion. */
  recordId: number | null
}
export type RemovedLogoFile = { disk: string; path: string }
type Who = { id: number; impersonatorId?: number | null }

const EMPTY_IDENTITY: AppearanceIdentity = {
  company: null,
  logoId: null,
  loginTitle: null,
  loginDescription: null,
  guestTitle: null,
  guestDescription: null,
  primaryColor: null,
}
const IDENTITY_TEXTS = [
  'company',
  'loginTitle',
  'loginDescription',
  'guestTitle',
  'guestDescription',
] as const
const OCCASION_TEXTS = ['name', 'banner', 'loginTitle', 'loginDescription'] as const

const invalid = (message: string) => new AdulaError(422, 'E_APPEARANCE_INPUT', message)

/** Plain text on one line: trimmed, bounded, no control characters; empty is null. */
function plainText(value: unknown, limit: number, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw invalid(`${label} يجب أن يكون نصًا`)
  const text = value.trim()
  if (!text) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f20282029]/.test(text))
    throw invalid(`${label} يجب أن يكون سطرًا واحدًا دون رموز تحكم`)
  if ([...text].length > limit) throw invalid(`${label} لا يتجاوز ${limit} حرفًا`)
  return text
}

const LABELS: Record<string, string> = {
  company: 'اسم الشركة',
  loginTitle: 'عنوان صفحة الدخول',
  loginDescription: 'وصف صفحة الدخول',
  guestTitle: 'عنوان الصفحة الرئيسية للزوار',
  guestDescription: 'وصف الصفحة الرئيسية للزوار',
  name: 'اسم المناسبة',
  banner: 'رسالة المناسبة',
}

function colorOf(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  const color = normalizeColor(value)
  if (!color) throw invalid('اكتب اللون بالصيغة ‎#RRGGBB‎')
  // Refused here, with the Arabic reason, when either theme misses WCAG AA.
  derivePrimaryTheme(color)
  return color
}

function logoIdOf(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const id = Number(value)
  if (!isAttachmentId(id)) throw invalid('الشعار غير صالح')
  return id
}

/** A real calendar date written as YYYY-MM-DD. */
function dateOf(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const date = match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : null
  if (!date || date.toISOString().slice(0, 10) !== text) throw invalid(`${label} غير صالح`)
  return text
}

function only(input: unknown, allowed: readonly string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw invalid('بيانات المظهر غير صالحة')
  const data = input as Record<string, unknown>
  if (Object.keys(data).some((key) => !allowed.includes(key)))
    throw invalid('حقل غير معروف في إعداد المظهر')
  return data
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function dateIn(timeZone: string, now: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

const OCCASION_COLUMNS = [
  'id',
  'name',
  'primary_color',
  'logo_id',
  'banner',
  'login_title',
  'login_description',
]

function occasionOf(row: Record<string, unknown>): AppearanceOccasion {
  return {
    id: Number(row.id),
    name: String(row.name),
    startsOn: String(row.starts_on),
    endsOn: String(row.ends_on),
    primaryColor: (row.primary_color as string | null) ?? null,
    logoId: row.logo_id === null || row.logo_id === undefined ? null : Number(row.logo_id),
    banner: (row.banner as string | null) ?? null,
    loginTitle: (row.login_title as string | null) ?? null,
    loginDescription: (row.login_description as string | null) ?? null,
  }
}

export class Appearance {
  /** The current time; tests replace it to move between and past occasions. */
  clock: () => Date
  #cache: { key: string; at: number; value: ResolvedAppearance } | null = null

  constructor(
    private db: Knex,
    private options: { timeZone: string; now?: () => Date; cacheMs?: number }
  ) {
    this.clock = options.now ?? (() => new Date())
  }

  /** Today in the system time zone; an occasion's dates are read in the same zone. */
  today() {
    return dateIn(this.options.timeZone, this.clock())
  }

  async identity(): Promise<AppearanceIdentity> {
    const row = await this.db('settings')
      .where({ key: APPEARANCE_SETTING_KEY, scope: 'system', scope_id: '0' })
      .first('value')
    const value = (row?.value ?? {}) as Record<string, unknown>
    const identity = { ...EMPTY_IDENTITY }
    for (const key of IDENTITY_TEXTS)
      identity[key] = typeof value[key] === 'string' ? (value[key] as string) : null
    identity.logoId = isAttachmentId(Number(value.logoId)) ? Number(value.logoId) : null
    identity.primaryColor = normalizeColor(value.primaryColor)
    return identity
  }

  /** Replaces the base identity. A changed logo retires the previous one. */
  async saveIdentity(
    actor: Who,
    input: unknown
  ): Promise<{ identity: AppearanceIdentity; removed: RemovedLogoFile[] }> {
    const data = only(input, [...IDENTITY_TEXTS, 'logoId', 'primaryColor'])
    const next = { ...EMPTY_IDENTITY }
    for (const key of IDENTITY_TEXTS)
      next[key] = plainText(data[key], APPEARANCE_TEXT_LIMITS[key], LABELS[key])
    next.primaryColor = colorOf(data.primaryColor)
    next.logoId = logoIdOf(data.logoId)
    const removed = await this.db.transaction(async (trx) => {
      await this.#lockSettings(trx)
      const previous = await this.identity()
      const files = await this.#bindLogo(trx, next.logoId, BASE_LOGO_RECORD)
      await trx('settings')
        .insert({
          key: APPEARANCE_SETTING_KEY,
          scope: 'system',
          scope_id: '0',
          value: JSON.stringify(next),
        })
        .onConflict(['key', 'scope', 'scope_id'])
        .merge(['value'])
      await this.#log(trx, actor, BASE_LOGO_RECORD, 'identity.update', {
        changed: Object.keys(next).filter(
          (key) =>
            next[key as keyof AppearanceIdentity] !== previous[key as keyof AppearanceIdentity]
        ),
        primaryColor: next.primaryColor,
        logoId: next.logoId,
      })
      return files
    })
    this.#cache = null
    return { identity: await this.identity(), removed }
  }

  /** «استعادة الافتراضي»: removes the saved identity and its logo; occasions stay. */
  async resetIdentity(actor: Who): Promise<RemovedLogoFile[]> {
    const removed = await this.db.transaction(async (trx) => {
      await this.#lockSettings(trx)
      const files = await this.#bindLogo(trx, null, BASE_LOGO_RECORD)
      await trx('settings')
        .where({ key: APPEARANCE_SETTING_KEY, scope: 'system', scope_id: '0' })
        .delete()
      await this.#log(trx, actor, BASE_LOGO_RECORD, 'identity.reset', {})
      return files
    })
    this.#cache = null
    return removed
  }

  async occasions(): Promise<AppearanceOccasion[]> {
    const rows = await this.#occasionQuery(this.db).orderBy('starts_on', 'desc')
    return rows.map(occasionOf)
  }

  async occasion(id: number): Promise<AppearanceOccasion | null> {
    if (!isAttachmentId(id)) return null
    const row = await this.#occasionQuery(this.db).where('id', id).first()
    return row ? occasionOf(row) : null
  }

  /** Creates (no id) or updates an occasion; a date range that overlaps another is refused. */
  async saveOccasion(
    actor: Who,
    input: unknown,
    id?: number
  ): Promise<{ occasion: AppearanceOccasion; removed: RemovedLogoFile[] }> {
    const data = only(input, [...OCCASION_TEXTS, 'startsOn', 'endsOn', 'primaryColor', 'logoId'])
    const name = plainText(data.name, APPEARANCE_TEXT_LIMITS.name, LABELS.name)
    if (!name) throw invalid('اكتب اسم المناسبة')
    const startsOn = dateOf(data.startsOn, 'تاريخ البداية')
    const endsOn = dateOf(data.endsOn, 'تاريخ النهاية')
    if (endsOn < startsOn) throw invalid('تاريخ النهاية يجب ألا يسبق تاريخ البداية')
    const values = {
      name,
      starts_on: startsOn,
      ends_on: endsOn,
      primary_color: colorOf(data.primaryColor),
      logo_id: logoIdOf(data.logoId),
      banner: plainText(data.banner, APPEARANCE_TEXT_LIMITS.banner, LABELS.banner),
      login_title: plainText(data.loginTitle, APPEARANCE_TEXT_LIMITS.loginTitle, LABELS.loginTitle),
      login_description: plainText(
        data.loginDescription,
        APPEARANCE_TEXT_LIMITS.loginDescription,
        LABELS.loginDescription
      ),
    }
    if (
      !values.primary_color &&
      !values.logo_id &&
      !values.banner &&
      !values.login_title &&
      !values.login_description
    )
      throw invalid('اختر تغييرًا واحدًا على الأقل للمناسبة: اللون أو الشعار أو الرسالة أو نصوص الدخول')
    const result = await this.db.transaction(async (trx) => {
      // One writer at a time, so two overlapping occasions cannot both pass the check.
      await trx.raw('LOCK TABLE appearance_occasions IN SHARE ROW EXCLUSIVE MODE')
      if (id !== undefined) {
        const existing = await trx('appearance_occasions').where('id', id).first('id')
        if (!existing) throw new AdulaError(404, 'E_NOT_FOUND', 'المناسبة غير موجودة')
      }
      const overlapping = await this.#occasionQuery(trx)
        .where('starts_on', '<=', endsOn)
        .where('ends_on', '>=', startsOn)
        .modify((query) => {
          if (id !== undefined) query.whereNot('id', id)
        })
        .first()
      if (overlapping) {
        const other = occasionOf(overlapping)
        throw new AdulaError(
          409,
          'E_APPEARANCE_OVERLAP',
          `تتداخل الفترة مع مناسبة «${other.name}» (${other.startsOn} – ${other.endsOn}). لا تنشط إلا مناسبة واحدة في كل يوم.`
        )
      }
      let saved: number
      if (id === undefined) {
        const [row] = await trx('appearance_occasions')
          .insert({ ...values, created_by: actor.id, updated_by: actor.id })
          .returning('id')
        saved = Number(row.id ?? row)
      } else {
        await trx('appearance_occasions')
          .where('id', id)
          .update({ ...values, updated_by: actor.id, updated_at: trx.fn.now() })
        saved = id
      }
      const files = await this.#bindLogo(trx, values.logo_id, saved)
      await this.#log(trx, actor, saved, id === undefined ? 'occasion.create' : 'occasion.update', {
        name,
        startsOn,
        endsOn,
        primaryColor: values.primary_color,
        logoId: values.logo_id,
        banner: values.banner !== null,
      })
      return { id: saved, files }
    })
    this.#cache = null
    return { occasion: (await this.occasion(result.id))!, removed: result.files }
  }

  async deleteOccasion(actor: Who, id: number): Promise<RemovedLogoFile[]> {
    if (!isAttachmentId(id)) throw new AdulaError(404, 'E_NOT_FOUND', 'المناسبة غير موجودة')
    const removed = await this.db.transaction(async (trx) => {
      const row = await trx('appearance_occasions').where('id', id).forUpdate().first('id', 'name')
      if (!row) throw new AdulaError(404, 'E_NOT_FOUND', 'المناسبة غير موجودة')
      const files = await this.#bindLogo(trx, null, id)
      await trx('appearance_occasions').where('id', id).delete()
      await this.#log(trx, actor, id, 'occasion.delete', { name: row.name })
      return files
    })
    this.#cache = null
    return removed
  }

  /**
   * Records a stored, prepared logo as an unbound upload. It becomes the identity's or an
   * occasion's logo only when that is saved; an abandoned upload is pruned like any other.
   */
  async registerLogo(
    actor: Who,
    file: { disk: string; path: string; image: LogoImage }
  ): Promise<AppearanceLogo> {
    return this.db.transaction(async (trx) => {
      const row = await registerUpload(trx, {
        disk: file.disk,
        path: file.path,
        name: file.path.split('/').at(-1) ?? '',
        originalName: `logo.${file.image.extname}`,
        size: file.image.bytes.length,
        mimeType: file.image.mimeType,
        extname: file.image.extname,
        data: { width: file.image.width, height: file.image.height },
        uploadedBy: actor.id,
        impersonatorId: actor.impersonatorId,
        resource: APPEARANCE_LOGO_OWNER.resource,
        field: APPEARANCE_LOGO_OWNER.field,
      })
      await this.#log(trx, actor, BASE_LOGO_RECORD, 'logo.upload', {
        logoId: row.id,
        width: file.image.width,
        height: file.image.height,
      })
      return (await this.logo(row.id, trx))!
    })
  }

  /** A live appearance logo; any other attachment id is unknown here. */
  async logo(id: number, db: Knex = this.db): Promise<AppearanceLogo | null> {
    if (!isAttachmentId(id)) return null
    const row = await db('attachments')
      .where({
        id,
        resource: APPEARANCE_LOGO_OWNER.resource,
        field: APPEARANCE_LOGO_OWNER.field,
      })
      .whereNull('deleted_at')
      .first('id', 'disk', 'path', 'mime_type', 'size', 'record_id')
    if (!row) return null
    return {
      id: Number(row.id),
      disk: String(row.disk),
      path: String(row.path),
      mimeType: String(row.mime_type),
      size: Number(row.size),
      recordId: row.record_id === null ? null : Number(row.record_id),
    }
  }

  /**
   * The appearance for this request: the base identity, overridden by the occasion whose
   * dates include today. Cached for 30 seconds per date and cleared by every change here.
   */
  async resolve(): Promise<ResolvedAppearance> {
    const today = this.today()
    const now = Date.now()
    const ttl = this.options.cacheMs ?? CACHE_MS
    if (this.#cache && this.#cache.key === today && now - this.#cache.at < ttl)
      return this.#cache.value
    const identity = await this.identity()
    const row = await this.#occasionQuery(this.db)
      .where('starts_on', '<=', today)
      .where('ends_on', '>=', today)
      .orderBy('starts_on', 'desc')
      .first()
    const occasion = row ? occasionOf(row) : null
    const color = occasion?.primaryColor ?? identity.primaryColor
    const value: ResolvedAppearance = {
      company: identity.company,
      logoId: occasion?.logoId ?? identity.logoId,
      login: {
        title: occasion?.loginTitle ?? identity.loginTitle,
        description: occasion?.loginDescription ?? identity.loginDescription,
      },
      guestHome: { title: identity.guestTitle, description: identity.guestDescription },
      banner: occasion?.banner ?? null,
      occasion: occasion
        ? {
            id: occasion.id,
            name: occasion.name,
            startsOn: occasion.startsOn,
            endsOn: occasion.endsOn,
          }
        : null,
      // A stored colour passed the check when it was saved; a failing one is ignored.
      theme: color ? safeTheme(color) : null,
    }
    this.#cache = { key: today, at: now, value }
    return value
  }

  #occasionQuery(db: Knex) {
    return db('appearance_occasions').select(
      ...OCCASION_COLUMNS,
      db.raw(`to_char(starts_on, 'YYYY-MM-DD') as starts_on`),
      db.raw(`to_char(ends_on, 'YYYY-MM-DD') as ends_on`)
    )
  }

  async #lockSettings(trx: Knex.Transaction) {
    // Serialises identity changes; the advisory lock is released with the transaction.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [APPEARANCE_SETTING_KEY])
  }

  /**
   * Binds `logoId` to `recordId` and removes that record's other logos. The logo must be an
   * appearance upload that is unbound or already bound to the same record.
   */
  async #bindLogo(
    trx: Knex.Transaction,
    logoId: number | null,
    recordId: number
  ): Promise<RemovedLogoFile[]> {
    if (logoId !== null) {
      const logo = await this.logo(logoId, trx)
      if (!logo || (logo.recordId !== null && logo.recordId !== recordId))
        throw invalid('الشعار غير موجود. ارفعه مرة أخرى.')
      await trx('attachments').where('id', logoId).update({ record_id: recordId })
    }
    const previous = trx('attachments')
      .where({
        resource: APPEARANCE_LOGO_OWNER.resource,
        field: APPEARANCE_LOGO_OWNER.field,
        record_id: recordId,
      })
      .whereNull('deleted_at')
    if (logoId !== null) previous.whereNot('id', logoId)
    const rows = await previous.select('id', 'disk', 'path')
    if (!rows.length) return []
    await trx('attachments')
      .whereIn(
        'id',
        rows.map((row) => Number(row.id))
      )
      .delete()
    return rows.map((row) => ({ disk: String(row.disk), path: String(row.path) }))
  }

  #log(
    trx: Knex.Transaction,
    actor: Who,
    recordId: number,
    action: string,
    changes: Record<string, unknown>
  ) {
    return logActivity(trx, {
      resource: RESOURCE,
      recordId,
      actorId: actor.id,
      impersonatorId: actor.impersonatorId,
      action,
      changes,
    })
  }
}

function safeTheme(color: string): DerivedTheme | null {
  try {
    return derivePrimaryTheme(color)
  } catch {
    return null
  }
}
