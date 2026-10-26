# ADR 044 — Workflow engine: in-house transitions, delegation and SLA

Date: 2026-10-18. Status: proposed for the owner's acceptance under the post-review
programme (Phase 4). The parts that change behaviour today (delegation, SLA, the
transition lookup) are additive. Removing XState is a breaking change and waits for
the next major version.

## Context

The plan (adulajs-plan.md, Phase 4) chose XState 5 to run workflow definitions over
`workflow_runs`. Since then the engine has grown its own durable model. Each step runs
under the run's `FOR UPDATE` lock, inside a savepoint, with bounded retries. The
engine stores the state as `{ value: step }` in `workflow_runs.snapshot` and appends
every transition to `workflow_events`. GAPS.md also listed two missing business
features: approval delegation and SLA deadlines with escalation.

### Evidence: what the engine actually uses from XState

Measured on `packages/adula` at 4ca707e:

* **Call sites.** One file imports XState: `src/workflows/define_workflow.ts` uses
  `createMachine`, `machine.resolveState` and `getNextSnapshot`.
* **What it does.** The only runtime use is in `nextStep()`. It resolves the current
  step's state and asks for the target of one event, either `EVALUATE` with a
  condition guard, `APPROVE`/`REJECT`, `DECIDE` with an outcome guard, or `DONE`.
* **What is never used.** No actors and no `interpret`/`createActor`. No context,
  actions, delays, invoke, parallel or history states, and no persistence API. The
  engine writes its own snapshot shape (`{ value, until? }`) and never stores an
  XState snapshot.
* **Size.** The installed package is 2.6 MB. Bundling only `createMachine` and
  `getNextSnapshot` (esbuild, minified, ESM) gives 36,079 bytes, or 11,952 bytes
  gzipped. That code ships to every server and adds nothing to the browser.
* **Public API.** `WorkflowDefinition` exposes `machine: AnyStateMachine`. It is the
  only XState type in `api/adula-api.json`, and no consumer in this repository reads it.
* **Upgrade risk.** XState 5 is pinned (5.33.2). `getNextSnapshot` is one of the
  "pure transition" helpers that XState 5 has already reworked between minors. Each
  major of XState would force a review of an API we do not need. It also adds one more
  dependency to audit for a feature that a 30-line `switch` expresses.
* **Behaviour.** The step table already contains every transition: each step type
  names its targets (`then`/`else`, `approve`/`reject`, `outcomes[].next`, `next`).
  `defineWorkflow` already validates them (`targets()`).

## Decision

1. **Replace XState with the step table.** `nextStep()` resolves transitions directly
   from the definition's steps. It gives the same result for every step type and
   event, with one intentional difference: an approval or decision step may name
   itself as its next step, which reopens it ("ask again"). The old lookup refused
   that because the snapshot value did not change. Any other step naming itself would
   repeat its effect (notifications, HTTP calls) without end, so `defineWorkflow`
   refuses it, and the engine fails such a run permanently if a hand-built definition
   slips through.
2. **Compatibility now, removal in the next major.** `WorkflowDefinition.machine` is
   still compiled and is marked `@deprecated`. The public type therefore does not
   change in this minor, and the `xstate` dependency stays until the next major
   version. Migration path for that release:
   * remove `machine` from `WorkflowDefinition`;
   * drop `createMachine` from `defineWorkflow`;
   * remove `xstate` from `packages/adula/package.json`, `adulajs-plan.md` and the
     dependency list;
   * record the change in `docs/upgrade-<major>.md` ("read transitions with
     `nextStep`; `machine` is gone");
   * `pnpm check:api` will report `WorkflowDefinition` as changed, which is expected
     for a major.
3. **Delegation (out-of-office).**
   * **Table.** `workflow_delegations` stores delegator, delegate, inclusive UTC
     dates, a note, the creator and the revocation. `WorkflowDelegations` creates and
     revokes delegations. It refuses delegating to oneself, a disabled delegate,
     overlapping ranges (under a lock on both user rows), ranges that ended and ranges
     longer than a year. It records `delegation_created` and `delegation_revoked` in
     the activity log and notifies the delegate (`workflow.delegated`).
   * **New approvals.** While a delegation is in force, a new approval for the
     delegator opens for the delegate. The assignment keeps `on_behalf_of` and
     `delegation_id`. This happens only when the delegate can view the record;
     otherwise the delegator keeps the approval.
   * **Pending approvals.** The delegator's pending approvals are visible to the
     delegate and can be decided by them (My tasks, the approvals inbox,
     `WorkflowRun.myApproval.onBehalfOf`).
   * **Limits.** Delegation covers workflow approvals only, never manual tasks. It
     never widens record access: every read and decision still checks the record with
     the delegate's own rights. Its effect ends at expiry or revocation. The delegator
     can always decide their own approvals, including those routed to the delegate.
     Routing is one hop and goes only to someone who can act. When the delegate is away
     and delegating in turn, the approval stays with the approver, so routing never
     chains to a second delegate.
   * **No self-approval.** A delegate never holds an approval of a run they started:
     such an approval is not routed to them, and the delegator's pending one is not
     offered to them.
   * **Revocation and expiry.** Revoking a delegation returns its open routed
     approvals to the approver. After a delegation ends, approvals routed through it
     follow the approver: the approver and, once the approver delegates again, the new
     delegate hold them. SLA notices go to whoever can act now: the delegate the
     approval was routed to while that delegation lasts, otherwise the approver or the
     approver's current delegate.
   * **Escalation targets.** These never include the person who started the run. A
     policy left with nobody falls back to marking the approval overdue.
   * **The delegate picker.** It searches active users by name (two characters or
     more), or by an exact e-mail address. It returns only the id and the display
     name, so it cannot list the user directory.
   * **Audit.** `assignments.completed_by` is the user who acted. The run's history
     event records `onBehalfOf` and `onBehalfOfName`, and pages show «نيابة عن ...».
4. **SLA and escalation.**
   * **Step option.** Approval and decision steps take
     `sla: { hours, dueSoonHours?, escalate? }`. `dueSoonHours` defaults to a quarter
     of `hours`; 0 disables the reminder. `escalate` is one of:
     * `{ action: 'overdue' }`, the default: tell the approvers;
     * `{ action: 'notify', to }`: also tell a target;
     * `{ action: 'reassign', to }`: cancel the late approvals and open new ones for
       the target, keeping the original deadline.
   * **Targets.** A target is any `Recipients`, or `{ manager: roleKey }`: the
     holders of that role scoped (through `user_roles.org_unit_id`) to the approver's
     organizational unit. If none hold it there, the nearest ancestor unit is used.
   * **Stored deadline.** Assignments store `due_at` and `due_soon_at`. `due_on`
     keeps the calendar date.
   * **The `sla:` job family.** The `sla:evaluate` command runs every minute without
     overlap. Each pass, `WorkflowEngine.evaluateSla()`:
     * sends one due-soon reminder (`workflow.sla_due_soon`) per approval;
     * runs the escalation policy once per overdue step (`workflow.sla_overdue`,
       `workflow.sla_escalated`) under the run's row lock.
   * **Idempotency.** `workflow_escalations` (unique per assignment and level) makes
     repeated or concurrent passes no-ops. Notifications go through
     `notifyWithTemplate`, the existing notification API.
   * **No target found.** A policy whose target finds nobody eligible still marks the
     approval overdue and records the reason.
   * **States.** `slaState()` gives `on_time`, `due_soon` or `overdue`.
     `WorkflowRun.sla` and `Assignment.sla` carry the state, and pages show «في
     الموعد / يقترب الموعد / متأخر».
5. **Time.** The clock comes from `WorkflowOptions.now`, `AssignmentOptions.now` and
   `WorkflowDelegationOptions.now`, so tests control it. Delegation dates compare with
   the UTC calendar date, like `dueOn`. AdulaJS has no system time-zone setting yet,
   so a delegation dated 1 to 3 November runs in Riyadh (UTC+3) from 03:00 on
   1 November to 02:59 on 4 November. Interpreting the dates in the system's time
   zone is the follow-up once such a setting exists.

## Consequences

* **Migration.** The additive migration `1770000000046_workflow_delegation_sla`
  creates two tables, adds six nullable columns to `assignments` and indexes the
  routed approvals (`on_behalf_of`, `delegation_id`). Its number follows the ADR,
  because sibling branches hold `…041` to `…043`.
* **API report.** `pnpm check:api` reports the additions and these changed types:
  `WorkflowStep` (optional `sla`), `WorkflowRun` (optional `sla`,
  `myApproval.onBehalfOf`, `history[].onBehalfOfName`), `Assignment` (optional
  `onBehalfOf`, `dueAt`, `sla`), `AssignmentOptions` (optional `now`). Every new field
  is optional; existing code compiles unchanged.
* **Deployments.** Existing deployments must schedule `sla:evaluate`. The reference
  scheduler (`start/scheduler.ts`) does, and systems created from it inherit it.
  Without the job, deadlines are shown but nothing escalates.
* **Not covered.**
  * Business calendars (working days and holidays) are not modelled: SLA hours are
    wall-clock hours.
  * Delegation dates are UTC days (in Riyadh, a day starts at 03:00).
  * Escalation runs once per opening of a step; there is no chain of escalation
    levels.
  * These limits are listed in GAPS.md.
