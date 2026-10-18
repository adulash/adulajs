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
  healthThrottle,
  inboundThrottle,
  inboundAddressThrottle,
  loginAddressThrottle,
  loginThrottle,
  oauthThrottle,
  passwordChangeThrottle,
  passwordThrottle,
  signupThrottle,
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
const RecordCollaborationController = () => import('#controllers/record_collaboration_controller')
const PasswordResetController = () => import('#controllers/password_reset_controller')
const UserInvitationsController = () => import('#controllers/user_invitations_controller')
const OauthController = () => import('#controllers/oauth_controller')
const ProfileController = () => import('#controllers/profile_controller')
const AccountSessionsController = () => import('#controllers/account_sessions_controller')
const AdminSessionsController = () => import('#controllers/admin_sessions_controller')
const AdminUsersController = () => import('#controllers/admin/users_controller')
const AdminRolesController = () => import('#controllers/admin/roles_controller')
const AdminOrgUnitsController = () => import('#controllers/admin/org_units_controller')
const AdminActivityController = () => import('#controllers/admin/activity_controller')
const AdminJobsController = () => import('#controllers/admin/jobs_controller')
const AdminSettingsController = () => import('#controllers/admin/settings_controller')
const SetupController = () => import('#controllers/admin/setup_controller')
const NotificationsController = () => import('#controllers/admin/notifications_controller')
const AdminTemplatesController = () => import('#controllers/admin/templates_controller')
const AdminWebhooksController = () => import('#controllers/admin/webhooks_controller')
const InboundWebhooksController = () => import('#controllers/inbound_webhooks_controller')

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
    router.post('/resources/:resource/imports', [ImportsController, 'store'])
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
    router.get('resources/:resource', [ResourcesController, 'index'])
    router.get('resources/:resource/aggregate', [ResourcesController, 'aggregate'])
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

    router.get('password/forgot', [PasswordResetController, 'forgot'])
    router.post('password/forgot', [PasswordResetController, 'send']).use(passwordThrottle)
    router.get('password/reset/:token', [PasswordResetController, 'reset'])
    router.post('password/reset/:token', [PasswordResetController, 'update']).use(passwordThrottle)

    router.get('oauth/:provider/redirect', [OauthController, 'redirect']).use(oauthThrottle)
    router.get('oauth/:provider/callback', [OauthController, 'callback']).use(oauthThrottle)
  })
  .use(middleware.guest())

router
  .group(() => {
    router.post('logout', [controllers.Session, 'destroy'])
    router.get('users/invite', [UserInvitationsController, 'create'])
    router.post('users/invite', [UserInvitationsController, 'store']).use(apiThrottle)

    router.get('account/profile', [ProfileController, 'show'])
    router.patch('account/profile', [ProfileController, 'update'])
    router.post('account/password', [ProfileController, 'password']).use(passwordChangeThrottle)
    router.get('account/tokens', [ApiTokensController, 'index'])
    router.post('account/tokens', [ApiTokensController, 'store']).use(apiThrottle)
    router.delete('account/tokens/:id', [ApiTokensController, 'destroy'])
    router.get('account/sessions', [AccountSessionsController, 'index'])
    router.delete('account/sessions', [AccountSessionsController, 'purge'])
    router.delete('account/sessions/:id', [AccountSessionsController, 'destroy'])

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
    router.get('settings', [AdminSettingsController, 'index'])
    router.get('templates', [AdminTemplatesController, 'index'])
    router.put('templates/:key', [AdminTemplatesController, 'update'])
    router.delete('templates/:key', [AdminTemplatesController, 'reset'])
    router.get('workflows', [WorkflowsController, 'failed'])
    router.post('workflows/:run/retry', [WorkflowsController, 'retry'])
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
    router.delete('settings/:id', [AdminSettingsController, 'destroy'])
  })
  .prefix('admin')
  .use([middleware.auth(), middleware.admin()])
