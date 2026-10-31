# Applications in a system

A company runs one AdulaJS deployment: the **system** (النظام). Each business area inside it,
such as assets, maintenance or HR, is an **application** (تطبيق). An application is a module
under `app/modules/<name>`, registered in `start/modules.ts`. Do not run a separate deployment
per business area: applications in one system share data and people.

## What an application shares

Every application in a system uses the same:

- **Users and sign-in.** One account per person, one login, one session for the whole system.
- **Roles.** An application ships default roles; administrators assign them on the same roles
  screen as every other role, and a person can hold roles from several applications.
- **Organisation tree.** Scoped resources belong to an organisation unit, so departments and
  branches limit what each person sees across all applications.
- **Notifications and the task inbox.** Assignments, workflow approvals and mentions from every
  application arrive in one inbox ("my tasks") and one notification list.
- **Lookups and sequences.** Values of a lookup group, and numbering sequences, are managed on
  the administration screens `/admin/lookups` and `/admin/sequences`.
- **Audit.** Every change lands in the same activity log.

## Add an application

```bash
node ace adula:app leave_requests --label-ar="طلبات الإجازة" --label-en="Leave requests"
```

| Option | Meaning |
| --- | --- |
| `<name>` | Slug: lowercase letters, digits and `_`, starting with a letter, at most 40 characters. Reserved framework names (`admin`, `users`, `roles`, `lookups` …) and existing applications are refused. |
| `--label-ar` | Required Arabic label; it names the application's menu group. |
| `--label-en` | Optional English label; defaults to the title-cased name. |
| `--dry-run` | Prints every folder and file it would create and the `start/modules.ts` change; writes nothing. |

The command creates:

- `app/modules/<name>/module.ts`: the labels, `dependsOn: []`, the example resource and two
  default roles, `<name>_manager` (view, create, update, delete) and `<name>_user` (view,
  create, and update only the records the user created).
- One example resource named after the application, generated like `adula:resource`:
  definition, create-migration and its security contract test. Validation, columns and
  forms derive from the definition; no validator, model or factory is written.
- The empty module folders (`models`, `resources`, `validators`, `migrations`, `workflows` …).
- A smoke test, `tests/functional/<name>/smoke.spec.ts`, that opens the resource list as an
  administrator and checks the application's menu group.
- The registration in `start/modules.ts` behind the `/* adula:modules */` marker.

Then:

1. `node ace migration:run`.
2. Fill the example resource (fields, list, form; see [resource definitions](resources.md)),
   then `node ace adula:resource:migration <name>` and `node ace migration:run` again to add
   the new columns. Update the contract fixture in `tests/functional/<name>.spec.ts`.
3. `node ace adula:install` creates the default roles and lookup values that are missing. It
   never changes a role or lookup row that already exists, so administrators own them after
   installation.
4. Assign the roles to people on `/admin/users`, then run the tests.

Add further resources with `node ace adula:resource <resource> --module=<name>`.

## Integrate with the company's other software

A system talks to the outside through shared, audited channels, never through direct database
access:

- **API.** `/api/v1` exposes the resource operations with the token owner's current
  permissions; people create API tokens under their account menu and
  `/api/v1/openapi.json` describes what the caller may use. See
  [API tokens and OpenAPI](business-features.md#api-tokens-and-openapi).
- **Outgoing webhooks.** Signed deliveries of domain events to subscribed HTTPS endpoints. See
  [Outgoing webhooks](business-features.md#outgoing-webhooks).
- **Inbound webhooks.** Signed events from other software, raised as `inbound.<key>.<event>`
  and handled by an application's idempotent listeners. See [Inbound webhooks](business-features.md#inbound-webhooks).
- **Imports.** CSV imports into any resource, validated like the form. See
  [CSV import](business-features.md#csv-import).

## End-to-end example: leave requests

The test fixture `apps/reference/tests/fixtures/modules/leave_requests` was scaffolded with the
command above and then filled in. Following ADR 017 it is a test fixture only: it is registered
through `tests/fixtures/modules.ts`, never in the reference system's normal menu.

What was added after scaffolding:

- The resource fields: employee (a user), start and end dates, reason, and a status lookup.
- A lookup group declared by the module, seeded by `adula:install`:

  ```ts
  lookups: {
    leave_request_status: [
      { key: 'pending', label: { ar: 'قيد المراجعة', en: 'Pending' } },
      { key: 'approved', label: { ar: 'معتمد', en: 'Approved' } },
      { key: 'rejected', label: { ar: 'مرفوض', en: 'Rejected' } },
    ],
  },
  ```

`apps/reference/tests/functional/leave_requests_app.spec.ts` checks the result end to end on
PostgreSQL:

- After seeding, an administrator sees `leave_requests_manager` and `leave_requests_user` with
  their rules on the roles screen, and seeding again changes nothing.
- The administrator's menu has the «طلبات الإجازة» group.
- A holder of `leave_requests_user` lists and creates requests and edits their own, but cannot
  edit another person's request or delete one; the manager can.

The command itself is covered by `packages/adula/tests/app_command.spec.ts`, which runs
`node ace adula:app` in a temporary copy of the reference system and typechecks the result.
