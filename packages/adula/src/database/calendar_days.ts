import type { Database } from '@adonisjs/lucid/database'

/** PostgreSQL's type OID for DATE (a calendar day without a time or zone). */
export const POSTGRES_DATE_OID = 1082
/** PostgreSQL's type OID for DATE[] (for example `array_agg(day)`). */
export const POSTGRES_DATE_ARRAY_OID = 1182
/** PostgreSQL's type OID for TEXT[]; its parser returns the elements as strings. */
const POSTGRES_TEXT_ARRAY_OID = 1009

type Parser = (value: string) => unknown
type PgDriver = {
  types?: {
    setTypeParser(oid: number, parser: Parser): void
    getTypeParser?(oid: number, format?: string): Parser
  }
}

/**
 * node-postgres turns a DATE into a JavaScript Date at local midnight, so in any time zone
 * east of UTC `toISOString()` reports the previous day. A calendar day never passes
 * through local time in AdulaJS: every PostgreSQL connection returns DATE as the
 * 'YYYY-MM-DD' text the server sent, and DATE[] as an array of those strings (null
 * elements stay null). node-postgres keeps one parser registry per driver, so this
 * covers every query: resources, module code and raw Lucid queries alike.
 *
 * `manager.connect(name)` only builds the connection's Knex client (the pool opens no
 * socket until the first query); it is needed because the driver whose registry must be
 * changed is reachable only through that client, and the change has to be in place
 * before any query parses a DATE. Connecting an already connected name is a no-op.
 */
export function keepCalendarDays(db: Pick<Database, 'config' | 'manager' | 'getRawConnection'>) {
  for (const [name, config] of Object.entries(db.config.connections)) {
    if (!['pg', 'postgres', 'postgresql'].includes(config.client)) continue
    db.manager.connect(name)
    const connection = db.getRawConnection(name)?.connection
    for (const client of [connection?.client, connection?.readClient]) {
      const types = (client?.client as { driver?: PgDriver } | undefined)?.driver?.types
      if (!types) continue
      types.setTypeParser(POSTGRES_DATE_OID, (value) => value)
      const textArray = types.getTypeParser?.(POSTGRES_TEXT_ARRAY_OID, 'text')
      if (textArray) types.setTypeParser(POSTGRES_DATE_ARRAY_OID, textArray)
    }
  }
}
