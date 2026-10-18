import vine, { SimpleMessagesProvider } from '@vinejs/vine'

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().trim().toLowerCase().email().maxLength(254)
const password = () => vine.string().minLength(8).maxLength(64)
export const invitationValidator = vine.create({
  fullName: vine.string().trim().minLength(1).maxLength(120),
  email: vine.string().trim().email().maxLength(254),
})
const invitationMessages = new SimpleMessagesProvider({
  required: 'هذا الحقل مطلوب',
  string: 'أدخل قيمة نصية صحيحة',
  email: 'أدخل بريدًا إلكترونيًا صحيحًا',
  minLength: 'عدد الأحرف أقل من الحد المطلوب ({{ min }})',
  maxLength: 'عدد الأحرف يتجاوز الحد المسموح ({{ max }})',
  confirmed: 'يجب أن تتطابق كلمتا المرور',
})
invitationValidator.messagesProvider = invitationMessages

export const acceptInvitationValidator = vine.create({
  password: password().confirmed({ confirmationField: 'passwordConfirmation' }),
  passwordConfirmation: vine.string(),
})
acceptInvitationValidator.messagesProvider = invitationMessages

/**
 * Validator to use when performing self-signup.
 *
 * The "passwordConfirmation" field is declared explicitly, so that it is part
 * of the request body type shared with the frontend. Otherwise the signup form
 * has no way to know about the errors reported for this field.
 */
export const signupValidator = vine.create({
  fullName: vine.string().nullable(),
  // No uniqueness rule: a taken address gets the same answer as a new one (the controller decides).
  email: email(),
  password: password().confirmed({
    confirmationField: 'passwordConfirmation',
  }),
  passwordConfirmation: vine.string(),
})

/**
 * Validator to use when logging in an existing user
 */
export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
})

/**
 * Validator for requesting a password-recovery e-mail.
 */
export const forgotPasswordValidator = vine.create({
  email: email(),
})

/**
 * Validator for choosing a new password from a recovery link.
 */
export const resetPasswordValidator = vine.create({
  password: password().confirmed({
    confirmationField: 'passwordConfirmation',
  }),
  passwordConfirmation: vine.string(),
})

/**
 * Validator for the self-service profile form.
 */
export const profileValidator = vine.create({
  fullName: vine.string().trim().minLength(2).maxLength(120),
})

/**
 * Validator for changing the password of the signed-in user. The current
 * password is verified by the controller against the stored hash.
 */
export const changePasswordValidator = vine.create({
  currentPassword: vine.string(),
  password: password().confirmed({
    confirmationField: 'passwordConfirmation',
  }),
  passwordConfirmation: vine.string(),
})
