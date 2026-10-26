import type { HttpContext } from '@adonisjs/core/http'
import { adula } from '#services/adula'
import { acting } from '#services/impersonation'
import { mutate, positiveId, wantsJson } from '#controllers/admin/support'

/**
 * Out-of-office delegation of workflow approvals (ADR 044): users manage their own
 * delegation in the account area; administrators manage anyone's under /admin.
 */
export default class DelegationsController {
  async index(ctx: HttpContext) {
    const delegations = await adula().delegations.forUser(ctx.auth.getUserOrFail().id)
    if (wantsJson(ctx)) return { data: delegations }
    return ctx.inertia.render('account/delegations', { delegations })
  }

  /** Active users to choose a delegate from, by name or e-mail. */
  async candidates(ctx: HttpContext) {
    return {
      data: await adula().delegations.candidates(
        ctx.request.input('q'),
        ctx.auth.getUserOrFail().id
      ),
    }
  }

  async store(ctx: HttpContext) {
    const userId = ctx.auth.getUserOrFail().id
    return mutate(
      ctx,
      () =>
        adula().delegations.create(
          {
            delegatorId: userId,
            delegateId: ctx.request.input('delegateId'),
            startsOn: ctx.request.input('startsOn'),
            endsOn: ctx.request.input('endsOn'),
            note: ctx.request.input('note'),
          },
          acting(ctx)
        ),
      'تم حفظ التفويض'
    )
  }

  async destroy(ctx: HttpContext) {
    return mutate(
      ctx,
      () =>
        adula().delegations.revoke(positiveId(ctx.params.id), ctx.auth.getUserOrFail().id, {
          actorId: acting(ctx),
        }),
      'تم إلغاء التفويض'
    )
  }

  async adminIndex(ctx: HttpContext) {
    const delegations = await adula().delegations.current()
    if (wantsJson(ctx)) return { data: delegations }
    return ctx.inertia.render('admin/delegations/index', { delegations })
  }

  async adminCandidates(ctx: HttpContext) {
    return { data: await adula().delegations.candidates(ctx.request.input('q'), 0) }
  }

  async adminStore(ctx: HttpContext) {
    return mutate(
      ctx,
      () =>
        adula().delegations.create(
          {
            delegatorId: positiveId(ctx.request.input('delegatorId'), 'اختر صاحب الموافقات'),
            delegateId: ctx.request.input('delegateId'),
            startsOn: ctx.request.input('startsOn'),
            endsOn: ctx.request.input('endsOn'),
            note: ctx.request.input('note'),
          },
          acting(ctx)
        ),
      'تم حفظ التفويض'
    )
  }

  async adminDestroy(ctx: HttpContext) {
    return mutate(
      ctx,
      () => adula().delegations.revoke(positiveId(ctx.params.id), acting(ctx), { any: true }),
      'تم إلغاء التفويض'
    )
  }
}
