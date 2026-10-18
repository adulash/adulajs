/**
 * Names used by 1.x releases, published as `@adula/kit`. They exist only so that
 * `adula:upgrade` and migration 016 can find and rename what 1.x installed; nothing
 * else may read or write them. This file is the only place for the retired name in
 * the core package; review is the only guard now (ADR 040).
 */
const RETIRED = 'kit'

/** Directory Lucid recorded for each 1.x core migration. */
export const LEGACY_MIGRATIONS_PATH = `node_modules/@adula/${RETIRED}/build/database/migrations`
export const MIGRATIONS_PATH = 'node_modules/adula/build/database/migrations'

/** Every core migration shipped before 2.0.0, by its 2.0 file name. */
export const MIGRATIONS_BEFORE_2_0 = [
  '1770000000000_core',
  '1770000000001_attachments',
  '1770000000002_saved_views',
  '1770000000003_user_invitations',
  '1770000000004_collaboration',
  '1770000000005_assignments',
  '1770000000006_messaging',
  '1770000000007_webhooks',
  '1770000000008_imports',
  '1770000000010_workflows',
  '1770000000011_managed_assignments',
  '1770000000012_role_keys',
  '1770000000013_notification_targets',
  '1770000000014_upload_grants',
  '1770000000015_inbound_webhooks',
] as const

/** `1770000000000_core` -> the file name 1.x used for the same migration. */
export function legacyMigrationFile(name: string) {
  return name.replace(/^(\d{13})_/, `$1_${RETIRED}_`)
}

/** Recorded `adonis_schema.name` of a 1.x core migration -> its 2.0 name, or undefined. */
export function renamedMigration(recorded: string) {
  if (!recorded.startsWith(`${LEGACY_MIGRATIONS_PATH}/`)) return undefined
  const file = recorded.slice(LEGACY_MIGRATIONS_PATH.length + 1)
  const current = MIGRATIONS_BEFORE_2_0.find((name) => legacyMigrationFile(name) === file)
  return current ? `${MIGRATIONS_PATH}/${current}` : undefined
}

/** Database objects created by 1.x, with their 2.0 names. */
export const LEGACY_DATABASE = {
  authFunction: [`${RETIRED}_bump_auth_revision`, 'adula_bump_auth_revision'],
  authTrigger: [`${RETIRED}_invalidate_auth`, 'adula_invalidate_auth'],
  notificationSignal: [`${RETIRED}_notification_signal`, 'adula_notification_signal'],
  notificationChannel: [`${RETIRED}_notifications`, 'adula_notifications'],
  versionSetting: [`${RETIRED}.version`, 'adula.version'],
  listenerPrefix: [`${RETIRED}.`, 'adula.'],
} as const

/** Application files 1.x created or read. */
export const LEGACY_FILES = {
  gaps: [`${RETIRED.toUpperCase()}_GAPS.md`, 'GAPS.md'],
} as const

/** Managed AGENTS.md block markers written by 1.x. */
export const LEGACY_MARKERS = {
  start: `<!-- adula-${RETIRED}:start`,
  end: `<!-- adula-${RETIRED}:end -->`,
} as const
