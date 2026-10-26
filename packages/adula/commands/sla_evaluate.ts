import { BaseCommand } from '@adonisjs/core/ace'

/**
 * The `sla:` job family (ADR 044): reminds approvers before their deadline and runs
 * each overdue step's escalation policy once. The application owns the engine wiring in
 * `#services/workflow_sla`; the scheduler runs this every minute without overlap.
 */
export default class SlaEvaluate extends BaseCommand {
  static commandName = 'sla:evaluate'
  static description = 'Remind approvers before SLA deadlines and escalate overdue approvals'
  static options = { startApp: true }
  async run() {
    const { evaluateWorkflowSla } = (await this.app.import('#services/workflow_sla')) as {
      evaluateWorkflowSla: () => Promise<{ reminded: number; escalated: number }>
    }
    const { reminded, escalated } = await evaluateWorkflowSla()
    this.logger.info(`SLA: ${reminded} reminders, ${escalated} escalations`)
  }
}
