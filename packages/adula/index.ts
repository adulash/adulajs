export { defineResource, columnName } from './src/resource/define_resource.js'
export { configure } from './configure.js'
export { withAdulaDatabase } from './src/database/configure.js'
export { createResourceController } from './src/admin/controller.js'
export type {
  ResourceRuntime,
  ResourceList,
  ResourceEditor,
  ResourceShow,
  ResourceChildren,
  ResourceLookups,
  ResourceActivity,
} from './src/admin/controller.js'
export type * from './src/admin/presentation.js'
export { ResourceRegistry } from './src/resource/registry.js'
export type * from './src/resource/types.js'
export { buildAbility, canRecord, inOrgScope } from './src/auth/ability.js'
export { packedResourceRules } from './src/auth/packed_rules.js'
export type { Actor, Rule, AdulaAbility } from './src/auth/ability.js'
export { ActorStore } from './src/auth/actor_store.js'
export { accessibleBy, authorizationSql, conditionSql } from './src/auth/sql.js'
export { ACTOR_ID, resolveActorConditions } from './src/auth/conditions.js'
export { ResourceService, canQueryField } from './src/admin/resource_service.js'
export type { AggregateOptions, AggregateRow, ListOptions } from './src/admin/resource_service.js'
export { serialize, writableInput, selectedFields } from './src/admin/contracts.js'
export { AdulaError } from './src/admin/errors.js'
export {
  BASE_LANGUAGE,
  registerLanguage,
  registeredLanguages,
  enabledLanguages,
  resolveLanguage,
  languageDirection,
  translate,
  localizeText,
  messageKeyOf,
  clientMessages,
  runWithLanguage,
  currentLanguage,
  labelText,
} from './src/languages/catalog.js'
export type {
  MessageCatalog,
  MessageParams,
  TextDirection,
  LanguageInfo,
  LanguageOptions,
} from './src/languages/catalog.js'
export { arabicMessages } from './src/languages/ar.js'
export { englishMessages } from './src/languages/en.js'
export { CatalogMessagesProvider, installCatalogMessages } from './src/languages/validation.js'
export {
  TwoFactor,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
  TWO_FACTOR_PERIOD,
  TWO_FACTOR_DIGITS,
  TWO_FACTOR_WINDOW,
  TWO_FACTOR_UNREADABLE,
} from './src/auth/two_factor.js'
export type {
  TwoFactorStatus,
  TwoFactorEnrolment,
  TwoFactorResult,
  TwoFactorOptions,
  TwoFactorVerifyOptions,
} from './src/auth/two_factor.js'
export {
  createCoreSchema,
  createResourceTable,
  createAttachmentsSchema,
  createSavedViewsSchema,
  createCollaborationSchema,
  createAssignmentsSchema,
  createMessagingSchema,
  createWebhooksSchema,
  createImportsSchema,
  createWorkflowSchema,
  createManagedAssignmentsSchema,
  createRoleKeysSchema,
  createNotificationTargetsSchema,
  createUploadGrantsSchema,
  createInboundWebhooksSchema,
  createTwoFactorSchema,
} from './src/database/schema.js'
export { defineWorkflow, nextStep } from './src/workflows/define_workflow.js'
export type {
  WorkflowDefinition,
  WorkflowInput,
  WorkflowStep,
  WorkflowEvent,
  StepContext,
  Recipients,
  DecisionOutcome,
} from './src/workflows/define_workflow.js'
export { WorkflowEngine, workflowListeners } from './src/workflows/engine.js'
export type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowOptions,
  WorkflowDecisionForm,
} from './src/workflows/engine.js'
export { ImportBatches, importCell, IMPORT_ROW_LIMIT } from './src/integrations/imports.js'
export type {
  ImportBatch,
  ImportStatus,
  ImportTarget,
  ActorSource,
} from './src/integrations/imports.js'
export type {
  ImportBatchRecord,
  ImportBatchStatus,
  ImportTargetField,
  ImportMode,
  ImportReportRow,
  ImportBatchesOptions,
  ImportCreateInput,
  ImportStartOptions,
} from './src/integrations/imports.js'
export { csvImportAdapter, importFile } from './src/integrations/import_adapters.js'
export type { ImportAdapter, ImportFile, ImportTable } from './src/integrations/import_adapters.js'
export { createImportModesSchema } from './src/database/schema.js'
export { openApiDocument } from './src/integrations/openapi.js'
export { apiClientSource, apiClientDeclarations } from './src/integrations/api_client.js'
export type { ApiClientDocument, ApiClientOptions } from './src/integrations/api_client.js'
export {
  renderPrintHtml,
  htmlToPdf,
  imageDataUri,
  PRINT_LOGO_LIMIT,
} from './src/integrations/print.js'
export type { PrintIdentity, PrintInput } from './src/integrations/print.js'
export { Webhooks, signWebhook, WEBHOOK_MAX_ATTEMPTS } from './src/integrations/webhooks.js'
export {
  createOutboundPoster,
  isBlockedAddress,
  outboundErrorCategory,
} from './src/integrations/outbound.js'
export type {
  OutboundOptions,
  OutboundRequest,
  OutboundTarget,
  OutboundErrorCategory,
} from './src/integrations/outbound.js'
export {
  InboundWebhooks,
  inboundEventName,
  INBOUND_BODY_LIMIT,
  INBOUND_RETENTION_DAYS,
} from './src/integrations/inbound_webhooks.js'
export type {
  InboundSource,
  InboundSourceInput,
  InboundDelivery,
  InboundReceipt,
} from './src/integrations/inbound_webhooks.js'
export type {
  SecretBox,
  Webhook,
  WebhookDelivery,
  WebhookOptions,
  HttpPoster,
} from './src/integrations/webhooks.js'
export {
  MessageTemplates,
  DEFAULT_TEMPLATES,
  renderTemplate,
  notifyWithTemplate,
  deliverNotificationMail,
  listenForNotifications,
} from './src/core/message_templates.js'
export type {
  TemplateDefinition,
  MessageTemplate,
  RenderedMessage,
  MailSender,
  NotificationSignal,
} from './src/core/message_templates.js'
export { Assignments } from './src/collaboration/assignments.js'
export type {
  Assignment,
  AssignmentPage,
  AssignmentOptions,
  CloseNotePolicy,
  AssignmentStatus,
} from './src/collaboration/assignments.js'
export { RecordCollaboration, followerListeners } from './src/collaboration/record_collaboration.js'
export type {
  ActorLoader,
  CommentEntry,
  FieldChangeEntry,
  RecordCollaborationState,
  MentionCandidate,
} from './src/collaboration/record_collaboration.js'
export type { FieldChange } from './src/events/record_mutation.js'
export {
  registerUpload,
  findAttachment,
  loadAttachments,
  claimAttachment,
  releaseAttachment,
  summarizeAttachment,
  attachmentUrl,
  isAttachmentId,
  isRelativeDiskPath,
  attachmentPolicy,
  pendingUploadCount,
  staleUploads,
  forgetUpload,
  DEFAULT_ATTACHMENT_EXTENSIONS,
  PENDING_UPLOAD_LIMIT,
  UNBOUND_UPLOAD_TTL_MS,
} from './src/attachments/attachment_service.js'
export type {
  AttachmentRecord,
  AttachmentSummary,
  UploadInput,
  ClaimInput,
} from './src/attachments/attachment_service.js'
export {
  grantUpload,
  redeemUploadGrant,
  pruneUploadGrants,
  UPLOAD_GRANT_MAX_TTL_MS,
} from './src/attachments/upload_grants.js'
export type {
  UploadGrantInput,
  UploadGrant,
  RedeemedUploadGrant,
} from './src/attachments/upload_grants.js'
export { migrateStorage } from './src/attachments/storage_migrate.js'
export type {
  StorageDisk,
  StorageMigrationOptions,
  StorageMigrationResult,
} from './src/attachments/storage_migrate.js'
export { diagnoseAttachments } from './src/attachments/doctor.js'
export { Settings, sequence, formatSequence, notify } from './src/services/settings.js'
export type { NotificationTarget } from './src/services/settings.js'
export {
  uiPreferences,
  validateUiPreferences,
  UI_PREFERENCES_KEY,
  DEFAULT_UI_PREFERENCES,
} from './src/core/ui_preferences.js'
export type {
  UiPreferences,
  CalendarSystem,
  CalendarPreference,
} from './src/core/ui_preferences.js'
export { moveOrgUnit } from './src/org/org_service.js'
export { publishOutbox, consumeEvent } from './src/events/outbox.js'
export type { Jobs, DomainEvent, Listener } from './src/events/outbox.js'
export { AdonisJobs } from './src/events/adonis_jobs.js'
export { recordMutation } from './src/events/record_mutation.js'
export { assessBackup, verifyBackup } from './src/services/backup.js'
export type { BackupObject, BackupStatus } from './src/services/backup.js'
export { ActivityAdmin, logActivity } from './src/core/activity.js'
export type {
  ActivityEntry,
  ActivityFilters,
  ActivityPage,
  ActivityRow,
} from './src/core/activity.js'
export { RolesAdmin, ALL_SUBJECT_LABEL } from './src/core/roles.js'
export { seedModules } from './src/core/module_seed.js'
export type { ModuleSeedResult } from './src/core/module_seed.js'
export type {
  RoleSummary,
  RoleDetail,
  RoleRule,
  RuleInput,
  RoleMatrix,
  MatrixSubject,
  MatrixField,
} from './src/core/roles.js'
export { UsersAdmin } from './src/core/users.js'
export { UserInvitations, type InvitationDelivery } from './src/core/user_invitations.js'
export type { UserSummary, UserPage, UserRoleAssignment, UserOrgUnit } from './src/core/users.js'
export { OrgUnitsAdmin } from './src/core/org_units.js'
export type { OrgUnitNode } from './src/core/org_units.js'
export { SavedViews } from './src/core/saved_views.js'
export type { SavedView, SavedViewQuery } from './src/core/saved_views.js'
export { NotificationsAdmin } from './src/core/notifications.js'
export type { Notification, NotificationPage } from './src/core/notifications.js'
export {
  SettingsAdmin,
  isProtectedSetting,
  parseSettingValue,
  SETTING_SCOPES,
  PROTECTED_SETTING_KEYS,
} from './src/core/settings.js'
export type { SettingScope, SettingRow, SettingInput } from './src/core/settings.js'
export { LookupsAdmin } from './src/core/lookups.js'
export type {
  LookupFieldUse,
  LookupGroupSummary,
  LookupValue,
  LookupInput,
  LookupUpdate,
} from './src/core/lookups.js'
export { SequencesAdmin } from './src/core/sequences.js'
export type { SequenceRow } from './src/core/sequences.js'
export {
  runtimeHealth,
  isBackupStale,
  backupStale,
  heartbeat,
  HEARTBEAT_MAX_AGE_MS,
  BACKUP_MAX_AGE_MS,
} from './src/core/health.js'
export type {
  RuntimeHealth,
  HeartbeatStatus,
  QueueSnapshot,
  QueueCounts,
  FailedJob,
} from './src/core/health.js'
export { MailDeliveryTest, MAIL_TEST_KEY, type MailTestState } from './src/core/mail_test.js'
export { InitialSetup, type SetupCheck } from './src/core/setup.js'
export {
  administratorExists,
  grantInstallAdministrator,
  resolveInstallAdministrator,
} from './src/core/administrators.js'
export { ADULA_VERSION } from './src/version.js'
export {
  capabilityCatalog,
  SERVICES as CAPABILITY_SERVICES,
  FIELD_TYPES,
  WORKFLOW_STEPS,
} from './src/commands/capabilities.js'
export { createSyncJobsSchema } from './src/database/schema.js'
export {
  defineSyncJob,
  SyncJobs,
  SyncJobError,
  syncErrorCategory,
  SYNC_DEFAULT_TIMEOUT_MS,
} from './src/integrations/sync_jobs.js'
export type {
  SyncJobDefinition,
  SyncJobInput,
  SyncJobContext,
  SyncJobSummary,
  SyncJobsOptions,
  SyncSaveOptions,
  SyncRun,
  SyncRunStatus,
  SyncTrigger,
  SyncErrorCategory,
  SyncStats,
  SyncLogger,
} from './src/integrations/sync_jobs.js'
export { createNotificationChannelsSchema } from './src/database/schema.js'
export {
  NotificationChannels,
  HttpChannelSettings,
  ChannelDeliveryError,
  inAppChannel,
  mailChannel,
  httpNotificationChannel,
  phoneAddress,
  IN_APP_CHANNEL,
  MAIL_CHANNEL,
  CHANNEL_MAX_ATTEMPTS,
  HTTP_CHANNEL_SETTING_KEY,
  HTTP_CHANNEL_KINDS,
  CHANNEL_KIND_LABELS,
} from './src/core/notification_channels.js'
export type {
  NotificationChannel,
  ChannelLabel,
  ChannelMessage,
  ChannelRecipient,
  ChannelContext,
  ChannelDelivery,
  ChannelPreference,
  ChannelPreferenceInput,
  ChannelDispatchResult,
  HttpChannelOptions,
  HttpChannelKind,
  HttpChannelConfig,
  HttpChannelInput,
} from './src/core/notification_channels.js'
export { isSealedSetting } from './src/core/settings.js'
