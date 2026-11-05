import type { Knex } from 'knex'

/** The UTC calendar day a token budget counts against. */
export function usageDay(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

/**
 * Reserves `estimate` tokens against the user's daily budget in one statement. The budget
 * is checked on both branches: a first request already over budget inserts nothing, and a
 * concurrent request sees the row the other one locked. Returns false when it does not fit.
 */
export async function reserveTokens(
  db: Knex,
  userId: number,
  day: string,
  estimate: number,
  budget: number
): Promise<boolean> {
  const result = await db.raw(
    `INSERT INTO ai_usage (user_id, day, reserved, requests)
     SELECT ?, ?::date, ?, 1 WHERE ?::integer <= ?::integer
     ON CONFLICT (user_id, day) DO UPDATE
       SET reserved = ai_usage.reserved + EXCLUDED.reserved, requests = ai_usage.requests + 1
       WHERE ai_usage.prompt_tokens + ai_usage.completion_tokens + ai_usage.reserved
         + EXCLUDED.reserved <= ?::integer
     RETURNING user_id`,
    [userId, day, estimate, estimate, budget, budget]
  )
  return result.rows.length === 1
}

/** Releases a reservation and charges the tokens the provider reported, atomically. */
export async function settleTokens(
  db: Knex,
  userId: number,
  day: string,
  reserved: number,
  used: { prompt: number; completion: number }
) {
  await db.raw(
    `UPDATE ai_usage SET reserved = GREATEST(reserved - ?, 0),
       prompt_tokens = prompt_tokens + ?, completion_tokens = completion_tokens + ?
     WHERE user_id = ? AND day = ?::date`,
    [reserved, used.prompt, used.completion, userId, day]
  )
}

/** Tokens still available today (reservations count as spent). */
export async function remainingTokens(db: Knex, userId: number, day: string, budget: number) {
  const row = await db('ai_usage').where({ user_id: userId, day }).first()
  const spent = row
    ? Number(row.prompt_tokens) + Number(row.completion_tokens) + Number(row.reserved)
    : 0
  return Math.max(budget - spent, 0)
}
