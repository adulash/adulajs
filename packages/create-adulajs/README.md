# create-adulajs

Creates a complete, project-owned AdonisJS 7 business system with AdulaJS, React/Inertia,
shadcn/ui, authentication, administration and the managed business-design skill.
The business areas you then add inside the system (assets, maintenance, HR and so on) are its
applications, each implemented as a module under `app/modules/<name>`.
The creator always installs the matching `adula` and `@adula/ui` version. To move a 1.x
system to the current AdulaJS, run `npx create-adulajs@latest upgrade` in it; see the
[upgrade guide](https://github.com/adulash/adulajs/blob/main/docs/upgrade-2.0.md).

```sh
npm create adulajs my-system
```

The same creator also runs as `npx create-adulajs@latest my-system`.

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

Terminal prompts and errors use English so they remain readable in terminals
without Arabic shaping. The system stays Arabic. Installation shows six real
stages, with color and a spinner in interactive terminals. `NO_COLOR=1`, redirected
output and dumb terminals use plain progress lines. Detailed child-command output
is retained privately in ignored `tmp/install.log`; failures identify that log.

```sh
npx create-adulajs@latest my-system --company "My company" --admin-email admin@example.com --identity ./brand.json --yes
```

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

After creation: `cd my-system` and `npm run dev`. In development this starts the HTTP
server and the event worker (`node ace adula:worker`, restarted when application code
changes), so listeners, workflows and notification e-mail run. In production the worker
and the scheduler are separate runtime processes documented in the system README. SMTP, OAuth, S3, production
hosting and off-site backups need real configuration; no external accounts are
created. Node.js and Docker themselves are host prerequisites.

For local archive verification, run the packed CLI with npm exec and `--packages` pointing
to the directory containing matching `adula-VERSION.tgz` and
`adula-ui-VERSION.tgz`. `pnpm test:create` exercises this path from an empty folder.
