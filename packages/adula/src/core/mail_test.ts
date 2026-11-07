import { randomUUID } from 'node:crypto'
import type { Knex } from 'knex'
import { AdulaError } from '../admin/errors.js'
import { arabicMessages } from '../languages/ar.js'
import { Settings } from '../services/settings.js'
import { logActivity } from './activity.js'

export const MAIL_TEST_KEY = 'mail.delivery_test'
export type MailTestState = {
  id: string
  recipient: string
  fingerprint: string
  status: 'sending' | 'pending' | 'confirmed' | 'not_received' | 'failed'
  requestedAt: string
  answeredAt?: string
}

/** Why a test message was refused, in terms an administrator can act on. */
export type MailFailureReason =
  | 'authentication'
  | 'connection'
  | 'host_not_found'
  | 'tls'
  | 'timeout'
  | 'sender_rejected'
  | 'recipient_rejected'
  | 'password_unreadable'
  | 'unknown'

/** A transport failure reduced to non-secret facts: never the raw message or credentials. */
export type MailFailure = {
  reason: MailFailureReason
  code?: string
  responseCode?: number
  command?: string
}

// SMTP commands safe to record; anything else (e.g. an AUTH payload) is dropped.
const COMMANDS = new Set([
  'CONN',
  'EHLO',
  'HELO',
  'STARTTLS',
  'AUTH PLAIN',
  'AUTH LOGIN',
  'AUTH XOAUTH2',
  'MAIL FROM',
  'RCPT TO',
  'DATA',
  'API',
])

// One fixed catalog sentence per reason (ADR 041), so every language can translate it.
const failureMessage = (reason: MailFailureReason) =>
  reason === 'unknown'
    ? arabicMessages['errors.E_MAIL_TEST_SEND']
    : arabicMessages[`errors.E_MAIL_TEST_SEND.${reason}`]

function errorChain(error: unknown) {
  const chain: Record<string, unknown>[] = []
  let current = error
  while (current && typeof current === 'object' && chain.length < 5) {
    chain.push(current as Record<string, unknown>)
    current = (current as { cause?: unknown }).cause
  }
  return chain
}

/**
 * Maps an SMTP transport error (nodemailer's `code`, `responseCode` and `command`, also
 * through `cause`) to a reason. Only the reason, the error code, the SMTP response code and
 * an allow-listed command survive; the message, which can echo server text, is read here
 * only to recognise TLS handshake failures and is never returned.
 */
export function classifyMailFailure(error: unknown): MailFailure {
  const chain = errorChain(error)
  const pick = <T>(read: (entry: Record<string, unknown>) => T | undefined) =>
    chain.map(read).find((value) => value !== undefined)
  const code = pick((entry) => (typeof entry.code === 'string' ? entry.code : undefined))
  const codes = chain.map((entry) => entry.code).filter((value) => typeof value === 'string')
  const responseCode = pick((entry) =>
    typeof entry.responseCode === 'number' ? entry.responseCode : undefined
  )
  const rawCommand = pick((entry) =>
    typeof entry.command === 'string' ? entry.command.toUpperCase() : undefined
  )
  const command = rawCommand && COMMANDS.has(rawCommand) ? rawCommand : undefined
  const tlsText = chain.some(
    (entry) =>
      typeof entry.message === 'string' &&
      /wrong version number|ssl routines|tls|certificate/i.test(entry.message)
  )
  const has = (...names: string[]) => codes.some((value) => names.includes(value as string))
  const reason: MailFailureReason = has('E_MAIL_PASSWORD_UNREADABLE')
    ? 'password_unreadable'
    : has('EAUTH', 'ENOAUTH') ||
        responseCode === 535 ||
        responseCode === 534 ||
        responseCode === 530
      ? 'authentication'
      : has('EENVELOPE') || command === 'MAIL FROM' || command === 'RCPT TO'
        ? command === 'RCPT TO'
          ? 'recipient_rejected'
          : 'sender_rejected'
        : has('ENOTFOUND', 'EAI_AGAIN', 'EDNS')
          ? 'host_not_found'
          : has('ETLS') ||
              codes.some((value) => /^ERR_(SSL|TLS)_|^EPROTO$/.test(value as string)) ||
              tlsText
            ? 'tls'
            : has('ETIMEDOUT', 'ETIMEOUT', 'ESOCKETTIMEDOUT', 'EGREETING')
              ? 'timeout'
              : has('ECONNREFUSED', 'ECONNECTION', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH')
                ? 'connection'
                : 'unknown'
  return {
    reason,
    ...(code && /^[A-Z_0-9]{2,40}$/.test(code) ? { code } : {}),
    ...(responseCode !== undefined ? { responseCode } : {}),
    ...(command ? { command } : {}),
  }
}

/** Receipt is an administrator attestation, never inferred from SMTP acceptance. */
export class MailDeliveryTest {
  constructor(private db: Knex) {}

  async current(actorId: number, recipient: string, fingerprint: string) {
    const state = await new Settings(this.db).get<MailTestState>(
      MAIL_TEST_KEY,
      'user',
      String(actorId)
    )
    return state?.recipient === recipient && state.fingerprint === fingerprint ? state : null
  }

  async send(
    actorId: number,
    recipient: string,
    fingerprint: string,
    deliver: (id: string) => Promise<void>
  ) {
    const state: MailTestState = {
      id: randomUUID(),
      recipient,
      fingerprint,
      status: 'sending',
      requestedAt: new Date().toISOString(),
    }
    await this.db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [717012, actorId])
      const previous = await new Settings(trx).get<MailTestState>(
        MAIL_TEST_KEY,
        'user',
        String(actorId)
      )
      const cooldown = previous?.status === 'sending' ? 300_000 : 60_000
      if (previous && Date.now() - Date.parse(previous.requestedAt) < cooldown)
        throw new AdulaError(
          429,
          'E_MAIL_TEST_COOLDOWN',
          'انتظر قليلًا قبل إعادة إرسال البريد التجريبي'
        )
      await new Settings(trx).set(MAIL_TEST_KEY, state, 'user', String(actorId))
      await logActivity(trx, {
        resource: 'core.mail',
        recordId: actorId,
        actorId,
        action: 'test_requested',
        changes: { testId: state.id },
      })
    })
    let failure: MailFailure | null = null
    try {
      await deliver(state.id)
    } catch (error) {
      failure = classifyMailFailure(error)
    }
    const failed = failure !== null
    // Match the attempt so a delayed response cannot overwrite a newer test.
    await this.db.transaction(async (trx) => {
      await trx('settings')
        .where({ key: MAIL_TEST_KEY, scope: 'user', scope_id: String(actorId) })
        .whereRaw("value->>'id' = ?", [state.id])
        .update({ value: JSON.stringify({ ...state, status: failed ? 'failed' : 'pending' }) })
      await logActivity(trx, {
        resource: 'core.mail',
        recordId: actorId,
        actorId,
        action: failed ? 'test_send_failed' : 'test_send_accepted',
        changes: failure ? { testId: state.id, ...failure } : { testId: state.id },
      })
    })
    if (failure) throw new AdulaError(502, 'E_MAIL_TEST_SEND', failureMessage(failure.reason))
  }

  async answer(
    actorId: number,
    recipient: string,
    fingerprint: string,
    id: unknown,
    received: unknown
  ) {
    if (typeof received !== 'boolean' || typeof id !== 'string')
      throw new AdulaError(422, 'E_MAIL_TEST_ANSWER', 'اختر هل وصلت الرسالة أم لم تصل')
    await this.db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [717012, actorId])
      const state = await new MailDeliveryTest(trx).current(actorId, recipient, fingerprint)
      if (
        !state ||
        state.id !== id ||
        state.status !== 'pending' ||
        Date.now() - Date.parse(state.requestedAt) > 86_400_000
      )
        throw new AdulaError(
          409,
          'E_MAIL_TEST_STALE',
          'هذه التجربة لم تعد قابلة للتأكيد. أرسل رسالة تجريبية جديدة.'
        )
      await new Settings(trx).set(
        MAIL_TEST_KEY,
        {
          ...state,
          status: received ? 'confirmed' : 'not_received',
          answeredAt: new Date().toISOString(),
        },
        'user',
        String(actorId)
      )
      await logActivity(trx, {
        resource: 'core.mail',
        recordId: actorId,
        actorId,
        action: received ? 'receipt_confirmed' : 'receipt_missing',
        changes: { testId: state.id },
      })
    })
  }
}
