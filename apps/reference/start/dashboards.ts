import { Dashboards, type DashboardDefinition } from 'adula'
import { testFixturesEnabled } from '#start/test_fixtures'
import { registry } from '#start/modules'
// adula:imports
/** Indicator pages (ADR 046), served at /dashboards/:name; each widget is read as the viewer. */
export const dashboards: DashboardDefinition[] = [/* adula:dashboards */]
if (testFixturesEnabled) {
  const { fixtureDashboards } = await import('#tests/fixtures/dashboards')
  dashboards.push(...fixtureDashboards)
}
// Checked once at boot: a bad definition stops the application before any request.
Dashboards.validate(registry, dashboards)
