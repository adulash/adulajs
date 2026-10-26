/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'
import transmit from '@adonisjs/transmit/services/main'
import db from '@adonisjs/lucid/services/db'
import { Settings } from 'adula'
import redis from '@adonisjs/redis/services/main'
import {
  apiThrottle,
  channelChangeThrottle,
  channelCodeThrottle,
  channelTestThrottle,
  exportThrottle,
  healthThrottle,
  inboundThrottle,
  inboundAddressThrottle,
  loginAddressThrottle,
  loginThrottle,
  oauthThrottle,
  passwordChangeThrottle,
  passwordThrottle,
  signupThrottle,
  twoFactorManageThrottle,
  twoFactorThrottle,
} from '#start/limiter'
const ResourcesController = () => import('#controllers/resources_controller')
const RecordViewsController = () => import('#controllers/record_views_controller')
const AttachmentsController = () => import('#controllers/attachments_controller')
const SavedViewsController = () => import('#controllers/saved_views_controller')
const AssignmentsController = () => import('#controllers/assignments_controller')
const ApiTokensController = () => import('#controllers/api_tokens_controller')
const OpenApiController = () => import('#controllers/openapi_controller')
const PrintController = () => import('#controllers/print_controller')
const ImportsController = () => import('#controllers/imports_controller')
const WorkflowsController = () => import('#controllers/workflows_controller')
const DelegationsController = () => import('#controllers/delegations_controller')
const RecordCollaborationController = () => import('#controllers/record_collaboration_controller')
const PasswordResetController = () => import('#controllers/password_reset_controller')
const UserInvitationsController = () => import('#controllers/user_invitations_controller')
const OauthController = () => import('#controllers/oauth_controller')
const ProfileController = () => import('#controllers/profile_controller')
const LanguageController = () => import('#controllers/language_controller')
const TwoFactorController = () => import('#controllers/two_factor_controller')
const TwoFactorChallengeController = () => import('#controllers/two_factor_challenge_controller')
const AccountSessionsController = () => import('#controllers/account_sessions_controller')
const AdminSessionsController = () => import('#controllers/admin_sessions_controller')
const AdminUsersController = () => import('#controllers/admin/users_controller')
const AdminRolesController = () => import('#controllers/admin/roles_controller')
const AdminOrgUnitsController = () => import('#controllers/admin/org_units_controller')
const AdminActivityController = () => import('#controllers/admin/activity_controller')
const AdminJobsController = () => import('#controllers/admin/jobs_controller')
const AdminSettingsController = () => import('#controllers/admin/settings_controller')
const AdminAuthenticationSettingsController = () =>
  import('#controllers/admin/authentication_settings_controller')
const SetupController = () => import('#controllers/admin/setup_controller')
const NotificationsController = () => import('#controllers/admin/notifications_controller')
const AdminTemplatesController = () => import('#controllers/admin/templates_controller')
const AdminWebhooksController = () => import('#controllers/admin/webhooks_controller')
const AdminLookupsController = () => import('#controllers/admin/lookups_controller')
const AdminSequencesController = () => import('#controllers/admin/sequences_controller')
const InboundWebhooksController = () => import('#controllers/inbound_webhooks_controller')
const DashboardsController = () => import('#controllers/dashboards_controller')

router.on('/').renderInertia('home', {}).as('home')

// Realtime notification signals: every Transmit route requires a signed-in user.
transmit.registerRoutes((route) => {
  route.middleware(middleware.auth())
  // Upstream controllers throw (500) on missing input; answer 400 before they run.
  const needsChannel = route.getPattern() !== '__transmit/events'
  route.middleware(async (ctx, next) => {
    const uid = String(ctx.request.input('uid') ?? '')
    const channel = ctx.request.input('channel')
    if (
      !/^[\w-]{8,64}$/.test(uid) ||
      (needsChannel && (typeof channel !== 'string' || !/^[\w/-]{1,120}$/.test(channel)))
    )
      return ctx.response.badRequest({
        error: { code: 'E_STREAM_REQUEST', message: 'طلب الاتصال الفوري غير صالح' },
      })
    return next()
  })
})

router.mcp().use([middleware.auth(), apiThrottle, middleware.mcp()])

// Signed inbound webhooks: no session or CSRF; the source secret authenticates (#30).
router
  .post('/webhooks/in/:source', [InboundWebhooksController, 'receive'])
  .use([inboundAddressThrottle, inboundThrottle])

router
  .get('/health', async ({ response }) => {
    try {
      await db.rawQuery('SELECT 1')
      await Promise.race([
        redis.ping(),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Redis unavailable')), 2000)
          timer.unref()
        }),
      ])
      const lastOffsite = await new Settings(db.connection().getWriteClient()).get<string>(
        'backup.lastOffsite'
      )
      // Public probe: status only. Backup times and dependencies are on the admin jobs screen.
      return {
        status:
          lastOffsite && Date.now() - Date.parse(lastOffsite) < 48 * 3600000 ? 'ok' : 'degraded',
      }
    } catch {
      return response.serviceUnavailable({ status: 'unhealthy' })
    }
  })
  .use(healthThrottle)

router
  .group(() => {
    router.get('/resources/:resource', [ResourcesController, 'index'])
    router.get('/resources/:resource/create', [ResourcesController, 'create'])
    router.get('/resources/:resource/options/:field', [ResourcesController, 'options'])
    router.get('/resources/:resource/aggregate', [ResourcesController, 'aggregate'])
    // List layer (ADR 046): declared before the /resources/:resource/:id patterns.
    router.get('/resources/:resource/export', [ResourcesController, 'export']).use(exportThrottle)
    router.get('/resources/:resource/trash', [ResourcesController, 'trash'])
    router.get('/resources/:resource/bulk', [ResourcesController, 'bulkActions'])
    router.post('/resources/:resource/bulk', [ResourcesController, 'bulk'])
    router.post('/resources/:resource/:id/restore', [ResourcesController, 'restore'])
    router.get('/dashboards', [DashboardsController, 'index'])
    router.get('/dashboards/:name', [DashboardsController, 'show'])
    router.post('/resources/:resource/imports', [ImportsController, 'store'])
    router.get('/resources/:resource/imports/template', [ImportsController, 'template'])
    router.get('/imports', [ImportsController, 'index'])
    router.get('/imports/:id', [ImportsController, 'show'])
    router.post('/imports/:id/start', [ImportsController, 'start'])
    router.get('/resources/:resource/tag-options', [RecordCollaborationController, 'tagOptions'])
    router.get('/resources/:resource/:id/collaboration', [RecordCollaborationController, 'show'])
    router.get('/resources/:resource/:id/mentions', [RecordCollaborationController, 'mentions'])
    router.post('/resources/:resource/:id/comments', [RecordCollaborationController, 'comment'])
    router.patch('/resources/:resource/:id/comments/:comment', [
      RecordCollaborationController,
      'editComment',
    ])
    router.delete('/resources/:resource/:id/comments/:comment', [
      RecordCollaborationController,
      'deleteComment',
    ])
    router.put('/resources/:resource/:id/follow', [RecordCollaborationController, 'follow'])
    router.put('/resources/:resource/:id/tags', [RecordCollaborationController, 'tags'])
    router.get('/resources/:resource/:id/print', [PrintController])
    router.get('/resources/:resource/:id/assignments', [AssignmentsController, 'forRecord'])
    router.post('/resources/:resource/:id/assignments', [AssignmentsController, 'store'])
    router.get('/resources/:resource/:id/workflows', [WorkflowsController, 'forRecord'])
    router.get('/approvals', [WorkflowsController, 'inbox'])
    router.post('/workflows/:run/decide', [WorkflowsController, 'decide'])
    router.get('/my-tasks', [AssignmentsController, 'mine'])
    router.post('/my-tasks/:assignment/complete', [AssignmentsController, 'complete'])
    router.post('/my-tasks/:assignment/cancel', [AssignmentsController, 'cancel'])
    router.get('/resources/:resource/:id/view', [RecordViewsController, 'show'])
    router.get('/resources/:resource/:id/edit', [ResourcesController, 'edit'])
    router.get('/resources/:resource/:id', [ResourcesController, 'show'])
    router.post('/resources/:resource', [ResourcesController, 'store'])
    router.patch('/resources/:resource/:id', [ResourcesController, 'update'])
    router.delete('/resources/:resource/:id', [ResourcesController, 'destroy'])
    router.post('/resources/:resource/:id/submit', [ResourcesController, 'submit'])
    router.post('/resources/:resource/:id/cancel', [ResourcesController, 'cancel'])
    router.post('/resources/:resource/:id/amend', [ResourcesController, 'amend'])
    router.post('/resources/:resource/views', [SavedViewsController, 'store'])
    router.delete('/resources/:resource/views/:id', [SavedViewsController, 'destroy'])
    router.post('/attachments', [AttachmentsController, 'store'])
    router.get('/attachments/:id', [AttachmentsController, 'show'])
  })
  .use([middleware.auth(), apiThrottle])

// Bearer-token resource API: the same ResourceService authorization as the UI.
router
  .group(() => {
    router.get('openapi.json', [OpenApiController])
    router.get('client.ts', [OpenApiController, 'client'])
    router.get('client.d.ts', [OpenApiController, 'declarations'])
    router.get('resources/:resource', [ResourcesController, 'index'])
    router.get('resources/:resource/aggregate', [ResourcesController, 'aggregate'])
    router.get('imports', [ImportsController, 'index'])
    router.get('imports/:id', [ImportsController, 'show'])
    router.post('imports/:id/start', [ImportsController, 'start'])
    router.post('resources/:resource/imports', [ImportsController, 'store'])
    router.get('resources/:resource/imports/template', [ImportsController, 'template'])
    router.get('resources/:resource/export', [ResourcesController, 'export']).use(exportThrottle)
    router.get('resources/:resource/trash', [ResourcesController, 'trash'])
    router.get('resources/:resource/bulk', [ResourcesController, 'bulkActions'])
    router.post('resources/:resource/bulk', [ResourcesController, 'bulk'])
    router.post('resources/:resource/:id/restore', [ResourcesController, 'restore'])
    router.get('resources/:resource/:id', [ResourcesController, 'show'])
    router.post('resources/:resource', [ResourcesController, 'store'])
    router.patch('resources/:resource/:id', [ResourcesController, 'update'])
    router.delete('resources/:resource/:id', [ResourcesController, 'destroy'])
    router.post('resources/:resource/:id/submit', [ResourcesController, 'submit'])
    router.post('resources/:resource/:id/cancel', [ResourcesController, 'cancel'])
    router.post('resources/:resource/:id/amend', [ResourcesController, 'amend'])
  })
  .prefix('api/v1')
  .as('api')
  .use([middleware.apiAuth(), apiThrottle])

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.get('invitations/:token', [UserInvitationsController, 'show'])
    router.post('invitations/:token', [UserInvitationsController, 'accept']).use(passwordThrottle)
    router.post('signup', [controllers.NewAccount, 'store']).use(signupThrottle)

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store']).use([loginAddressThrottle, loginThrottle])
    router
      .get('login/two-factor', [TwoFactorChallengeController, 'create'])
      .as('two_factor.challenge')
    router
      .post('login/two-factor', [TwoFactorChallengeController, 'store'])
      .as('two_factor.verify')
      .use([loginAddressThrottle, twoFactorThrottle])

    router.get('password/forgot', [PasswordResetController, 'forgot'])
    router.post('password/forgot', [PasswordResetController, 'send']).use(passwordThrottle)
    router.get('password/reset/:token', [PasswordResetController, 'reset'])
    router.post('password/reset/:token', [PasswordResetController, 'update']).use(passwordThrottle)

    router.get('oauth/:provider/redirect', [OauthController, 'redirect']).use(oauthThrottle)
  })
  .use(middleware.guest())

// Outside the guest group: a signed-in user returns here after linking an identity.
// Global silent auth has already resolved the user; the controller handles both cases.
router.get('oauth/:provider/callback', [OauthController, 'callback']).use(oauthThrottle)

router
  .group(() => {
    router.post('logout', [controllers.Session, 'destroy'])
    router.get('users/invite', [UserInvitationsController, 'create'])
    router.post('users/invite', [UserInvitationsController, 'store']).use(apiThrottle)

    router.get('account/profile', [ProfileController, 'show'])
    router.patch('account/profile', [ProfileController, 'update'])
    router.post('account/password', [ProfileController, 'password']).use(passwordChangeThrottle)
    router.put('account/language', [LanguageController, 'update'])
    router
      .put('account/notification-channels', [ProfileController, 'channels'])
      .use(channelChangeThrottle)
    router
      .post('account/notification-channels/:key/code', [ProfileController, 'channelCode'])
      .use(channelCodeThrottle)
    router
      .post('account/notification-channels/:key/confirm', [ProfileController, 'channelConfirm'])
      .use(channelChangeThrottle)
    router
      .post('account/two-factor/begin', [TwoFactorController, 'begin'])
      .use(passwordChangeThrottle)
    router
      .post('account/two-factor/confirm', [TwoFactorController, 'confirm'])
      .use(passwordChangeThrottle)
    router
      .post('account/two-factor/recovery-codes', [TwoFactorController, 'regenerate'])
      .use(twoFactorManageThrottle)
    router
      .delete('account/two-factor', [TwoFactorController, 'destroy'])
      .use(twoFactorManageThrottle)
    // Out-of-office delegation of workflow approvals (ADR 044).
    router.get('account/delegations', [DelegationsController, 'index'])
    router.get('account/delegations/candidates', [DelegationsController, 'candidates'])
    router.post('account/delegations', [DelegationsController, 'store'])
    router.delete('account/delegations/:id', [DelegationsController, 'destroy'])
    router.get('account/tokens', [ApiTokensController, 'index'])
    router.post('account/tokens', [ApiTokensController, 'store']).use(apiThrottle)
    router.delete('account/tokens/:id', [ApiTokensController, 'destroy'])
    router.get('account/sessions', [AccountSessionsController, 'index'])
    router.delete('account/sessions', [AccountSessionsController, 'purge'])
    router.delete('account/sessions/:id', [AccountSessionsController, 'destroy'])
    // A stale session confirms the password here, so password guesses share its throttle.
    router
      .post('account/connections/:provider', [OauthController, 'link'])
      .use([oauthThrottle, passwordChangeThrottle])
    router.delete('account/connections/:provider', [OauthController, 'unlink'])

    router.get('admin/sessions', [AdminSessionsController, 'index'])
    router.delete('admin/sessions/:id', [AdminSessionsController, 'destroy'])
  })
  .use(middleware.auth())

router
  .group(() => {
    router.get('notifications', [NotificationsController, 'index'])
    router.post('notifications/read-all', [NotificationsController, 'readAll'])
    router.post('notifications/:id/read', [NotificationsController, 'read'])
    router.get('notifications/:id/open', [NotificationsController, 'open'])
    router.post('impersonation/stop', [AdminUsersController, 'stopImpersonation'])
  })
  .use(middleware.auth())

router
  .group(() => {
    // The single administration entry opens the one-time setup until it is complete.
    router.get('/', async ({ response }) => {
      const { setupPending } = await import('#services/initial_setup')
      return response.redirect((await setupPending()) ? '/admin/setup' : '/admin/users')
    })
    router.get('users', [AdminUsersController, 'index'])
    router.get('users/:id', [AdminUsersController, 'show'])
    router.post('users/:id/roles', [AdminUsersController, 'assignRole'])
    router.delete('users/:id/roles/:assignment', [AdminUsersController, 'removeRole'])
    router.post('users/:id/org-units', [AdminUsersController, 'assignOrgUnit'])
    router.delete('users/:id/org-units/:orgUnit', [AdminUsersController, 'removeOrgUnit'])
    router.post('users/:id/disable', [AdminUsersController, 'disable'])
    router.post('users/:id/enable', [AdminUsersController, 'enable'])
    router.post('users/:id/revoke-sessions', [AdminUsersController, 'revokeSessions'])
    router.post('users/:id/revoke-tokens', [AdminUsersController, 'revokeTokens'])
    router.post('users/:id/reset-two-factor', [AdminUsersController, 'resetTwoFactor'])
    router.post('users/:id/impersonate', [AdminUsersController, 'impersonate'])
    router.get('roles', [AdminRolesController, 'index'])
    router.post('roles', [AdminRolesController, 'store'])
    router.get('roles/:id', [AdminRolesController, 'show'])
    router.patch('roles/:id', [AdminRolesController, 'update'])
    router.delete('roles/:id', [AdminRolesController, 'destroy'])
    router.put('roles/:id/rules', [AdminRolesController, 'setRule'])
    router.delete('roles/:id/rules/:rule', [AdminRolesController, 'removeRule'])
    router.get('org-units', [AdminOrgUnitsController, 'index'])
    router.post('org-units', [AdminOrgUnitsController, 'store'])
    router.patch('org-units/:id', [AdminOrgUnitsController, 'update'])
    router.post('org-units/:id/move', [AdminOrgUnitsController, 'move'])
    router.delete('org-units/:id', [AdminOrgUnitsController, 'destroy'])
    router.get('activity', [AdminActivityController, 'index'])
    router.get('jobs', [AdminJobsController, 'index'])
    router.post('jobs/:id/retry', [AdminJobsController, 'retry'])
    router.post('jobs/sync/:name/run', [AdminJobsController, 'runSync'])
    router.get('jobs/sync/:name/runs', [AdminJobsController, 'syncRuns'])
    router.get('settings', [AdminSettingsController, 'index'])
    router.get('templates', [AdminTemplatesController, 'index'])
    router.put('templates/:key', [AdminTemplatesController, 'update'])
    router.delete('templates/:key', [AdminTemplatesController, 'reset'])
    router.get('workflows', [WorkflowsController, 'failed'])
    router.post('workflows/:run/retry', [WorkflowsController, 'retry'])
    router.get('delegations', [DelegationsController, 'adminIndex'])
    router.get('delegations/candidates', [DelegationsController, 'adminCandidates'])
    router.post('delegations', [DelegationsController, 'adminStore'])
    router.delete('delegations/:id', [DelegationsController, 'adminDestroy'])
    router.get('webhooks', [AdminWebhooksController, 'index'])
    router.post('webhooks', [AdminWebhooksController, 'store'])
    router.put('webhooks/:id', [AdminWebhooksController, 'update'])
    router.delete('webhooks/:id', [AdminWebhooksController, 'destroy'])
    router.get('webhooks/:id/deliveries', [AdminWebhooksController, 'deliveries'])
    router.post('webhooks/deliveries/:delivery/retry', [AdminWebhooksController, 'retry'])
    router.post('inbound-webhooks', [AdminWebhooksController, 'storeInbound'])
    router.put('inbound-webhooks/:id', [AdminWebhooksController, 'updateInbound'])
    router.post('inbound-webhooks/:id/rotate', [AdminWebhooksController, 'rotateInbound'])
    router.delete('inbound-webhooks/:id', [AdminWebhooksController, 'destroyInbound'])
    router.get('inbound-webhooks/:id/deliveries', [AdminWebhooksController, 'inboundDeliveries'])
    router.post('inbound-webhooks/deliveries/:delivery/redispatch', [
      AdminWebhooksController,
      'redispatchInbound',
    ])
    router.get('setup', [SetupController, 'index'])
    router.post('setup/check/:service', [SetupController, 'check'])
    router.post('setup/identity', [SetupController, 'confirmIdentity'])
    router.post('setup/notification', [SetupController, 'notification'])
    router.post('settings/mail/test', [AdminSettingsController, 'testMail'])
    router.post('settings/mail/confirm', [AdminSettingsController, 'confirmMail'])
    router.put('settings', [AdminSettingsController, 'upsert'])
    router.put('settings/authentication', [AdminAuthenticationSettingsController, 'update'])
    router.put('settings/channels', [AdminSettingsController, 'updateChannel'])
    router.post('settings/channels/rotate', [AdminSettingsController, 'rotateChannel'])
    router
      .post('settings/channels/test', [AdminSettingsController, 'testChannel'])
      .use(channelTestThrottle)
    router.delete('settings/:id', [AdminSettingsController, 'destroy'])
    router.get('lookups', [AdminLookupsController, 'index'])
    router.post('lookups', [AdminLookupsController, 'store'])
    router.put('lookups/groups/:group/order', [AdminLookupsController, 'reorder'])
    router.patch('lookups/:id', [AdminLookupsController, 'update'])
    router.post('lookups/:id/disable', [AdminLookupsController, 'disable'])
    router.post('lookups/:id/enable', [AdminLookupsController, 'enable'])
    router.delete('lookups/:id', [AdminLookupsController, 'destroy'])
    router.get('sequences', [AdminSequencesController, 'index'])
    router.patch('sequences/:key', [AdminSequencesController, 'update'])
  })
  .prefix('admin')
  .use([middleware.auth(), middleware.admin()])
