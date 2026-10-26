/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  home: typeof routes['home']
  eventStream: typeof routes['event_stream']
  subscribe: typeof routes['subscribe']
  unsubscribe: typeof routes['unsubscribe']
  mcp: {
    post: typeof routes['mcp.post']
  }
  inboundWebhooks: {
    receive: typeof routes['inbound_webhooks.receive']
  }
  resources: {
    index: typeof routes['resources.index']
    create: typeof routes['resources.create']
    options: typeof routes['resources.options']
    aggregate: typeof routes['resources.aggregate']
    export: typeof routes['resources.export']
    trash: typeof routes['resources.trash']
    bulkActions: typeof routes['resources.bulk_actions']
    bulk: typeof routes['resources.bulk']
    restore: typeof routes['resources.restore']
    edit: typeof routes['resources.edit']
    show: typeof routes['resources.show']
    store: typeof routes['resources.store']
    update: typeof routes['resources.update']
    destroy: typeof routes['resources.destroy']
    submit: typeof routes['resources.submit']
    cancel: typeof routes['resources.cancel']
    amend: typeof routes['resources.amend']
  }
  dashboards: {
    index: typeof routes['dashboards.index']
    show: typeof routes['dashboards.show']
  }
  imports: {
    store: typeof routes['imports.store']
    index: typeof routes['imports.index']
    show: typeof routes['imports.show']
    start: typeof routes['imports.start']
  }
  recordCollaboration: {
    tagOptions: typeof routes['record_collaboration.tag_options']
    show: typeof routes['record_collaboration.show']
    mentions: typeof routes['record_collaboration.mentions']
    comment: typeof routes['record_collaboration.comment']
    editComment: typeof routes['record_collaboration.edit_comment']
    deleteComment: typeof routes['record_collaboration.delete_comment']
    follow: typeof routes['record_collaboration.follow']
    tags: typeof routes['record_collaboration.tags']
  }
  print: typeof routes['print']
  assignments: {
    forRecord: typeof routes['assignments.for_record']
    store: typeof routes['assignments.store']
    mine: typeof routes['assignments.mine']
    complete: typeof routes['assignments.complete']
    cancel: typeof routes['assignments.cancel']
  }
  workflows: {
    forRecord: typeof routes['workflows.for_record']
    inbox: typeof routes['workflows.inbox']
    decide: typeof routes['workflows.decide']
    failed: typeof routes['workflows.failed']
    retry: typeof routes['workflows.retry']
  }
  recordViews: {
    show: typeof routes['record_views.show']
  }
  savedViews: {
    store: typeof routes['saved_views.store']
    destroy: typeof routes['saved_views.destroy']
  }
  attachments: {
    store: typeof routes['attachments.store']
    show: typeof routes['attachments.show']
  }
  api: {
    openApi: typeof routes['api.open_api']
    resources: {
      index: typeof routes['api.resources.index']
      aggregate: typeof routes['api.resources.aggregate']
      export: typeof routes['api.resources.export']
      trash: typeof routes['api.resources.trash']
      bulkActions: typeof routes['api.resources.bulk_actions']
      bulk: typeof routes['api.resources.bulk']
      restore: typeof routes['api.resources.restore']
      show: typeof routes['api.resources.show']
      store: typeof routes['api.resources.store']
      update: typeof routes['api.resources.update']
      destroy: typeof routes['api.resources.destroy']
      submit: typeof routes['api.resources.submit']
      cancel: typeof routes['api.resources.cancel']
      amend: typeof routes['api.resources.amend']
    }
  }
  newAccount: {
    create: typeof routes['new_account.create']
    store: typeof routes['new_account.store']
  }
  userInvitations: {
    show: typeof routes['user_invitations.show']
    accept: typeof routes['user_invitations.accept']
    create: typeof routes['user_invitations.create']
    store: typeof routes['user_invitations.store']
  }
  session: {
    create: typeof routes['session.create']
    store: typeof routes['session.store']
    destroy: typeof routes['session.destroy']
  }
  twoFactor: {
    challenge: typeof routes['two_factor.challenge']
    verify: typeof routes['two_factor.verify']
    begin: typeof routes['two_factor.begin']
    confirm: typeof routes['two_factor.confirm']
    regenerate: typeof routes['two_factor.regenerate']
    destroy: typeof routes['two_factor.destroy']
  }
  passwordReset: {
    forgot: typeof routes['password_reset.forgot']
    send: typeof routes['password_reset.send']
    reset: typeof routes['password_reset.reset']
    update: typeof routes['password_reset.update']
  }
  oauth: {
    redirect: typeof routes['oauth.redirect']
    callback: typeof routes['oauth.callback']
    link: typeof routes['oauth.link']
    unlink: typeof routes['oauth.unlink']
  }
  profile: {
    show: typeof routes['profile.show']
    update: typeof routes['profile.update']
    password: typeof routes['profile.password']
  }
  language: {
    update: typeof routes['language.update']
  }
  apiTokens: {
    index: typeof routes['api_tokens.index']
    store: typeof routes['api_tokens.store']
    destroy: typeof routes['api_tokens.destroy']
  }
  accountSessions: {
    index: typeof routes['account_sessions.index']
    purge: typeof routes['account_sessions.purge']
    destroy: typeof routes['account_sessions.destroy']
  }
  adminSessions: {
    index: typeof routes['admin_sessions.index']
    destroy: typeof routes['admin_sessions.destroy']
  }
  notifications: {
    index: typeof routes['notifications.index']
    readAll: typeof routes['notifications.read_all']
    read: typeof routes['notifications.read']
    open: typeof routes['notifications.open']
  }
  adminUsers: {
    stopImpersonation: typeof routes['admin_users.stop_impersonation']
    index: typeof routes['admin_users.index']
    show: typeof routes['admin_users.show']
    assignRole: typeof routes['admin_users.assign_role']
    removeRole: typeof routes['admin_users.remove_role']
    assignOrgUnit: typeof routes['admin_users.assign_org_unit']
    removeOrgUnit: typeof routes['admin_users.remove_org_unit']
    disable: typeof routes['admin_users.disable']
    enable: typeof routes['admin_users.enable']
    revokeSessions: typeof routes['admin_users.revoke_sessions']
    revokeTokens: typeof routes['admin_users.revoke_tokens']
    resetTwoFactor: typeof routes['admin_users.reset_two_factor']
    impersonate: typeof routes['admin_users.impersonate']
  }
  adminRoles: {
    index: typeof routes['admin_roles.index']
    store: typeof routes['admin_roles.store']
    show: typeof routes['admin_roles.show']
    update: typeof routes['admin_roles.update']
    destroy: typeof routes['admin_roles.destroy']
    setRule: typeof routes['admin_roles.set_rule']
    removeRule: typeof routes['admin_roles.remove_rule']
  }
  adminOrgUnits: {
    index: typeof routes['admin_org_units.index']
    store: typeof routes['admin_org_units.store']
    update: typeof routes['admin_org_units.update']
    move: typeof routes['admin_org_units.move']
    destroy: typeof routes['admin_org_units.destroy']
  }
  adminActivity: {
    index: typeof routes['admin_activity.index']
  }
  adminJobs: {
    index: typeof routes['admin_jobs.index']
    retry: typeof routes['admin_jobs.retry']
  }
  adminSettings: {
    index: typeof routes['admin_settings.index']
    testMail: typeof routes['admin_settings.test_mail']
    confirmMail: typeof routes['admin_settings.confirm_mail']
    upsert: typeof routes['admin_settings.upsert']
    destroy: typeof routes['admin_settings.destroy']
  }
  adminTemplates: {
    index: typeof routes['admin_templates.index']
    update: typeof routes['admin_templates.update']
    reset: typeof routes['admin_templates.reset']
  }
  adminWebhooks: {
    index: typeof routes['admin_webhooks.index']
    store: typeof routes['admin_webhooks.store']
    update: typeof routes['admin_webhooks.update']
    destroy: typeof routes['admin_webhooks.destroy']
    deliveries: typeof routes['admin_webhooks.deliveries']
    retry: typeof routes['admin_webhooks.retry']
    storeInbound: typeof routes['admin_webhooks.store_inbound']
    updateInbound: typeof routes['admin_webhooks.update_inbound']
    rotateInbound: typeof routes['admin_webhooks.rotate_inbound']
    destroyInbound: typeof routes['admin_webhooks.destroy_inbound']
    inboundDeliveries: typeof routes['admin_webhooks.inbound_deliveries']
    redispatchInbound: typeof routes['admin_webhooks.redispatch_inbound']
  }
  setup: {
    index: typeof routes['setup.index']
    check: typeof routes['setup.check']
    confirmIdentity: typeof routes['setup.confirm_identity']
    notification: typeof routes['setup.notification']
  }
  adminAuthenticationSettings: {
    update: typeof routes['admin_authentication_settings.update']
  }
  adminLookups: {
    index: typeof routes['admin_lookups.index']
    store: typeof routes['admin_lookups.store']
    reorder: typeof routes['admin_lookups.reorder']
    update: typeof routes['admin_lookups.update']
    disable: typeof routes['admin_lookups.disable']
    enable: typeof routes['admin_lookups.enable']
    destroy: typeof routes['admin_lookups.destroy']
  }
  adminSequences: {
    index: typeof routes['admin_sequences.index']
    update: typeof routes['admin_sequences.update']
  }
}
