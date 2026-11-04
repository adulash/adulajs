/**
 * Guided mail setup within ADR 020: credentials stay in the environment, nothing here writes
 * `.env`, and only variable names (never values) leave the server.
 */

/** The mail variables as read from the environment; tests pass their own. */
export type MailValues = {
  SMTP_HOST?: string
  SMTP_PORT?: number
  SMTP_SECURE?: boolean
  SMTP_REQUIRE_TLS?: boolean
  SMTP_USERNAME?: string
  SMTP_PASSWORD?: string
  MAIL_FROM_NAME?: string
  MAIL_FROM_ADDRESS?: string
  NODE_ENV?: string
}

/** SMTP transport options shared by config/mail.ts and the tests, so both see one mapping. */
export function smtpOptions(values: MailValues) {
  const user = values.SMTP_USERNAME
  const pass = values.SMTP_PASSWORD
  return {
    host: values.SMTP_HOST ?? '127.0.0.1',
    port: values.SMTP_PORT ?? 1025,
    secure: values.SMTP_SECURE ?? values.SMTP_PORT === 465,
    requireTLS: values.SMTP_REQUIRE_TLS ?? values.NODE_ENV === 'production',
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    ...(user && pass ? { auth: { type: 'login' as const, user, pass } } : {}),
  }
}

export type MailPreset = {
  id: string
  name: string
  host: string
  port: number
  secure: boolean
  /** Fixed SMTP username some providers require (e.g. SendGrid's `apikey`). */
  username?: string
  /** One sentence on the credential or host the provider expects. */
  note: string
}

/** Common providers; values from each provider's published SMTP settings. */
export const mailPresets: MailPreset[] = [
  {
    id: 'gmail',
    name: 'Gmail أو Google Workspace',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    note: 'فعّل التحقق بخطوتين في حساب Google، ثم أنشئ كلمة مرور تطبيق وضعها في SMTP_PASSWORD.',
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    note: 'إذا كان حسابك في مركز بيانات آخر فاستخدم الخادم الذي تذكره Zoho، مثل smtp.zoho.eu.',
  },
  {
    id: 'ses',
    name: 'Amazon SES',
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    secure: false,
    note: 'غيّر us-east-1 إلى منطقة SES لديك، واستخدم بيانات SMTP التي ينشئها SES لا مفاتيح IAM العادية.',
  },
  {
    id: 'mailgun',
    name: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: 587,
    secure: false,
    note: 'للحسابات في المنطقة الأوروبية استخدم smtp.eu.mailgun.org.',
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    username: 'apikey',
    note: 'اسم المستخدم هو apikey حرفيًا، وكلمة المرور مفتاح API من SendGrid.',
  },
  {
    id: 'custom',
    name: 'مزود آخر',
    host: '',
    port: 587,
    secure: false,
    note: 'اطلب من مزودك عنوان خادم SMTP والمنفذ ونوع التشفير.',
  },
]

/**
 * The environment lines for a preset. Secrets and sender details stay empty for the
 * administrator to fill; 587 uses STARTTLS (SMTP_REQUIRE_TLS) and 465 implicit TLS.
 */
export function presetEnvLines(preset: MailPreset) {
  return [
    `SMTP_HOST=${preset.host}`,
    `SMTP_PORT=${preset.port}`,
    `SMTP_SECURE=${preset.secure}`,
    ...(preset.secure ? [] : ['SMTP_REQUIRE_TLS=true']),
    `SMTP_USERNAME=${preset.username ?? ''}`,
    'SMTP_PASSWORD=',
    'MAIL_FROM_NAME=',
    'MAIL_FROM_ADDRESS=',
  ].join('\n')
}

/** What the mail dialog shows: variable names only, never their values. */
export type MailReadiness = {
  configured: boolean
  missing: string[]
  invalid: string[]
  warnings: ('development_default' | 'loopback_in_production' | 'port_security_mismatch')[]
}

const LOOPBACK = /^(127\.|localhost$|::1$)/i
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Production needs a host and a sender address; outside production the local relay default
 * (127.0.0.1:1025) is acceptable. A username without a password, or the reverse, is
 * incomplete everywhere. A loopback host in production is a warning, since a local relay is
 * a legitimate setup.
 */
export function mailReadiness(values: MailValues): MailReadiness {
  const production = values.NODE_ENV === 'production'
  const missing: string[] = []
  const invalid: string[] = []
  const warnings: MailReadiness['warnings'] = []
  if (production && !values.SMTP_HOST) missing.push('SMTP_HOST')
  if (production && !values.MAIL_FROM_ADDRESS) missing.push('MAIL_FROM_ADDRESS')
  if (values.SMTP_USERNAME && !values.SMTP_PASSWORD) missing.push('SMTP_PASSWORD')
  if (values.SMTP_PASSWORD && !values.SMTP_USERNAME) missing.push('SMTP_USERNAME')
  if (values.MAIL_FROM_ADDRESS && !ADDRESS.test(values.MAIL_FROM_ADDRESS))
    invalid.push('MAIL_FROM_ADDRESS')
  if (!production && !values.SMTP_HOST) warnings.push('development_default')
  if (production && values.SMTP_HOST && LOOPBACK.test(values.SMTP_HOST))
    warnings.push('loopback_in_production')
  if (
    (values.SMTP_PORT === 465 && values.SMTP_SECURE === false) ||
    (values.SMTP_PORT === 587 && values.SMTP_SECURE === true)
  )
    warnings.push('port_security_mismatch')
  return { configured: missing.length === 0 && invalid.length === 0, missing, invalid, warnings }
}
