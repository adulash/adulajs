/**
 * Calendar days of the system (ADR 044). Due dates and delegation ranges are whole days
 * in the system's time zone (an IANA name such as Asia/Riyadh; UTC by default), so a
 * day starts at local midnight rather than at 00:00 UTC.
 */
const formats = new Map<string, Intl.DateTimeFormat>()
const knownZones = new Set<string>()

/**
 * Refuses a time zone the runtime does not know, at construction rather than per call.
 * Services are built per request, so each zone is checked with Intl only once.
 */
export function assertTimeZone(timeZone: string) {
  if (knownZones.has(timeZone)) return timeZone
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone })
  } catch {
    throw new Error(`Unknown time zone "${timeZone}"; use an IANA name such as Asia/Riyadh`)
  }
  knownZones.add(timeZone)
  return timeZone
}

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function calendarDate(instant: Date, timeZone = 'UTC') {
  let format = formats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formats.set(timeZone, format)
  }
  const parts = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** A calendar date moved by whole days. */
export function addDays(date: string, days: number) {
  const moved = new Date(`${date}T00:00:00Z`)
  moved.setUTCDate(moved.getUTCDate() + days)
  return moved.toISOString().slice(0, 10)
}
