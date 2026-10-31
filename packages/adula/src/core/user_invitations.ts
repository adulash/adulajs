import { createHash, randomBytes } from 'node:crypto'
import { subject } from '@casl/ability'
import type { Knex } from 'knex'
import { ActorStore } from '../auth/actor_store.js'
import { buildAbility } from '../auth/ability.js'
import { ResourceRegistry } from '../resource/registry.js'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from './activity.js'

const RESOURCE = 'core.users'
const INVITATIONS = 'core.user_invitations'
const digest = (token: string) => createHash('sha256').update(token).digest('hex')
const invalid = () =>
  new AdulaError(
    422,
    'E_INVITATION_INVALID',
    'الدعوة غير صالحة أو انتهت صلاحيتها. اطلب دعوة جديدة من المسؤول.'
  )
export type InvitationDelivery = { email: string; fullName: string; token: string }

/** Pending invitations are not accounts. Password hashing and mail transport belong to the host. */
export class UserInvitations {
  constructor(private db: Knex) {}

  async canInvite(actorId: number): Promise<boolean> {
    const user = await this.db('users').where('id', actorId).first('disabled_at')
    if (!user || user.disabled_at) return false
    const actor = await new ActorStore(this.db, new ResourceRegistry()).load(actorId)
    return buildAbility(actor.rules).can('invite', subject(RESOURCE, {}))
  }

  async invite(
    actorId: number,
    input: { email: string; fullName: string },
    send: (invitation: InvitationDelivery) => Promise<void>,
    /** The administrator impersonating actorId; recorded in each activity entry. */
    context: { impersonatorId?: number | null } = {}
  ) {
    const impersonatorId = context.impersonatorId ?? null
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : ''
    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !fullName ||
      fullName.length > 120
    )
      throw new AdulaError(422, 'E_INVITATION_INPUT', 'أدخل اسمًا وبريدًا إلكترونيًا صحيحين')
    const token = randomBytes(32).toString('base64url')
    const tokenHash = digest(token)
    const id = await this.db.transaction(async (trx) => {
      // Serialize resends and acceptance for the same normalized email.
      await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [email])
      if (!(await new UserInvitations(trx).canInvite(actorId)))
        throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية دعوة المستخدمين')
      if (await trx('users').whereRaw('lower(email) = ?', [email]).first('id'))
        throw new AdulaError(409, 'E_USER_EXISTS', 'يوجد حساب بهذا البريد بالفعل')
      const previous = await trx('user_invitations').where({ email }).first()
      if (previous && Date.now() - new Date(previous.created_at).getTime() < 60_000)
        throw new AdulaError(429, 'E_INVITATION_WAIT', 'انتظر دقيقة قبل إعادة إرسال الدعوة')
      const [row] = await trx('user_invitations')
        .insert({
          email,
          full_name: fullName,
          invited_by: actorId,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          accepted_at: null,
          created_at: trx.fn.now(),
        })
        .onConflict('email')
        .merge()
        .returning('id')
      await logActivity(trx, {
        resource: INVITATIONS,
        recordId: row.id,
        actorId,
        impersonatorId,
        action: 'invitation_created',
        changes: { email },
      })
      return row.id as number
    })
    try {
      await send({ email, fullName, token })
    } catch {
      // Revoke only this attempt; a newer resend must survive an older transport failure.
      await this.db('user_invitations')
        .where({ id, token_hash: tokenHash })
        .whereNull('accepted_at')
        .delete()
      await logActivity(this.db, {
        resource: INVITATIONS,
        recordId: id,
        actorId,
        impersonatorId,
        action: 'invitation_delivery_failed',
        changes: { email },
      })
      throw new AdulaError(
        503,
        'E_INVITATION_DELIVERY',
        'تعذر إرسال الدعوة. تحقق من إعدادات البريد ثم أعد المحاولة.'
      )
    }
    await logActivity(this.db, {
      resource: INVITATIONS,
      recordId: id,
      actorId,
      impersonatorId,
      action: 'invitation_sent',
      changes: { email },
    })
    return { id, email }
  }

  async valid(token: string) {
    if (!/^[\w-]{43}$/.test(token)) return false
    return Boolean(
      await this.db('user_invitations')
        .where('token_hash', digest(token))
        .whereNull('accepted_at')
        .where('expires_at', '>', this.db.fn.now())
        .first('id')
    )
  }

  async accept(
    token: string,
    password: string,
    hashPassword: (password: string) => Promise<string>
  ) {
    if (!(await this.valid(token))) throw invalid()
    if (typeof password !== 'string' || password.length < 8 || password.length > 64)
      throw new AdulaError(422, 'E_PASSWORD', 'كلمة المرور من 8 إلى 64 حرفًا')
    const passwordHash = await hashPassword(password)
    return this.db.transaction(async (trx) => {
      const pending = await trx('user_invitations').where('token_hash', digest(token)).first()
      if (!pending) throw invalid()
      await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [pending.email])
      const row = await trx('user_invitations')
        .where({ id: pending.id, token_hash: digest(token) })
        .whereNull('accepted_at')
        .where('expires_at', '>', trx.fn.now())
        .forUpdate()
        .first()
      if (!row || (await trx('users').whereRaw('lower(email) = ?', [row.email]).first('id')))
        throw invalid()
      const [user] = await trx('users')
        .insert({
          email: row.email,
          full_name: row.full_name,
          password: passwordHash,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning('id')
      await trx('user_invitations').where('id', row.id).update({ accepted_at: trx.fn.now() })
      // No role or organizational membership can be supplied by either HTTP request.
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: user.id,
        actorId: user.id,
        action: 'invitation_accepted',
        changes: { invitedBy: row.invited_by },
      })
      return { id: user.id as number }
    })
  }
}
