/**
 * Runs in a child process whose TZ the parent test chooses: boots AdulaProvider over a real
 * Lucid Database and reports how DATE values read back. Prints one JSON line.
 */
import { Database } from '@adonisjs/lucid/database'
import { Logger } from '@adonisjs/core/logger'
import AdulaProvider from '../../providers/adula_provider.js'

type TarnPool = { numUsed(): number; numFree(): number; numPendingCreates(): number }
const connection = JSON.parse(process.env.ADULA_CALENDAR_DAYS_CONNECTION!)
const emitter = { emit: async () => {}, hasListeners: () => false }
const db = new Database(
  { connection: 'postgres', connections: { postgres: { client: 'pg', connection } } },
  new Logger({ enabled: false }),
  emitter as never
)
const app = {
  container: { hasBinding: (key: string) => key === 'lucid.db', make: async () => db },
}
await new AdulaProvider(app as never).boot()
try {
  // Booting builds the Knex client only: no connection is opened before the first query.
  const pool = (db.connection('postgres').getWriteClient().client as { pool?: TarnPool }).pool
  const openBeforeQuery = pool ? pool.numUsed() + pool.numFree() + pool.numPendingCreates() : 0
  const raw = await db.rawQuery(
    "SELECT DATE '2026-09-18' AS day, DATE '2024-02-29' AS leap, ARRAY[DATE '2026-09-18', NULL, DATE '2024-02-29'] AS days"
  )
  const stored = await db.transaction(async (trx) => {
    await trx.rawQuery('CREATE TEMP TABLE calendar_days (day date) ON COMMIT DROP')
    await trx.table('calendar_days').insert({ day: '2017-10-14' })
    return trx.from('calendar_days').first()
  })
  const day = (value: unknown) =>
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : new Date(String(value)).toISOString().slice(0, 10)
  console.log(
    JSON.stringify({
      offset: new Date(2026, 8, 18).getTimezoneOffset(),
      raw: raw.rows[0].day,
      rawDay: day(raw.rows[0].day),
      leapDay: day(raw.rows[0].leap),
      storedDay: day(stored.day),
      days: raw.rows[0].days,
      openBeforeQuery,
    })
  )
} finally {
  await db.manager.closeAll()
}
