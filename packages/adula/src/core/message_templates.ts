import type { Knex } from 'knex'
import { AdulaError } from '../admin/errors.js'
import { targetColumns, type NotificationTarget } from '../services/settings.js'

export type TemplateDefinition = {
  label: string
  subject: string
  body: string
  /** Variables available as {{name}}; unknown placeholders are refused on edit. */
  variables: string[]
  /** Whether notifications from this template are also delivered by e-mail. */
  mail: boolean
}
export type MessageTemplate = TemplateDefinition & {
  key: string
  customized: boolean
  updatedAt: string | null
}
export type RenderedMessage = { subject: string; body: string; mail: boolean }

/**
 * Package-owned defaults. Projects edit wording in the message_templates table;
 * an upgrade can change a default without overwriting a project's edit.
 */
export const DEFAULT_TEMPLATES: Record<string, TemplateDefinition> = {
  'comment.mentioned': {
    label: 'إشارة في تعليق',
    subject: 'أشار إليك {{author}}',
    body: 'في {{resource}} #{{id}}: {{excerpt}}',
    variables: ['author', 'resource', 'id', 'excerpt'],
    mail: true,
  },
  'comment.created': {
    label: 'تعليق على سجل تتابعه',
    subject: 'تعليق جديد على {{resource}} #{{id}}',
    body: '{{author}}: {{excerpt}}',
    variables: ['author', 'resource', 'id', 'excerpt'],
    mail: false,
  },
  'record.changed': {
    label: 'تغيير سجل تتابعه',
    subject: '{{change}} {{resource}} #{{id}}',
    body: 'سجل تتابعه تغيّر.',
    variables: ['change', 'resource', 'id'],
    mail: false,
  },
  'assignment.created': {
    label: 'مهمة جديدة',
    subject: 'مهمة جديدة مسندة إليك',
    body: '{{title}} — {{resource}} #{{id}}',
    variables: ['title', 'resource', 'id', 'due'],
    mail: true,
  },
  'assignment.approval': {
    label: 'طلب موافقة',
    subject: 'موافقة مطلوبة منك',
    body: '{{title}} — {{resource}} #{{id}}',
    variables: ['title', 'resource', 'id', 'due'],
    mail: true,
  },
  'assignment.done': {
    label: 'إنجاز مهمة أسندتها',
    subject: 'أُنجزت مهمة أسندتها',
    body: '{{title}} — {{resource}} #{{id}}',
    variables: ['title', 'resource', 'id'],
    mail: false,
  },
  'assignment.cancelled': {
    label: 'إلغاء مهمة مسندة إليك',
    subject: 'أُلغيت مهمة مسندة إليك',
    body: '{{title}} — {{resource}} #{{id}}',
    variables: ['title', 'resource', 'id'],
    mail: false,
  },
  'workflow.decided': {
    label: 'نتيجة تدفق عمل',
    subject: '{{outcome}}: {{resource}} #{{id}}',
    body: '{{workflow}} — {{step}}',
    variables: ['outcome', 'resource', 'id', 'workflow', 'step'],
    mail: true,
  },
  'workflow.failed': {
    label: 'فشل خطوة تدفق',
    subject: 'فشلت خطوة في تدفق {{workflow}}',
    body: '{{resource}} #{{id}} — {{error}}',
    variables: ['workflow', 'resource', 'id', 'error'],
    mail: true,
  },
  'workflow.delegated': {
    label: 'تفويض موافقات إليك',
    subject: 'فوّض إليك {{delegator}} موافقاته',
    body: 'من {{from}} إلى {{to}}. تظهر الموافقات المفوّضة في مهامي.',
    variables: ['delegator', 'from', 'to'],
    mail: true,
  },
  'workflow.sla_due_soon': {
    label: 'اقتراب موعد موافقة',
    subject: 'يقترب موعد موافقة مطلوبة منك',
    body: '{{title}} — {{resource}} #{{id}}، الموعد {{due}}',
    variables: ['title', 'resource', 'id', 'due'],
    mail: true,
  },
  'workflow.sla_overdue': {
    label: 'تأخر موافقة',
    subject: 'تأخرت موافقة مطلوبة منك',
    body: '{{title}} — {{resource}} #{{id}}، كان الموعد {{due}}',
    variables: ['title', 'resource', 'id', 'due'],
    mail: true,
  },
  'workflow.sla_escalated': {
    label: 'تصعيد موافقة متأخرة',
    subject: 'صُعّدت إليك موافقة متأخرة',
    body: '{{title}} — {{resource}} #{{id}}، المكلّف {{assignee}}، كان الموعد {{due}}',
    variables: ['title', 'resource', 'id', 'assignee', 'due'],
    mail: true,
  },
  'webhook.failed': {
    label: 'تعطل Webhook',
    subject: 'تعذّر تسليم Webhook: {{name}}',
    body: '{{event}} — {{error}}',
    variables: ['name', 'event', 'error'],
    mail: true,
  },
  'import.finished': {
    label: 'اكتمال استيراد',
    subject: 'اكتمل استيراد {{resource}}',
    body: 'نجح {{created}} صفاً، وفشل {{failed}}.',
    variables: ['resource', 'created', 'failed'],
    mail: false,
  },
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g
const SUBJECT_LIMIT = 200
const BODY_LIMIT = 4000

export function renderTemplate(text: string, variables: Record<string, unknown>) {
  return text.replace(PLACEHOLDER, (_, name: string) => {
    const value = variables[name]
    return value === null || value === undefined ? '' : String(value)
  })
}

/** Message templates: package defaults plus per-deployment overrides edited by administrators. */
export class MessageTemplates {
  constructor(
    private db: Knex,
    private definitions: Record<string, TemplateDefinition> = DEFAULT_TEMPLATES
  ) {}

  async list(): Promise<MessageTemplate[]> {
    const rows = await this.db('message_templates').select('*')
    const overrides = new Map(rows.map((row) => [String(row.key), row]))
    return Object.entries(this.definitions).map(([key, definition]) => {
      const row = overrides.get(key)
      return {
        key,
        ...definition,
        subject: row ? String(row.subject) : definition.subject,
        body: row ? String(row.body) : definition.body,
        mail: row ? Boolean(row.mail) : definition.mail,
        customized: Boolean(row),
        updatedAt: row ? new Date(row.updated_at).toISOString() : null,
      }
    })
  }

  async render(
    key: string,
    variables: Record<string, unknown>,
    db: Knex = this.db
  ): Promise<RenderedMessage> {
    const definition = this.definition(key)
    const row = await db('message_templates').where('key', key).first()
    return {
      subject: renderTemplate(row ? String(row.subject) : definition.subject, variables).slice(
        0,
        255
      ),
      body: renderTemplate(row ? String(row.body) : definition.body, variables),
      mail: row ? Boolean(row.mail) : definition.mail,
    }
  }

  async update(
    key: string,
    input: { subject: unknown; body: unknown; mail?: unknown },
    actorId: number
  ) {
    const definition = this.definition(key)
    const subject = typeof input.subject === 'string' ? input.subject.trim() : ''
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (!subject || subject.length > SUBJECT_LIMIT)
      throw new AdulaError(422, 'E_TEMPLATE_SUBJECT', 'العنوان مطلوب ولا يتجاوز 200 حرف')
    if (!body || body.length > BODY_LIMIT)
      throw new AdulaError(422, 'E_TEMPLATE_BODY', 'نص الرسالة مطلوب ولا يتجاوز 4000 حرف')
    for (const text of [subject, body])
      for (const [, name] of text.matchAll(PLACEHOLDER))
        if (!definition.variables.includes(name))
          throw new AdulaError(422, 'E_TEMPLATE_VARIABLE', `متغير غير معروف في القالب: ${name}`)
    const mail = input.mail === undefined ? definition.mail : input.mail === true
    await this.db('message_templates')
      .insert({ key, subject, body, mail, updated_by: actorId, updated_at: this.db.fn.now() })
      .onConflict('key')
      .merge(['subject', 'body', 'mail', 'updated_by', 'updated_at'])
  }

  async reset(key: string) {
    this.definition(key)
    await this.db('message_templates').where('key', key).del()
  }

  /** Example output with sample values, for the editor preview. */
  preview(key: string, input: { subject: string; body: string }) {
    const definition = this.definition(key)
    const sample = Object.fromEntries(definition.variables.map((name) => [name, `‹${name}›`]))
    return {
      subject: renderTemplate(input.subject, sample),
      body: renderTemplate(input.body, sample),
    }
  }

  private definition(key: string) {
    const definition = Object.hasOwn(this.definitions, key) ? this.definitions[key] : undefined
    if (!definition) throw new AdulaError(404, 'E_TEMPLATE_NOT_FOUND', 'القالب غير موجود')
    return definition
  }
}

/**
 * Inserts a templated notification in the caller's transaction. Templates with
 * mail enabled mark the row for the mail delivery worker (deliverNotificationMail).
 */
export async function notifyWithTemplate(
  db: Knex,
  userId: number,
  key: string,
  variables: Record<string, unknown>,
  templates = new MessageTemplates(db),
  target?: NotificationTarget | null
) {
  const message = await templates.render(key, variables, db)
  await db('notifications').insert({
    user_id: userId,
    title: message.subject,
    body: message.body,
    template_key: key,
    mail_state: message.mail ? 'pending' : null,
    ...targetColumns(target),
  })
}

export type MailSender = (message: {
  to: string
  name: string | null
  subject: string
  text: string
  /** The record the notification is about; build an absolute link from the application URL. */
  target?: NotificationTarget | null
}) => Promise<void>

/**
 * Delivers pending notification e-mails. Rows are claimed with SKIP LOCKED so
 * several workers never send the same message; failures are retried three times.
 */
export async function deliverNotificationMail(db: Knex, send: MailSender, limit = 50) {
  let sent = 0
  let failed = 0
  await db.transaction(async (trx) => {
    const rows = await trx('notifications as n')
      .join('users as u', 'u.id', 'n.user_id')
      .where('n.mail_state', 'pending')
      .orderBy('n.id')
      .limit(limit)
      .forUpdate('n')
      .skipLocked()
      .select(
        'n.id',
        'n.title',
        'n.body',
        'n.mail_attempts',
        'n.resource',
        'n.record_id',
        'u.email',
        'u.full_name',
        'u.disabled_at'
      )
    for (const row of rows) {
      if (row.disabled_at) {
        await trx('notifications').where('id', row.id).update({ mail_state: 'skipped' })
        continue
      }
      try {
        await send({
          to: String(row.email),
          name: row.full_name ? String(row.full_name) : null,
          subject: String(row.title),
          text: String(row.body),
          target:
            row.resource && row.record_id !== null
              ? { resource: String(row.resource), recordId: Number(row.record_id) }
              : null,
        })
        await trx('notifications')
          .where('id', row.id)
          .update({ mail_state: 'sent', mailed_at: trx.fn.now() })
        sent++
      } catch (error) {
        const attempts = Number(row.mail_attempts ?? 0) + 1
        await trx('notifications')
          .where('id', row.id)
          .update({
            mail_state: attempts >= 3 ? 'failed' : 'pending',
            mail_attempts: attempts,
            mail_error: String((error as Error).message ?? error).slice(0, 500),
          })
        failed++
      }
    }
  })
  return { sent, failed }
}

export type NotificationSignal = { userId: number; id: number }

/**
 * Holds one database connection that LISTENs for committed notifications and
 * calls onSignal for each. Reconnects after connection loss. Returns a stop function.
 */
export function listenForNotifications(
  db: Knex,
  onSignal: (signal: NotificationSignal) => void,
  options: { retryMs?: number; onError?: (error: unknown) => void } = {}
) {
  let stopped = false
  let connection: any
  let timer: NodeJS.Timeout | undefined
  const connect = async () => {
    try {
      connection = await db.client.acquireConnection()
      connection.on('notification', (message: { channel: string; payload?: string }) => {
        if (message.channel !== 'adula_notifications' || !message.payload) return
        try {
          const parsed = JSON.parse(message.payload)
          if (Number.isSafeInteger(parsed.userId) && Number.isSafeInteger(parsed.id))
            onSignal({ userId: parsed.userId, id: parsed.id })
        } catch (error) {
          options.onError?.(error)
        }
      })
      connection.once('error', (error: unknown) => {
        options.onError?.(error)
        void reconnect()
      })
      await connection.query('LISTEN adula_notifications')
    } catch (error) {
      options.onError?.(error)
      void reconnect()
    }
  }
  const release = async () => {
    const current = connection
    connection = undefined
    if (!current) return
    current.removeAllListeners('notification')
    try {
      await current.query('UNLISTEN *')
    } catch {}
    // A broken connection is destroyed rather than returned to the pool.
    await db.client.releaseConnection(current).catch(() => {})
  }
  const reconnect = async () => {
    await release()
    if (stopped) return
    timer = setTimeout(() => void connect(), options.retryMs ?? 2000)
    timer.unref?.()
  }
  void connect()
  return async () => {
    stopped = true
    if (timer) clearTimeout(timer)
    await release()
  }
}
