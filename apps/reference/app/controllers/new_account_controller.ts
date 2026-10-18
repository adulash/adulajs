import User from '#models/user'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import { signupEnabled } from '#services/signup'

/** One answer for every accepted request, so the form never reveals who is registered. */
export const SIGNUP_ACCEPTED =
  'تم استلام طلب التسجيل. إن كان البريد متاحًا فقد أُنشئ حسابك ويمكنك تسجيل الدخول الآن؛ وإن كان مسجّلًا أو مدعوًّا مسبقًا فسجّل الدخول أو استخدم رابط الدعوة أو استعادة كلمة المرور.'

/** A closed signup behaves like a missing route. */
async function ensureOpen() {
  if (!(await signupEnabled()))
    throw new Exception('الصفحة غير موجودة', { status: 404, code: 'E_ROUTE_NOT_FOUND' })
}

export default class NewAccountController {
  async create({ inertia }: HttpContext) {
    await ensureOpen()
    return inertia.render('auth/signup', {})
  }

  async store(ctx: HttpContext) {
    const { request, response, session } = ctx
    await ensureOpen()
    const { passwordConfirmation, ...payload } = await request.validateUsing(signupValidator)
    const registered = await User.query()
      .whereRaw('lower(email) = lower(?)', [payload.email])
      .first()
    // A pending invitation reserves its address: only its link can create that account.
    const invited = await db
      .from('user_invitations')
      .whereRaw('lower(email) = lower(?)', [payload.email])
      .whereNull('accepted_at')
      .where('expires_at', '>', new Date())
      .select('id')
      .first()
    if (registered || invited) {
      // Same hashing cost as a creation; the existing account is never touched.
      await hash.make(payload.password)
    } else {
      try {
        // Self-signup does not prove e-mail ownership: emailVerifiedAt stays null.
        await User.create({ ...payload })
      } catch (error) {
        // A concurrent signup for the same address gets the same answer.
        if ((error as { code?: string }).code !== '23505') throw error
      }
    }
    // No automatic sign-in: signing in with the chosen password is the next step for everyone.
    session.flash('success', SIGNUP_ACCEPTED)
    return response.redirect().toRoute('session.create')
  }
}
