# create-adulajs

<div dir="rtl" lang="ar">

**create-adulajs** هو الأمر الذي يُنشئ **نظامًا** جديدًا لشركتك بإطار عدولة (AdulaJS) من مجلد فارغ، بأمر واحد:

`npm create adulajs my-system`

يطلب منك اسم الشركة وبريد مدير النظام وهويتها البصرية، ثم يجهّز كل شيء:

• خادم الويب (AdonisJS) والواجهة العربية من اليمين إلى اليسار.

• قاعدة البيانات PostgreSQL وخادم Redis داخل حاويات Docker محلية، أو خوادمك الموجودة.

• تسجيل الدخول وشاشات الإدارة والمستخدمين والأدوار.

• حساب مدير النظام، وتُحفظ كلمة مروره في ملف خاص لا يُرفع إلى Git.

بعدها تضيف إلى النظام **تطبيقات** لمجالات العمل، مثل الإجازات أو الأصول أو الصيانة، بالأمر `node ace adula:app`.

</div>

`create-adulajs` creates a complete, project-owned AdonisJS 7 business system with AdulaJS,
React/Inertia, shadcn/ui, authentication, administration and the managed business-design
skill. The business areas you then add inside the system (assets, maintenance, HR and so on)
are its applications, each implemented as a module under `app/modules/<name>`.

## Quick start

```sh
npm create adulajs my-system
cd my-system
npm run dev
```

The same creator also runs as `npx create-adulajs@latest my-system`. Then add an
application, which writes an example resource named after it:

```sh
node ace adula:app leave_requests --label-ar="طلبات الإجازة" --label-en="Leave requests"
```

then replace the generated example resource with:

```ts
// app/modules/leave_requests/resources/leave_requests.ts
import { defineResource } from 'adula'

export default defineResource({
  name: 'leave_requests',
  label: { ar: 'طلبات الإجازة', en: 'Leave requests' },
  recordLabel: { ar: 'طلب إجازة', en: 'Leave request' },
  scoped: true,
  fields: {
    title: { type: 'string', required: true, searchable: true, label: { ar: 'موضوع الطلب' } },
    employee: { type: 'user', required: true, label: { ar: 'الموظف' } },
    startDate: { type: 'date', required: true, label: { ar: 'تاريخ البداية' } },
    endDate: { type: 'date', required: true, label: { ar: 'تاريخ النهاية' } },
  },
  list: ['title', 'employee', 'startDate', 'endDate'],
  form: ['title', 'employee', 'startDate', 'endDate'],
  show: ['title', 'employee', 'startDate', 'endDate'],
  actions: ['view', 'create', 'update', 'delete'],
})
```

The [leave-requests tutorial](https://github.com/adulash/adulajs/blob/main/docs/tutorial-leave-requests.md)
continues from here: migrations, roles, an approval workflow with delegation and SLA, list
filters, saved views and a dashboard.

## What you get

* An AdonisJS 7 host with React 19/Inertia, Tailwind CSS 4 and project-owned shadcn/ui
  components, right to left and in Arabic.
* Sign-in, password recovery, invitations, optional SSO and two-factor authentication,
  users, roles, the organization tree, lookups, sequences, message templates, webhooks,
  API tokens, imports, workflows and dashboards.
* PostgreSQL 17 and Redis 7 in local Docker containers, or your existing servers.
* Fresh development and `_test` databases with migrations applied, the first administrator,
  the managed agent skills, a doctor check, type checks and built assets.
* No educational applications: the system starts empty of business modules.

The creator always installs the matching `adula` and `@adula/ui` version. To move a 1.x
system to the current AdulaJS, run `npx create-adulajs@latest upgrade` in it; see the
[upgrade guide](https://github.com/adulash/adulajs/blob/main/docs/upgrade-2.0.md).

## Documentation

| Topic | Guide |
| --- | --- |
| Create a system | [Installation](https://github.com/adulash/adulajs/blob/main/docs/installation.md) |
| After the first sign-in | [Initial setup](https://github.com/adulash/adulajs/blob/main/docs/initial-setup.md) |
| Build an application step by step | [Leave-requests tutorial](https://github.com/adulash/adulajs/blob/main/docs/tutorial-leave-requests.md) |
| Applications in a system | [Applications](https://github.com/adulash/adulajs/blob/main/docs/applications.md) |
| Fields, validation, migrations | [Resource definitions](https://github.com/adulash/adulajs/blob/main/docs/resources.md) |
| Deploy, back up, restore | [Operations](https://github.com/adulash/adulajs/blob/main/docs/operations.md) |
| The core package | [adula README](https://github.com/adulash/adulajs/blob/main/packages/adula/README.md) |

## Options

```text
npm create adulajs my-system
npx create-adulajs@latest my-system

  --company "Company name"     Company display name (Arabic supported)
  --admin-email email          Administrator email
  --identity brand.json        Company logo, primaryColor, fontFamily and guidelines
  --services docker|existing   Default: Docker; requires Docker Compose
  --connection local.json      PostgreSQL and Redis profile for existing services
  --database name              Fresh database name (starts with a lowercase letter); existing databases are rejected
  --packages directory         Local core and UI archives for pre-publication testing
  --yes                        Noninteractive; requires the directory, company and administrator email
  --help                       Show help

npx create-adulajs@latest upgrade [directory]

  --force                      Rewrite even when git reports uncommitted changes
  --no-install                 Rewrite files only; install dependencies yourself
  --packages directory         Local core and UI archives instead of the registry
```

Without `--yes`, the wizard asks for whatever is missing. A non-interactive run supplies everything:

```sh
npx create-adulajs@latest my-system --company "My company" --admin-email admin@example.com --identity ./brand.json --yes
```

## Requirements and services

Requires Node.js 24+ and npm. The default provisions PostgreSQL 17 and Redis 7
through an existing Docker installation with Compose. pnpm is bootstrapped through
npm and installed as a project-local development dependency; neither a global
pnpm installation nor a pre-existing AdonisJS application is required.

Use a lowercase directory such as `dental-gate`; the company display name can be
`Dental-Gate`. The creator checks a supplied directory and Docker before asking
for company details or creating project files.

Setup first checks `docker version` and `docker compose version` directly.
Only when either fails on Windows does it try Docker in the default WSL
distribution. When WSL Docker is selected, Node.js
and system files remain on Windows; Compose runs through `wsl.exe --exec`.
The generated README records the matching service start/stop command.

The selected backend is saved in `scripts/docker-backend.json`. Installation,
`npm run dev`, `npm test`, `npm run ace -- migration:run`, `npm run services`, and
`npm run services:stop` use that backend without switching daemons on failure.
Development, tests and Ace commands start Compose and wait for healthy services.
Only the WSL fallback holds a foreground WSL session, since systemd services alone
do not keep WSL alive. Direct Docker never starts that session. To run raw
`node ace` commands, keep `npm run services` open in another terminal. Stopping
services retains the volumes; no global WSL settings are changed.

If Docker is absent, the interactive wizard asks for explicit permission before
installing Docker Desktop using `winget`. Pressing Enter or answering no never
installs software: you can supply an existing-services profile or cancel. Windows
may request administrator approval or a restart; complete Docker Desktop setup
and rerun the same command if needed. No system files/databases are created
before the service preflight succeeds. `--yes` never authorizes host installation.
On other operating systems, setup provides installation guidance and the existing
services alternative. Failed engine or Compose probes allow the Windows fallback.
Existing PostgreSQL 17 **and Redis** are supported via the connection profile below.

Host installation references: [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
and [WinGet install options](https://learn.microsoft.com/windows/package-manager/winget/install).

### Existing services

For existing services, add `--services existing --connection ./local.json`:

```json
{
  "postgres": {
    "host": "127.0.0.1",
    "port": 5432,
    "user": "adula",
    "password": "YOUR_LOCAL_PASSWORD"
  },
  "redis": { "host": "127.0.0.1", "port": 6379 }
}
```

Keep this file private. The PostgreSQL role needs `CREATEDB`; the command creates
fresh development/test databases. It refuses an existing destination directory
with content or a pre-existing database. Database failures preserve files/data
for inspection. Local administrator credentials are saved in ignored
`tmp/dev-admin.txt`, never printed. No educational applications are installed.
An optional `--database name` selects a fresh database name (lowercase letters,
digits and underscores, at most 50 characters); an existing name is still refused.
Values containing dotenv interpolation or quote characters are stored in private
`tmp/env` files and loaded through AdonisJS's `file:` identifier without alteration.

## Company identity

The wizard requests the company name, administrator email and company identity.
An optional identity JSON file contains `primaryColor` (six-digit hex), `logo`
(local PNG/JPEG/WebP path relative to the JSON), `fontFamily` and `guidelines`.
Known identity is applied immediately. Missing identity remains explicitly pending
in `docs/design-identity.md`; no official branding is invented.

Identity lives in the project-owned `inertia/css/brand.css`, which loads after the
AdulaJS theme. It can override these `:root` tokens: `--background`, `--foreground`,
`--card`, `--primary`, `--primary-foreground`, `--secondary`, `--muted-foreground`,
`--accent`, `--border`, `--destructive`, `--ring`, `--radius` and `--brand-font`
(a font list placed before `sans-serif`; the project loads the font itself).

## Progress and logs

Terminal prompts and errors use English so they remain readable in terminals
without Arabic shaping. The system stays Arabic. Installation shows six real
stages, with color and a spinner in interactive terminals. `NO_COLOR=1`, redirected
output and dumb terminals use plain progress lines. Detailed child-command output
is retained privately in ignored `tmp/install.log`; failures identify that log.

## After creation

After creation: `cd my-system` and `npm run dev`. In development this starts the HTTP
server and the event worker (`node ace adula:worker`, restarted when application code
changes), so listeners, workflows and notification e-mail run. In production the worker
and the scheduler are separate runtime processes documented in the system README. SMTP, OAuth, S3, production
hosting and off-site backups need real configuration; no external accounts are
created. Node.js and Docker themselves are host prerequisites.

Sign in with the credentials in `tmp/dev-admin.txt`, then open `/admin/setup` and follow the
[initial setup](https://github.com/adulash/adulajs/blob/main/docs/initial-setup.md).

## Local archive verification

For local archive verification, run the packed CLI with npm exec and `--packages` pointing
to the directory containing matching `adula-VERSION.tgz` and
`adula-ui-VERSION.tgz`. `pnpm test:create` exercises this path from an empty folder.
