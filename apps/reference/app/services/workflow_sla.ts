import { adula } from '#services/adula'

/** One pass of the `sla:` jobs: due-soon reminders and overdue escalations (ADR 044). */
export async function evaluateWorkflowSla() {
  let reminded = 0
  let escalated = 0
  // A busy system can have more due items than one pass takes; drain them in bounded passes.
  for (let pass = 0; pass < 10; pass++) {
    const result = await adula().workflows.evaluateSla({ limit: 100 })
    reminded += result.reminded
    escalated += result.escalated
    if (result.reminded + result.escalated < 100) break
  }
  return { reminded, escalated }
}
