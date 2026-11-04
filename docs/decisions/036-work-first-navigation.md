# ADR 036 — One "My tasks" page and a work-first sidebar (1.2.0)

Date: 2026-09-29. Status: accepted by the owner on 2026-09-30.

Issues #35 and #34. An approval request appeared both in "My tasks" and in the approvals
inbox, but could be decided only in the inbox. The sidebar listed kit links without
grouping and without checking permissions, and they crowded out the business modules.

## Decisions

1. **One "My tasks" page (#35).** Tabs: all open items, waiting for my decision, assigned
   tasks, closed. `Assignments.mine()` takes a `kind` filter (`approval` or `task`),
   counts open approvals (`AssignmentPage.approvals`) and marks the rows the user can
   decide now (`Assignment.canDecide`, the checks `WorkflowEngine.decide()` applies).
   Approval and decision rows are decided in place with the same `WorkflowDecision`
   dialog as before, including named outcomes from ADR 031. The page loads the runs of
   its own decidable rows with `WorkflowEngine.inbox(actor, { runIds })`, on the first
   page and on every "load more" page (the JSON response carries them as `decisions`). Manual tasks keep the closing-note dialog from ADR 029.
   `/approvals` redirects pages to `/my-tasks?tab=approvals` and keeps its JSON inbox for
   integrations. Earlier `?status=` links still work.
2. **A work-first sidebar (#34).** Daily work comes first: overview, My tasks with an
   open-items badge, and imports only for users who can create records. The module
   groups follow, collapsible and labelled from `Module.label`
   (`ResourceNavigation.moduleLabel`). Administration is one entry for administrators,
   with a badge for failed workflows or a stale backup. Inside the administration area it
   expands into people and permissions, settings, and monitoring, with the one-time setup
   first until it is complete (`/admin` opens it). The duplicate home link and the
   workspace card are removed, and inviting moves to the account area.

## Consequences

- The shell props of every page now include the setup state for administrators. Reading
  it hashes the identity files, so the starter re-reads them only when their size or
  modification time changes.
- The "My tasks" badge and page header count every open assignment of the user; the
  list hides tasks on records the user can no longer read, so the two can differ in
  that rare case. Filtering the count per record on every page was not worth its cost.

- `Assignment.canDecide`, `AssignmentPage.approvals` and `ResourceNavigation.moduleLabel`
  are optional members (owner's decision, 2026-09-30), so code that builds these objects
  itself keeps compiling in a minor release. The kit always fills them; readers treat a
  missing value as `false`, `0` or the module key.
- Projects with the starter's `layouts/workspace.tsx`, `components/admin-nav.tsx`,
  `pages/work/my_tasks.tsx`, `assignments_controller.ts` or `workflows_controller.ts`
  need the updated files; `pages/work/approvals.tsx` is removed.
- Kit tests cover `kind`, `approvals` and `canDecide`; reference browser tests cover the
  redirect, deciding from My tasks (approval and decision steps), the closing-note dialog
  and the sidebar for administrators and ordinary users.

## Addendum (2.2.1): resources read only for titles

A role often reads another application's resource only to name its records: relation
titles, pickers and the parent check of `scope.from` (ADR 029). `navigation()` leaves out a
resource when every rule that grants the actor `view` on it is limited (`fields`) to the
resource's title fields and the actor may not create its records, so that application is
not presented to the role (#141). A rule meant only for references therefore names title
fields; declare the resource's `title` when the default title fields are not the ones the
role needs. A `reference` flag on rules was not added in a patch release.
