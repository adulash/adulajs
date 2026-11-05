import { buildAbility, localizeText } from 'adula'
import type { Actor, ActivityPage, Field, Resource } from 'adula'
import type database from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import { localLabel } from '#services/languages'

type Knex = ReturnType<ReturnType<typeof database.connection>['getWriteClient']>

/**
 * Arabic names of the subjects the core and the starter write to the activity log that are
 * not registered resources. A project adds its own entries in its copy of this file.
 */
export const activitySubjects: Record<string, string> = {
  'core.users': 'المستخدمون',
  'users': 'الحسابات',
  'core.roles': 'الأدوار',
  'core.org_units': 'الوحدات التنظيمية',
  'core.settings': 'الإعدادات',
  'core.lookups': 'القوائم المرجعية',
  'core.sequences': 'الترقيم',
  'core.saved_views': 'طرق العرض المحفوظة',
  'core.exports': 'التصدير',
  'core.jobs': 'المهام الخلفية',
  'core.backups': 'النسخ الاحتياطي',
  'core.mail': 'البريد',
  'core.setup': 'الإعداد الأولي',
}

/**
 * Arabic names of the actions the core and the starter log. Unknown actions (for example a
 * module's own) show their key; a project adds them in its copy of this file.
 */
export const activityActions: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  restore: 'استعادة',
  view: 'عرض',
  submit: 'اعتماد',
  cancel: 'إلغاء',
  amend: 'تعديل بنسخة جديدة',
  upsert: 'استيراد بالتحديث',
  exported: 'تصدير',
  printed: 'طباعة',
  comment: 'تعليق',
  tag: 'وسم',
  reassign: 'إعادة إسناد',
  assignment_closed: 'إغلاق إسناد',
  notify: 'إشعار',
  overdue: 'تجاوز الموعد',
  retry: 'إعادة المحاولة',
  adjust: 'ضبط',
  check: 'فحص',
  manage: 'إدارة',
  reorder: 'إعادة ترتيب',
  move: 'نقل',
  rename: 'إعادة تسمية',
  assign_role: 'إسناد دور',
  remove_role: 'إزالة دور',
  set_rule: 'ضبط صلاحية',
  remove_rule: 'إزالة صلاحية',
  set_level: 'ضبط مستوى الصلاحية',
  set_key: 'ضبط إعداد',
  assign_org_unit: 'إضافة إلى وحدة',
  remove_org_unit: 'إزالة من وحدة',
  disable: 'تعطيل الحساب',
  enable: 'تفعيل الحساب',
  revoke_sessions: 'إنهاء الجلسات',
  revoke_tokens: 'إلغاء رموز الوصول',
  session_revoked: 'إنهاء جلسة',
  impersonate: 'بدء انتحال الحساب',
  stop_impersonation: 'إنهاء انتحال الحساب',
  login: 'تسجيل الدخول',
  oauth_login: 'الدخول عبر مزوّد خارجي',
  login_failed: 'محاولة دخول فاشلة',
  login_locked: 'إيقاف الدخول مؤقتًا',
  logout: 'تسجيل الخروج',
  password_reset_requested: 'طلب استعادة كلمة المرور',
  password_reset_delivery_failed: 'تعذّر إرسال استعادة كلمة المرور',
  password_reset: 'استعادة كلمة المرور',
  password_changed: 'تغيير كلمة المرور',
  password_confirmation_failed: 'فشل تأكيد كلمة المرور',
  profile_updated: 'تعديل الملف الشخصي',
  identity_confirmed: 'تأكيد الهوية',
  social_linked: 'ربط حساب خارجي',
  social_unlinked: 'فك ربط حساب خارجي',
  social_link_refused: 'رفض ربط حساب خارجي',
  two_factor_enabled: 'تفعيل التحقق بخطوتين',
  two_factor_disabled: 'إيقاف التحقق بخطوتين',
  two_factor_reset: 'إعادة ضبط التحقق بخطوتين',
  two_factor_failed: 'رمز تحقق خاطئ',
  two_factor_locked: 'إيقاف التحقق مؤقتًا',
  two_factor_recovery_regenerated: 'رموز استرداد جديدة',
  two_factor_recovery_used: 'استخدام رمز استرداد',
  invitation_created: 'إنشاء دعوة',
  invitation_sent: 'إرسال دعوة',
  invitation_accepted: 'قبول دعوة',
  invitation_delivery_failed: 'تعذّر إرسال دعوة',
  delegation_created: 'إنشاء تفويض',
  delegation_revoked: 'إلغاء تفويض',
  notification_channels_updated: 'تعديل قنوات الإشعار',
  notification_channel_confirmed: 'تأكيد قناة إشعار',
  notification_test: 'إشعار تجريبي',
  test_requested: 'طلب اختبار',
  upload_granted: 'منح رفع ملف',
  upload_via_grant: 'رفع ملف بإذن',
  install_rotate_credentials: 'تجديد بيانات الدخول',
}

/** One changed field of an update, formatted for reading. */
export type PresentedFieldChange = {
  field: string
  label: string
  before: string | null
  after: string | null
  /** The viewer may not read this field's values; both values are null. */
  withheld?: true
}
export type PresentedActivity = ActivityPage['data'][number] & {
  resourceLabel: string
  actionLabel: string
  recordTitle: string | null
  actorName: string | null
  fieldChanges: PresentedFieldChange[]
}

type Context = { db: Knex; viewer: Actor; language: string }

const label = (map: Record<string, string>, key: string, language: string) =>
  map[key] ? localizeText(map[key], language) : key

export function subjectLabel(name: string, language: string) {
  const { registry } = adula()
  if (registry.has(name)) return localLabel(registry.get(name).label, language) ?? name
  return label(activitySubjects, name, language)
}

export function actionLabel(action: string, language: string) {
  return label(activityActions, action, language)
}

/**
 * Whether the viewer may read a field's values, by the rule the record history uses: the
 * field still exists and is serialized, its level is within the viewer's, and no field rule
 * denies viewing it.
 */
function readable(resource: Resource, key: string, viewer: Actor, can: (key: string) => boolean) {
  const field = resource.fields[key]
  if (!field) return false
  const serialized = resource.serialize ?? [...resource.list, ...resource.show]
  const level = Math.max(field.permissionLevel ?? 0, resource.hidden?.includes(key) ? 1 : 0)
  return serialized.includes(key) && viewer.permissionLevel >= level && can(key)
}

const scalar = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

/** Names of users, by id (full name, else e-mail). */
async function userNames(db: Knex, ids: Iterable<number>) {
  const list = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0)
  if (!list.length) return new Map<number, string>()
  const rows = await db('users').whereIn('id', list).select('id', 'full_name', 'email')
  return new Map<number, string>(
    rows.map((row) => [Number(row.id), String(row.full_name || row.email)])
  )
}

/** Titles of the records on the page, by subject; null where the viewer may not see one. */
async function recordTitles(context: Context, rows: ActivityPage['data']) {
  const { db, viewer } = context
  const bySubject = new Map<string, number[]>()
  for (const row of rows)
    if (row.recordId !== null)
      bySubject.set(row.resource, [...(bySubject.get(row.resource) ?? []), Number(row.recordId)])
  const titles = new Map<string, Map<number, string>>()
  const core: Record<string, { table: string; column: string }> = {
    'core.roles': { table: 'roles', column: 'name' },
    'core.org_units': { table: 'org_units', column: 'name' },
  }
  for (const [subject, ids] of bySubject) {
    try {
      if (subject === 'core.users' || subject === 'users')
        titles.set(subject, await userNames(db, ids))
      else if (core[subject]) {
        const { table, column } = core[subject]
        const found = await db(table)
          .whereIn('id', [...new Set(ids)])
          .select('id', column)
        titles.set(subject, new Map(found.map((row) => [Number(row.id), String(row[column])])))
      } else if (adula().registry.has(subject))
        // Titles drop records the viewer cannot see and deleted ones; those show their id.
        titles.set(subject, await adula().resources.titles(subject, [...new Set(ids)], viewer))
    } catch {
      // A title is a convenience: a failing lookup leaves the id in place.
    }
  }
  return titles
}

/** Formats one stored value of a field, resolving options, lookups, users and relations. */
async function formatter(
  context: Context,
  changes: { resource: string; field: string; before: unknown; after: unknown }[]
) {
  const { db, viewer, language } = context
  const { registry } = adula()
  const lookupLabels = new Map<string, string>()
  const users = new Set<number>()
  const relations = new Map<string, Set<number>>()
  const lookupGroups = new Set<string>()
  for (const change of changes) {
    if (!registry.has(change.resource)) continue
    const field = registry.get(change.resource).fields[change.field] as Field | undefined
    for (const value of [change.before, change.after]) {
      if (value === null || value === undefined) continue
      if (field?.type === 'user') users.add(Number(value))
      if (field?.type === 'belongsTo') {
        const ids = relations.get(field.resource) ?? new Set<number>()
        ids.add(Number(value))
        relations.set(field.resource, ids)
      }
      if (field?.type === 'lookup') lookupGroups.add(field.group)
    }
  }
  if (lookupGroups.size) {
    const rows = await db('lookups')
      .whereIn('group', [...lookupGroups])
      .select('group', 'key', 'label_ar', 'label_en')
    for (const row of rows)
      lookupLabels.set(
        `${row.group}\u0000${row.key}`,
        language === 'ar' ? row.label_ar : row.label_en || row.label_ar
      )
  }
  const names = await userNames(db, users)
  const related = new Map<string, Map<number, string>>()
  for (const [resource, ids] of relations)
    try {
      related.set(resource, await adula().resources.titles(resource, [...ids], viewer))
    } catch {
      // The target may be gone from the registry or unreadable; ids stay.
    }
  return (resource: string, key: string, value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null
    const field = registry.has(resource)
      ? (registry.get(resource).fields[key] as Field | undefined)
      : undefined
    try {
      switch (field?.type) {
        case 'enum':
          return (
            localLabel(field.options.find((option) => option.value === value)?.label, language) ??
            scalar(value)
          )
        case 'multiSelect':
          return Array.isArray(value)
            ? value
                .map(
                  (entry) =>
                    localLabel(
                      field.options.find((option) => option.value === entry)?.label,
                      language
                    ) ?? String(entry)
                )
                .join('، ')
            : scalar(value)
        case 'lookup':
          return lookupLabels.get(`${field.group}\u0000${value}`) ?? scalar(value)
        case 'user':
          return names.get(Number(value)) ?? `#${value}`
        case 'belongsTo':
          return related.get(field.resource)?.get(Number(value)) ?? `#${value}`
        default:
          return scalar(value)
      }
    } catch {
      return scalar(value)
    }
  }
}

/**
 * The activity rows of one page in readable form: subject and action names, record titles,
 * actor names and each update's changed fields («label: before ← after») from `field_changes`.
 * Rows keep every original key, so JSON clients of the activity list are unaffected.
 */
export async function presentActivity(
  context: Context,
  page: ActivityPage
): Promise<{ data: PresentedActivity[]; nextCursor: string | null }> {
  const { db, viewer, language } = context
  const { registry } = adula()
  const rows = page.data
  const ids = rows.map((row) => row.id)
  const stored = ids.length
    ? await db('field_changes')
        .whereIn('activity_id', ids)
        .orderBy('id')
        .select('activity_id', 'resource', 'field', 'before', 'after')
    : []
  const format = await formatter(context, stored)
  const ability = buildAbility(viewer.rules, registry.all())
  const titles = await recordTitles(context, rows)
  const actors = await userNames(
    db,
    rows.map((row) => Number(row.actorId))
  )
  const changes = new Map<string, PresentedFieldChange[]>()
  for (const change of stored) {
    const key = String(change.field)
    const resource = registry.has(change.resource) ? registry.get(change.resource) : undefined
    const fieldLabel = resource?.fields[key]
      ? (localLabel(resource.fields[key].label, language) ?? key)
      : key
    const visible =
      resource !== undefined &&
      readable(resource, key, viewer, (field) => ability.can('view', resource.name, field))
    const list = changes.get(String(change.activity_id)) ?? []
    list.push(
      visible
        ? {
            field: key,
            label: fieldLabel,
            before: format(change.resource, key, change.before),
            after: format(change.resource, key, change.after),
          }
        : { field: key, label: fieldLabel, before: null, after: null, withheld: true }
    )
    changes.set(String(change.activity_id), list)
  }
  return {
    ...page,
    data: rows.map((row) => ({
      ...row,
      resourceLabel: subjectLabel(row.resource, language),
      actionLabel: actionLabel(row.action, language),
      recordTitle:
        row.recordId === null
          ? null
          : (titles.get(row.resource)?.get(Number(row.recordId)) ?? null),
      actorName: row.actorId === null ? null : (actors.get(Number(row.actorId)) ?? null),
      fieldChanges: changes.get(String(row.id)) ?? [],
    })),
  }
}

/** The filter choices with their names, and the actors who appear in the log. */
export async function activityFacets(
  db: Knex,
  facets: { resources: string[]; actions: string[] },
  language: string
) {
  const actors = await db('activities as a')
    .join('users as u', 'u.id', 'a.actor_id')
    .distinct('u.id', 'u.full_name', 'u.email')
  return {
    ...facets,
    labels: {
      resources: Object.fromEntries(
        facets.resources.map((name) => [name, subjectLabel(name, language)])
      ),
      actions: Object.fromEntries(
        facets.actions.map((name) => [name, actionLabel(name, language)])
      ),
    },
    actors: actors
      .map((row) => ({ id: Number(row.id), name: String(row.full_name || row.email) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
  }
}
