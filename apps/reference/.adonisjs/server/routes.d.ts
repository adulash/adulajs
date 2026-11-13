import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'home': { paramsTuple?: []; params?: {} }
    'event_stream': { paramsTuple?: []; params?: {} }
    'subscribe': { paramsTuple?: []; params?: {} }
    'unsubscribe': { paramsTuple?: []; params?: {} }
    'mcp.post': { paramsTuple?: []; params?: {} }
    'assistant.accept_notice': { paramsTuple?: []; params?: {} }
    'assistant.start_conversation': { paramsTuple?: []; params?: {} }
    'assistant.turn': { paramsTuple: [ParamValue]; params: {'conversation': ParamValue} }
    'assistant.confirm': { paramsTuple: [ParamValue,ParamValue]; params: {'conversation': ParamValue,'id': ParamValue} }
    'assistant.reject': { paramsTuple: [ParamValue,ParamValue]; params: {'conversation': ParamValue,'id': ParamValue} }
    'inbound_webhooks.receive': { paramsTuple: [ParamValue]; params: {'source': ParamValue} }
    'resources.index': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.create': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'record_views.create': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.options': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'field': ParamValue} }
    'resources.aggregate': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.export': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.trash': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.bulk_actions': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.bulk': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.restore': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'dashboards.index': { paramsTuple?: []; params?: {} }
    'dashboards.show': { paramsTuple: [ParamValue]; params: {'name': ParamValue} }
    'imports.store': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'imports.template': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'imports.index': { paramsTuple?: []; params?: {} }
    'imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'imports.start': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'record_collaboration.tag_options': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'record_collaboration.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'record_collaboration.mentions': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'record_collaboration.comment': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'record_collaboration.edit_comment': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue,'comment': ParamValue} }
    'record_collaboration.delete_comment': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue,'comment': ParamValue} }
    'record_collaboration.follow': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'record_collaboration.tags': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'print.templates': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'print': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'assignments.for_record': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'assignments.store': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'workflows.for_record': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'workflows.inbox': { paramsTuple?: []; params?: {} }
    'workflows.decide': { paramsTuple: [ParamValue]; params: {'run': ParamValue} }
    'assignments.mine': { paramsTuple?: []; params?: {} }
    'assignments.complete': { paramsTuple: [ParamValue]; params: {'assignment': ParamValue} }
    'assignments.cancel': { paramsTuple: [ParamValue]; params: {'assignment': ParamValue} }
    'record_views.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'record_views.row': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.store': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.update': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.submit': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.amend': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'saved_views.store': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'saved_views.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'attachments.store': { paramsTuple?: []; params?: {} }
    'attachments.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.open_api': { paramsTuple?: []; params?: {} }
    'api.open_api.client': { paramsTuple?: []; params?: {} }
    'api.open_api.declarations': { paramsTuple?: []; params?: {} }
    'api.resources.index': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.aggregate': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.imports.index': { paramsTuple?: []; params?: {} }
    'api.imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.imports.start': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.imports.store': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.imports.template': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.export': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.trash': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.bulk_actions': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.bulk': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.restore': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.store': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.update': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.submit': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.amend': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'appearance_logos.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'user_invitations.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'user_invitations.accept': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'new_account.store': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'two_factor.challenge': { paramsTuple?: []; params?: {} }
    'two_factor.verify': { paramsTuple?: []; params?: {} }
    'password_reset.forgot': { paramsTuple?: []; params?: {} }
    'password_reset.send': { paramsTuple?: []; params?: {} }
    'password_reset.reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password_reset.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'oauth.redirect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'oauth.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'user_invitations.create': { paramsTuple?: []; params?: {} }
    'user_invitations.store': { paramsTuple?: []; params?: {} }
    'avatars.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'avatars.store_own': { paramsTuple?: []; params?: {} }
    'avatars.destroy_own': { paramsTuple?: []; params?: {} }
    'profile.show': { paramsTuple?: []; params?: {} }
    'profile.update': { paramsTuple?: []; params?: {} }
    'profile.password': { paramsTuple?: []; params?: {} }
    'language.update': { paramsTuple?: []; params?: {} }
    'preferences.update': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'preferences.destroy': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'profile.channels': { paramsTuple?: []; params?: {} }
    'profile.channel_code': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'profile.channel_confirm': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'two_factor.begin': { paramsTuple?: []; params?: {} }
    'two_factor.confirm': { paramsTuple?: []; params?: {} }
    'two_factor.regenerate': { paramsTuple?: []; params?: {} }
    'two_factor.destroy': { paramsTuple?: []; params?: {} }
    'delegations.index': { paramsTuple?: []; params?: {} }
    'delegations.candidates': { paramsTuple?: []; params?: {} }
    'delegations.store': { paramsTuple?: []; params?: {} }
    'delegations.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'account_sessions.index': { paramsTuple?: []; params?: {} }
    'account_sessions.purge': { paramsTuple?: []; params?: {} }
    'account_sessions.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'oauth.link': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'oauth.unlink': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_sessions.index': { paramsTuple?: []; params?: {} }
    'admin_sessions.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'notifications.read_all': { paramsTuple?: []; params?: {} }
    'notifications.read': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.open': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.stop_impersonation': { paramsTuple?: []; params?: {} }
    'admin_users.index': { paramsTuple?: []; params?: {} }
    'admin_users.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.assign_role': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.remove_role': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'assignment': ParamValue} }
    'admin_users.assign_org_unit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.remove_org_unit': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'orgUnit': ParamValue} }
    'admin_users.disable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.enable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.revoke_sessions': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.revoke_tokens': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.reset_two_factor': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.impersonate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'avatars.store_for': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'avatars.destroy_for': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_roles.index': { paramsTuple?: []; params?: {} }
    'admin_roles.store': { paramsTuple?: []; params?: {} }
    'admin_roles.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_roles.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_roles.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_roles.set_rule': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_roles.remove_rule': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'rule': ParamValue} }
    'admin_org_units.index': { paramsTuple?: []; params?: {} }
    'admin_org_units.store': { paramsTuple?: []; params?: {} }
    'admin_org_units.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_org_units.move': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_org_units.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_activity.index': { paramsTuple?: []; params?: {} }
    'admin_jobs.index': { paramsTuple?: []; params?: {} }
    'admin_backups.index': { paramsTuple?: []; params?: {} }
    'admin_backups.connect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_backups.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_backups.disconnect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_backups.schedule': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_backups.run': { paramsTuple?: []; params?: {} }
    'admin_backups.download': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_jobs.retry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_jobs.run_sync': { paramsTuple: [ParamValue]; params: {'name': ParamValue} }
    'admin_jobs.sync_runs': { paramsTuple: [ParamValue]; params: {'name': ParamValue} }
    'admin_settings.index': { paramsTuple?: []; params?: {} }
    'admin_settings.mail': { paramsTuple?: []; params?: {} }
    'admin_templates.index': { paramsTuple?: []; params?: {} }
    'admin_templates.update': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'admin_templates.reset': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'admin_print_templates.index': { paramsTuple?: []; params?: {} }
    'admin_print_templates.store': { paramsTuple?: []; params?: {} }
    'admin_print_templates.preview': { paramsTuple?: []; params?: {} }
    'admin_print_templates.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'key': ParamValue} }
    'admin_print_templates.update': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'key': ParamValue} }
    'admin_print_templates.versions': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'key': ParamValue} }
    'workflows.failed': { paramsTuple?: []; params?: {} }
    'workflows.retry': { paramsTuple: [ParamValue]; params: {'run': ParamValue} }
    'delegations.admin_index': { paramsTuple?: []; params?: {} }
    'delegations.admin_candidates': { paramsTuple?: []; params?: {} }
    'delegations.admin_store': { paramsTuple?: []; params?: {} }
    'delegations.admin_destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.index': { paramsTuple?: []; params?: {} }
    'admin_webhooks.store': { paramsTuple?: []; params?: {} }
    'admin_webhooks.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.deliveries': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.retry': { paramsTuple: [ParamValue]; params: {'delivery': ParamValue} }
    'admin_webhooks.store_inbound': { paramsTuple?: []; params?: {} }
    'admin_webhooks.update_inbound': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.rotate_inbound': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.destroy_inbound': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.inbound_deliveries': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.redispatch_inbound': { paramsTuple: [ParamValue]; params: {'delivery': ParamValue} }
    'setup.index': { paramsTuple?: []; params?: {} }
    'setup.check': { paramsTuple: [ParamValue]; params: {'service': ParamValue} }
    'setup.confirm_identity': { paramsTuple?: []; params?: {} }
    'setup.notification': { paramsTuple?: []; params?: {} }
    'admin_settings.test_mail': { paramsTuple?: []; params?: {} }
    'admin_settings.confirm_mail': { paramsTuple?: []; params?: {} }
    'admin_settings.update_mail': { paramsTuple?: []; params?: {} }
    'admin_settings.set_mail_password': { paramsTuple?: []; params?: {} }
    'admin_settings.clear_mail_password': { paramsTuple?: []; params?: {} }
    'admin_settings.upsert': { paramsTuple?: []; params?: {} }
    'admin_authentication_settings.update': { paramsTuple?: []; params?: {} }
    'admin_settings.update_channel': { paramsTuple?: []; params?: {} }
    'admin_settings.rotate_channel': { paramsTuple?: []; params?: {} }
    'admin_settings.test_channel': { paramsTuple?: []; params?: {} }
    'admin_settings.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api_tokens.index': { paramsTuple?: []; params?: {} }
    'api_tokens.store': { paramsTuple?: []; params?: {} }
    'api_tokens.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_appearance.index': { paramsTuple?: []; params?: {} }
    'admin_appearance.update_identity': { paramsTuple?: []; params?: {} }
    'admin_appearance.reset_identity': { paramsTuple?: []; params?: {} }
    'admin_appearance.upload_logo': { paramsTuple?: []; params?: {} }
    'admin_appearance.store_occasion': { paramsTuple?: []; params?: {} }
    'admin_appearance.update_occasion': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_appearance.destroy_occasion': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_assistant.index': { paramsTuple?: []; params?: {} }
    'admin_assistant.update': { paramsTuple?: []; params?: {} }
    'admin_assistant.set_key': { paramsTuple?: []; params?: {} }
    'admin_assistant.clear_key': { paramsTuple?: []; params?: {} }
    'admin_assistant.test': { paramsTuple?: []; params?: {} }
    'admin_lookups.index': { paramsTuple?: []; params?: {} }
    'admin_lookups.store': { paramsTuple?: []; params?: {} }
    'admin_lookups.reorder': { paramsTuple: [ParamValue]; params: {'group': ParamValue} }
    'admin_lookups.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_lookups.disable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_lookups.enable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_lookups.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_sequences.index': { paramsTuple?: []; params?: {} }
    'admin_sequences.update': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
  }
  GET: {
    'home': { paramsTuple?: []; params?: {} }
    'event_stream': { paramsTuple?: []; params?: {} }
    'resources.index': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.create': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'record_views.create': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.options': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'field': ParamValue} }
    'resources.aggregate': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.export': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.trash': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.bulk_actions': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'dashboards.index': { paramsTuple?: []; params?: {} }
    'dashboards.show': { paramsTuple: [ParamValue]; params: {'name': ParamValue} }
    'imports.template': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'imports.index': { paramsTuple?: []; params?: {} }
    'imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'record_collaboration.tag_options': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'record_collaboration.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'record_collaboration.mentions': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'print.templates': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'print': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'assignments.for_record': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'workflows.for_record': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'workflows.inbox': { paramsTuple?: []; params?: {} }
    'assignments.mine': { paramsTuple?: []; params?: {} }
    'record_views.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'record_views.row': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'attachments.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.open_api': { paramsTuple?: []; params?: {} }
    'api.open_api.client': { paramsTuple?: []; params?: {} }
    'api.open_api.declarations': { paramsTuple?: []; params?: {} }
    'api.resources.index': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.aggregate': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.imports.index': { paramsTuple?: []; params?: {} }
    'api.imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.imports.template': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.export': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.trash': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.bulk_actions': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'appearance_logos.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'user_invitations.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'session.create': { paramsTuple?: []; params?: {} }
    'two_factor.challenge': { paramsTuple?: []; params?: {} }
    'password_reset.forgot': { paramsTuple?: []; params?: {} }
    'password_reset.reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'oauth.redirect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'oauth.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'user_invitations.create': { paramsTuple?: []; params?: {} }
    'avatars.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'profile.show': { paramsTuple?: []; params?: {} }
    'delegations.index': { paramsTuple?: []; params?: {} }
    'delegations.candidates': { paramsTuple?: []; params?: {} }
    'account_sessions.index': { paramsTuple?: []; params?: {} }
    'admin_sessions.index': { paramsTuple?: []; params?: {} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'notifications.open': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.index': { paramsTuple?: []; params?: {} }
    'admin_users.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_roles.index': { paramsTuple?: []; params?: {} }
    'admin_roles.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_org_units.index': { paramsTuple?: []; params?: {} }
    'admin_activity.index': { paramsTuple?: []; params?: {} }
    'admin_jobs.index': { paramsTuple?: []; params?: {} }
    'admin_backups.index': { paramsTuple?: []; params?: {} }
    'admin_backups.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_backups.download': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_jobs.sync_runs': { paramsTuple: [ParamValue]; params: {'name': ParamValue} }
    'admin_settings.index': { paramsTuple?: []; params?: {} }
    'admin_settings.mail': { paramsTuple?: []; params?: {} }
    'admin_templates.index': { paramsTuple?: []; params?: {} }
    'admin_print_templates.index': { paramsTuple?: []; params?: {} }
    'admin_print_templates.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'key': ParamValue} }
    'admin_print_templates.versions': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'key': ParamValue} }
    'workflows.failed': { paramsTuple?: []; params?: {} }
    'delegations.admin_index': { paramsTuple?: []; params?: {} }
    'delegations.admin_candidates': { paramsTuple?: []; params?: {} }
    'admin_webhooks.index': { paramsTuple?: []; params?: {} }
    'admin_webhooks.deliveries': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.inbound_deliveries': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'setup.index': { paramsTuple?: []; params?: {} }
    'api_tokens.index': { paramsTuple?: []; params?: {} }
    'admin_appearance.index': { paramsTuple?: []; params?: {} }
    'admin_assistant.index': { paramsTuple?: []; params?: {} }
    'admin_lookups.index': { paramsTuple?: []; params?: {} }
    'admin_sequences.index': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'home': { paramsTuple?: []; params?: {} }
    'event_stream': { paramsTuple?: []; params?: {} }
    'resources.index': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.create': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'record_views.create': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.options': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'field': ParamValue} }
    'resources.aggregate': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.export': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.trash': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.bulk_actions': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'dashboards.index': { paramsTuple?: []; params?: {} }
    'dashboards.show': { paramsTuple: [ParamValue]; params: {'name': ParamValue} }
    'imports.template': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'imports.index': { paramsTuple?: []; params?: {} }
    'imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'record_collaboration.tag_options': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'record_collaboration.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'record_collaboration.mentions': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'print.templates': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'print': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'assignments.for_record': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'workflows.for_record': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'workflows.inbox': { paramsTuple?: []; params?: {} }
    'assignments.mine': { paramsTuple?: []; params?: {} }
    'record_views.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'record_views.row': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'attachments.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.open_api': { paramsTuple?: []; params?: {} }
    'api.open_api.client': { paramsTuple?: []; params?: {} }
    'api.open_api.declarations': { paramsTuple?: []; params?: {} }
    'api.resources.index': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.aggregate': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.imports.index': { paramsTuple?: []; params?: {} }
    'api.imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.imports.template': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.export': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.trash': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.bulk_actions': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'appearance_logos.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'user_invitations.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'session.create': { paramsTuple?: []; params?: {} }
    'two_factor.challenge': { paramsTuple?: []; params?: {} }
    'password_reset.forgot': { paramsTuple?: []; params?: {} }
    'password_reset.reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'oauth.redirect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'oauth.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'user_invitations.create': { paramsTuple?: []; params?: {} }
    'avatars.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'profile.show': { paramsTuple?: []; params?: {} }
    'delegations.index': { paramsTuple?: []; params?: {} }
    'delegations.candidates': { paramsTuple?: []; params?: {} }
    'account_sessions.index': { paramsTuple?: []; params?: {} }
    'admin_sessions.index': { paramsTuple?: []; params?: {} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'notifications.open': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.index': { paramsTuple?: []; params?: {} }
    'admin_users.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_roles.index': { paramsTuple?: []; params?: {} }
    'admin_roles.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_org_units.index': { paramsTuple?: []; params?: {} }
    'admin_activity.index': { paramsTuple?: []; params?: {} }
    'admin_jobs.index': { paramsTuple?: []; params?: {} }
    'admin_backups.index': { paramsTuple?: []; params?: {} }
    'admin_backups.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_backups.download': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_jobs.sync_runs': { paramsTuple: [ParamValue]; params: {'name': ParamValue} }
    'admin_settings.index': { paramsTuple?: []; params?: {} }
    'admin_settings.mail': { paramsTuple?: []; params?: {} }
    'admin_templates.index': { paramsTuple?: []; params?: {} }
    'admin_print_templates.index': { paramsTuple?: []; params?: {} }
    'admin_print_templates.show': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'key': ParamValue} }
    'admin_print_templates.versions': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'key': ParamValue} }
    'workflows.failed': { paramsTuple?: []; params?: {} }
    'delegations.admin_index': { paramsTuple?: []; params?: {} }
    'delegations.admin_candidates': { paramsTuple?: []; params?: {} }
    'admin_webhooks.index': { paramsTuple?: []; params?: {} }
    'admin_webhooks.deliveries': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.inbound_deliveries': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'setup.index': { paramsTuple?: []; params?: {} }
    'api_tokens.index': { paramsTuple?: []; params?: {} }
    'admin_appearance.index': { paramsTuple?: []; params?: {} }
    'admin_assistant.index': { paramsTuple?: []; params?: {} }
    'admin_lookups.index': { paramsTuple?: []; params?: {} }
    'admin_sequences.index': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'subscribe': { paramsTuple?: []; params?: {} }
    'unsubscribe': { paramsTuple?: []; params?: {} }
    'mcp.post': { paramsTuple?: []; params?: {} }
    'assistant.accept_notice': { paramsTuple?: []; params?: {} }
    'assistant.start_conversation': { paramsTuple?: []; params?: {} }
    'assistant.turn': { paramsTuple: [ParamValue]; params: {'conversation': ParamValue} }
    'assistant.confirm': { paramsTuple: [ParamValue,ParamValue]; params: {'conversation': ParamValue,'id': ParamValue} }
    'assistant.reject': { paramsTuple: [ParamValue,ParamValue]; params: {'conversation': ParamValue,'id': ParamValue} }
    'inbound_webhooks.receive': { paramsTuple: [ParamValue]; params: {'source': ParamValue} }
    'resources.bulk': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.restore': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'imports.store': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'imports.start': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'record_collaboration.comment': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'assignments.store': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'workflows.decide': { paramsTuple: [ParamValue]; params: {'run': ParamValue} }
    'assignments.complete': { paramsTuple: [ParamValue]; params: {'assignment': ParamValue} }
    'assignments.cancel': { paramsTuple: [ParamValue]; params: {'assignment': ParamValue} }
    'resources.store': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'resources.submit': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'resources.amend': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'saved_views.store': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'attachments.store': { paramsTuple?: []; params?: {} }
    'api.imports.start': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.imports.store': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.bulk': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.restore': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.store': { paramsTuple: [ParamValue]; params: {'resource': ParamValue} }
    'api.resources.submit': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.amend': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'user_invitations.accept': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'new_account.store': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'two_factor.verify': { paramsTuple?: []; params?: {} }
    'password_reset.send': { paramsTuple?: []; params?: {} }
    'password_reset.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'user_invitations.store': { paramsTuple?: []; params?: {} }
    'avatars.store_own': { paramsTuple?: []; params?: {} }
    'profile.password': { paramsTuple?: []; params?: {} }
    'profile.channel_code': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'profile.channel_confirm': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'two_factor.begin': { paramsTuple?: []; params?: {} }
    'two_factor.confirm': { paramsTuple?: []; params?: {} }
    'two_factor.regenerate': { paramsTuple?: []; params?: {} }
    'delegations.store': { paramsTuple?: []; params?: {} }
    'oauth.link': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'notifications.read_all': { paramsTuple?: []; params?: {} }
    'notifications.read': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.stop_impersonation': { paramsTuple?: []; params?: {} }
    'admin_users.assign_role': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.assign_org_unit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.disable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.enable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.revoke_sessions': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.revoke_tokens': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.reset_two_factor': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.impersonate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'avatars.store_for': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_roles.store': { paramsTuple?: []; params?: {} }
    'admin_org_units.store': { paramsTuple?: []; params?: {} }
    'admin_org_units.move': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_backups.connect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_backups.run': { paramsTuple?: []; params?: {} }
    'admin_jobs.retry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_jobs.run_sync': { paramsTuple: [ParamValue]; params: {'name': ParamValue} }
    'admin_print_templates.store': { paramsTuple?: []; params?: {} }
    'admin_print_templates.preview': { paramsTuple?: []; params?: {} }
    'workflows.retry': { paramsTuple: [ParamValue]; params: {'run': ParamValue} }
    'delegations.admin_store': { paramsTuple?: []; params?: {} }
    'admin_webhooks.store': { paramsTuple?: []; params?: {} }
    'admin_webhooks.retry': { paramsTuple: [ParamValue]; params: {'delivery': ParamValue} }
    'admin_webhooks.store_inbound': { paramsTuple?: []; params?: {} }
    'admin_webhooks.rotate_inbound': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.redispatch_inbound': { paramsTuple: [ParamValue]; params: {'delivery': ParamValue} }
    'setup.check': { paramsTuple: [ParamValue]; params: {'service': ParamValue} }
    'setup.confirm_identity': { paramsTuple?: []; params?: {} }
    'setup.notification': { paramsTuple?: []; params?: {} }
    'admin_settings.test_mail': { paramsTuple?: []; params?: {} }
    'admin_settings.confirm_mail': { paramsTuple?: []; params?: {} }
    'admin_settings.rotate_channel': { paramsTuple?: []; params?: {} }
    'admin_settings.test_channel': { paramsTuple?: []; params?: {} }
    'api_tokens.store': { paramsTuple?: []; params?: {} }
    'admin_appearance.upload_logo': { paramsTuple?: []; params?: {} }
    'admin_appearance.store_occasion': { paramsTuple?: []; params?: {} }
    'admin_assistant.test': { paramsTuple?: []; params?: {} }
    'admin_lookups.store': { paramsTuple?: []; params?: {} }
    'admin_lookups.disable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_lookups.enable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PATCH: {
    'record_collaboration.edit_comment': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue,'comment': ParamValue} }
    'resources.update': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.update': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'profile.update': { paramsTuple?: []; params?: {} }
    'admin_roles.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_org_units.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_lookups.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_sequences.update': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
  }
  DELETE: {
    'record_collaboration.delete_comment': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue,'comment': ParamValue} }
    'resources.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'saved_views.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'api.resources.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'avatars.destroy_own': { paramsTuple?: []; params?: {} }
    'preferences.destroy': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'two_factor.destroy': { paramsTuple?: []; params?: {} }
    'delegations.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'account_sessions.purge': { paramsTuple?: []; params?: {} }
    'account_sessions.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'oauth.unlink': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_sessions.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.remove_role': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'assignment': ParamValue} }
    'admin_users.remove_org_unit': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'orgUnit': ParamValue} }
    'avatars.destroy_for': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_roles.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_roles.remove_rule': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'rule': ParamValue} }
    'admin_org_units.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_backups.disconnect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_templates.reset': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'delegations.admin_destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.destroy_inbound': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_settings.clear_mail_password': { paramsTuple?: []; params?: {} }
    'admin_settings.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api_tokens.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_appearance.reset_identity': { paramsTuple?: []; params?: {} }
    'admin_appearance.destroy_occasion': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_assistant.clear_key': { paramsTuple?: []; params?: {} }
    'admin_lookups.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PUT: {
    'record_collaboration.follow': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'record_collaboration.tags': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'id': ParamValue} }
    'language.update': { paramsTuple?: []; params?: {} }
    'preferences.update': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'profile.channels': { paramsTuple?: []; params?: {} }
    'admin_roles.set_rule': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_backups.schedule': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'admin_templates.update': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'admin_print_templates.update': { paramsTuple: [ParamValue,ParamValue]; params: {'resource': ParamValue,'key': ParamValue} }
    'admin_webhooks.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_webhooks.update_inbound': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_settings.update_mail': { paramsTuple?: []; params?: {} }
    'admin_settings.set_mail_password': { paramsTuple?: []; params?: {} }
    'admin_settings.upsert': { paramsTuple?: []; params?: {} }
    'admin_authentication_settings.update': { paramsTuple?: []; params?: {} }
    'admin_settings.update_channel': { paramsTuple?: []; params?: {} }
    'admin_appearance.update_identity': { paramsTuple?: []; params?: {} }
    'admin_appearance.update_occasion': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_assistant.update': { paramsTuple?: []; params?: {} }
    'admin_assistant.set_key': { paramsTuple?: []; params?: {} }
    'admin_lookups.reorder': { paramsTuple: [ParamValue]; params: {'group': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}