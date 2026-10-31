import vine, { SimpleMessagesProvider } from '@vinejs/vine'
import { SOCIAL_PROVIDER_NAMES } from '#services/social_accounts'

/** PUT /admin/settings/authentication */
export const authenticationSettingsValidator = vine.create({
  disabledProviders: vine.array(vine.enum(SOCIAL_PROVIDER_NAMES)).distinct(),
  twoFactorRequiredForAdministrators: vine.boolean({ strict: true }),
})
authenticationSettingsValidator.messagesProvider = new SimpleMessagesProvider({
  required: 'هذا الحقل مطلوب',
  array: 'أرسل قائمة بأسماء المزوّدين',
  enum: 'مزوّد غير معروف',
  distinct: 'لا تكرر المزوّد نفسه',
  boolean: 'أرسل قيمة صحيحة أو خاطئة',
})
