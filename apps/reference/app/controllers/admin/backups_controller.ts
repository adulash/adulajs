import { createReadStream } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError, BACKUP_FAILURE_MESSAGES } from 'adula'
import { activeImpersonation } from '#services/impersonation'
import { activeAdministrator, backupRedirectUri, cloudBackups } from '#services/cloud_backups'
import { actorId, mutate, positiveId, wantsJson } from './support.js'

/** The pending OAuth connection, kept only in the server-side session. */
const OAUTH_KEY = 'backups.oauth'
const OAUTH_TTL_MS = 10 * 60 * 1000
type PendingConnection = {
  provider: string
  state: string
  verifier: string
  userId: number
  at: number
}

/**
 * Backups contain every record, so each handler re-checks the strongest administration
 * permission (manage all) on top of the admin middleware, and refuses while an administrator
 * is acting as another user. Every action is audited by CloudBackups (resource core.backups).
 */
async function requireBackupAdministrator(ctx: HttpContext) {
  const userId = actorId(ctx)
  if (activeImpersonation(ctx))
    throw new AdulaError(403, 'E_FORBIDDEN', 'أوقف انتحال الهوية قبل إدارة النسخ الاحتياطية')
  if (!(await activeAdministrator(userId)))
    throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء')
  return userId
}

function provider(ctx: HttpContext) {
  const value = String(ctx.params.provider)
  if (value !== 'google' && value !== 'onedrive')
    throw new AdulaError(404, 'E_NOT_FOUND', 'الوجهة غير موجودة')
  return value
}

function sameText(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default class BackupsController {
  async index(ctx: HttpContext) {
    await requireBackupAdministrator(ctx)
    const props = { backups: await cloudBackups().status(), failures: BACKUP_FAILURE_MESSAGES }
    if (wantsJson(ctx)) return props
    return ctx.inertia.render('admin/backups/index', props)
  }

  /** Sends the administrator to the provider's consent page. */
  async connect(ctx: HttpContext) {
    const userId = await requireBackupAdministrator(ctx)
    const name = provider(ctx)
    const { url, state, verifier } = cloudBackups().beginConnect(name, backupRedirectUri(name))
    const pending: PendingConnection = { provider: name, state, verifier, userId, at: Date.now() }
    ctx.session.put(OAUTH_KEY, pending)
    if (wantsJson(ctx)) return { url }
    return ctx.inertia.location(url)
  }

  /** The provider's redirect back; the state is single-use, bound to the user and short-lived. */
  async callback(ctx: HttpContext) {
    const userId = await requireBackupAdministrator(ctx)
    const name = provider(ctx)
    const backups = cloudBackups()
    const pending = ctx.session.pull(OAUTH_KEY) as Partial<PendingConnection> | undefined
    const state = ctx.request.input('state')
    const code = ctx.request.input('code')
    const valid =
      pending &&
      pending.provider === name &&
      pending.userId === userId &&
      typeof pending.at === 'number' &&
      Date.now() - pending.at <= OAUTH_TTL_MS &&
      typeof pending.state === 'string' &&
      typeof pending.verifier === 'string' &&
      typeof state === 'string' &&
      sameText(state, pending.state)
    if (!valid) {
      await backups.connectFailed(name, 'state', userId)
      ctx.session.flash('error', 'انتهت صلاحية طلب الربط أو لم يكتمل. ابدأ الربط من جديد')
      return ctx.response.redirect('/admin/backups')
    }
    if (ctx.request.input('error') || typeof code !== 'string' || !code) {
      await backups.connectFailed(name, 'provider', userId)
      ctx.session.flash('error', 'لم يكتمل الربط لدى مزود الخدمة')
      return ctx.response.redirect('/admin/backups')
    }
    try {
      await backups.completeConnect(
        name,
        { code, verifier: pending.verifier!, redirectUri: backupRedirectUri(name) },
        userId
      )
      ctx.session.flash('success', 'تم ربط الوجهة')
    } catch (error) {
      if (!(error instanceof AdulaError)) throw error
      ctx.session.flash('error', error.message)
    }
    return ctx.response.redirect('/admin/backups')
  }

  async disconnect(ctx: HttpContext) {
    const userId = await requireBackupAdministrator(ctx)
    const name = provider(ctx)
    return mutate(
      ctx,
      () => cloudBackups().disconnect(name, userId),
      'تم فصل الوجهة وحذف إذن الوصول'
    )
  }

  async schedule(ctx: HttpContext) {
    const userId = await requireBackupAdministrator(ctx)
    const name = provider(ctx)
    const value = String(ctx.request.input('schedule') ?? '')
    return mutate(ctx, () => cloudBackups().setSchedule(name, value, userId), 'تم حفظ الجدولة')
  }

  async run(ctx: HttpContext) {
    const userId = await requireBackupAdministrator(ctx)
    const kind = String(ctx.request.input('kind') ?? '')
    return mutate(
      ctx,
      async () => ({ id: await cloudBackups().queue(kind, userId) }),
      'بدأ إنشاء النسخة الاحتياطية. ستظهر النتيجة في هذه الصفحة'
    )
  }

  /** Streams a ready archive; it is encrypted, but still never cached by the browser. */
  async download(ctx: HttpContext) {
    const userId = await requireBackupAdministrator(ctx)
    const id = positiveId(ctx.params.id, 'النسخة الاحتياطية غير موجودة')
    const file = await cloudBackups().download(id, userId)
    ctx.response.header('Content-Type', 'application/octet-stream')
    ctx.response.header('Content-Length', String(file.size))
    ctx.response.header('Content-Disposition', `attachment; filename="${file.fileName}"`)
    ctx.response.header('Cache-Control', 'no-store')
    ctx.response.header('X-Content-Type-Options', 'nosniff')
    return ctx.response.stream(createReadStream(file.path))
  }
}
