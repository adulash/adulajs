import { BulkActions, type BulkActionSet } from 'adula'
import { testFixturesEnabled } from '#start/test_fixtures'
import { registry } from '#start/modules'
// adula:imports
/** Resource-defined bulk actions (ADR 046); delete, restore, submit and cancel are built in. */
export const bulkActions: BulkActionSet[] = [/* adula:bulk_actions */]
if (testFixturesEnabled) {
  const { fixtureBulkActions } = await import('#tests/fixtures/bulk_actions')
  bulkActions.push(...fixtureBulkActions)
}
// Checked once at boot: a bad definition stops the application before any request.
BulkActions.validate(registry, bulkActions)
