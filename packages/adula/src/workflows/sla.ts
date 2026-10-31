/** Where an approval stands against its SLA deadline (ADR 044). */
export type SlaState = 'on_time' | 'due_soon' | 'overdue'
export type WorkflowSlaStatus = {
  dueAt: string
  state: SlaState
  /** The deadline passed and the step's escalation policy ran. */
  escalated: boolean
}
/** What one SLA evaluation did: reminders sent and steps escalated. */
export type SlaEvaluation = { reminded: number; escalated: number }

/** The SLA state of a deadline at `now`; `dueSoonAt` null means no due-soon window. */
export function slaState(dueAt: Date, dueSoonAt: Date | null, now: Date): SlaState {
  if (now.getTime() >= dueAt.getTime()) return 'overdue'
  if (dueSoonAt && now.getTime() >= dueSoonAt.getTime()) return 'due_soon'
  return 'on_time'
}
