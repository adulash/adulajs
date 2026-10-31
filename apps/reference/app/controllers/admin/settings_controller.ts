import type { HttpContext } from '@adonisjs/core/http'
import {
  AdulaError,
  SETTING_SCOPES,
  SettingsAdmin,
  parseSettingValue,
  type SettingScope,
} from 'adula'
import { actorId, knex, mutate, positiveId, text, wantsJson } from './support.js'
import {
  mailTest,
  mailFingerprint,
  sendMailTest,
  publicMailTest,
} from '#services/mail_delivery_test'
import { authenticationSettings } from './authentication_settings_controller.js'
import { adula } from '#services/adula'

function scopeOf(value: unknown): SettingScope {
  const scope = text(value) ?? 'system'
  if (!SETTING_SCOPES.includes(scope as SettingScope))
    throw new AdulaError(422, 'E_SETTING_SCOPE', 'النطاق غير معروف')
  return scope as SettingScope
}

export default class SettingsController {
  async index(ctx: HttpContext) {
    const scope = scopeOf(ctx.request.input('scope'))
    const scopeId = scope === 'system' ? '0' : (text(ctx.request.input('scopeId')) ?? '')
    const settings =
      scope === 'system' || /^\d{1,18}$/.test(scopeId)
        ? await new SettingsAdmin(knex()).list(scope, scopeId)
        : []
    if (wantsJson(ctx)) return { data: settings, scope, scopeId }
    const user = ctx.auth.getUserOrFail()
    const state = await mailTest().current(user.id, user.email, mailFingerprint())
    return ctx.inertia.render('admin/settings/index', {
      settings,
      scope,
      scopeId,
      mailTest: publicMailTest(state),
      mailRecipient: user.email,
      authentication: await authenticationSettings(),
      messagingChannel: await adula().channelSettings.read(),
    })
  }

  async testMail(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    return mutate(
      ctx,
      () =>
        mailTest().send(user.id, user.email, mailFingerprint(), (id) =>
          sendMailTest(user.email, id)
        ),
      'قُبل طلب الإرسال. تحقق من بريدك وأكد وصول الرسالة.',
      ctx.request.input('returnTo') === 'setup' ? '/admin/setup' : '/admin/settings'
    )
  }

  async confirmMail(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    return mutate(
      ctx,
      () =>
        mailTest().answer(
          user.id,
          user.email,
          mailFingerprint(),
          ctx.request.input('id'),
          ctx.request.input('received')
        ),
      ctx.request.input('received') === true
        ? 'تم تسجيل تأكيدك بوصول الرسالة'
        : 'تم تسجيل عدم وصول الرسالة. راجع البريد غير المرغوب وإعدادات البريد.',
      ctx.request.input('returnTo') === 'setup' ? '/admin/setup' : '/admin/settings'
    )
  }

  async upsert(ctx: HttpContext) {
    return mutate(
      ctx,
      () => {
        const raw = ctx.request.input('value')
        return new SettingsAdmin(knex()).upsert(actorId(ctx), {
          key: ctx.request.input('key'),
          scope: scopeOf(ctx.request.input('scope')),
          scopeId: text(ctx.request.input('scopeId')),
          value: typeof raw === 'string' ? parseSettingValue(raw) : raw,
        })
      },
      'تم حفظ الإعداد'
    )
  }

  async destroy(ctx: HttpContext) {
    return mutate(
      ctx,
      () => new SettingsAdmin(knex()).delete(actorId(ctx), positiveId(ctx.params.id)),
      'تم حذف الإعداد'
    )
  }

  /**
   * The SMS/WhatsApp provider section. JSON only: a generated signing secret is
   * returned in this response once and never again.
   */
  async updateChannel(ctx: HttpContext) {
    const { config, secret } = await adula().channelSettings.save(actorId(ctx), {
      enabled: ctx.request.input('enabled'),
      kind: ctx.request.input('kind'),
      url: ctx.request.input('url'),
    })
    return { data: { config, secret } }
  }

  async rotateChannel(ctx: HttpContext) {
    const { config, secret } = await adula().channelSettings.rotate(actorId(ctx))
    return { data: { config, secret } }
  }

  /** Sends one test message; answers with the failure category, never the provider's body. */
  async testChannel(ctx: HttpContext) {
    const error = await adula().channelSettings.test(ctx.request.input('to'))
    return { data: { sent: error === null, error } }
  }
}
