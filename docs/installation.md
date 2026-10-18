# Installing AdulaJS

After signing in, open **الإعداد الأولي** to review identity and test notifications, mail receipt, storage and runtime services. See [initial setup](initial-setup.md).

Released versions are listed in [releases](releases.md); every release is on npm's `latest` tag.

## New system: one command

One deployment per company is a system (نظام); each business module inside it is an application (تطبيق). Create a system with:

```sh
npm create adulajs my-system
```

`npx create-adulajs@latest my-system` runs the same package directly; `npm create adulajs` uses npm's [initializer convention](https://docs.npmjs.com/cli/v11/commands/npm-init/). It does not require an existing AdonisJS application. Node.js 24+ and npm are host prerequisites. The default requires installed/running Docker with Compose; it runs PostgreSQL 17 and Redis 7 in isolated local containers with persistent volumes and loopback ports. Alternatively pass `--services existing --connection /path/to/local.json`; see [creator options](../packages/create-adulajs/README.md).

The wizard requests company identity and administrator email, downloads pnpm and dependencies, creates fresh development and `_test` databases, applies migrations, installs the managed skills and project-owned shadcn UI, initializes the administrator, checks doctor/types and builds assets. Credentials go to ignored `tmp/dev-admin.txt`; company identity goes to project-owned `docs/design-identity.md`. No educational modules are included. Existing files and database names are protected from replacement. On Unix these secret files are created readable only by you (mode 0600); Windows ignores that mode, so keep the project inside your own user profile, whose default permissions exclude other users.

Terminal instructions are English; the application stays Arabic. Interactive terminals show color and a spinner across six stages; `NO_COLOR=1` or redirected output produces plain lines. Detailed installation output is in ignored `tmp/install.log`.

For local archive testing, first run `pnpm test:create` in this repository to produce the three verified archives. Then invoke the creator using their actual absolute paths:

```sh
npm exec --yes --package=/path/to/create-adulajs-<version>.tgz -- create-adulajs my-system --packages /path/to/archives
```

Run `npm run dev` inside the created system; it starts the HTTP server and the event worker. In production the worker and scheduler are separate runtime processes described in its README. The creator installs application dependencies and local services; Node/Docker installation, real SMTP, OAuth, S3, off-site backup and production hosting remain explicit host/service configuration.

## Prerequisites for an existing application

Use Node 24 or newer, pnpm 11.19.0, the official AdonisJS 7 React/Inertia starter, and PostgreSQL 17. Configure Lucid with `pg`, authentication, session and shield. `configure adula` refuses missing prerequisites or a non-PostgreSQL connection.

The tested copied UI host uses React 19, Tailwind CSS 4.3.3, `@tailwindcss/vite` 4.3.3 and shadcn 4.21.0. Install registry components through AdulaJS command so ownership tracking remains intact.

## Prepare archives

In the source repository, `pnpm test:consumer` builds and packs both packages into `.work`, then verifies them in an independent application. To pack without the consumer test, build each package and run `pnpm --filter adula pack --pack-destination <absolute-output-directory>` and the same command for `@adula/ui`. Use an existing absolute output path to avoid package-relative ambiguity.

## Configure an existing consumer

Inside your configured application, install the archives using their actual paths. Replace the illustrative paths below:

```sh
pnpm add /path/to/adula-2.0.0.tgz /path/to/adula-ui-2.0.0.tgz
pnpm add tailwindcss@4.3.3
pnpm add -D shadcn@4.21.0 @tailwindcss/vite@4.3.3
node ace configure adula
node ace migration:run
```

Configuration registers providers/commands and migration discovery, and copies application-owned service/controller/routes and the HTTP test helper without overwriting customizations. It configures the Japa plugins for generated tests.

Set `ADULA_ADMIN_EMAIL` to the intended administrator's address (or pass `--admin-email`), then run:

```sh
node ace adula:install --admin-name="مدير النظام"
node ace adula:doctor
```

When that account does not exist and the application has no administrator yet, `adula:install` creates it with a random password printed once on the terminal (it is never written to a file); sign in and change it. If the account already exists while no administrator does (for example someone self-registered that address), installation treats it as untrusted: it replaces the password with a new one printed once, ends the account's sessions, API tokens, unused recovery links and pending invitations, and records the event. Pass `--keep-password` only for an account you created yourself. Once any administrator exists, an unknown address is refused instead of creating another privileged account. Signup is not the bootstrap path: with `SIGNUP_ENABLED` unset, self-signup is open only until the first administrator exists and then answers 404; set `SIGNUP_ENABLED=true` to keep it open or `false` to close it from the start. Signup answers a new, registered or invited address identically and never signs the visitor in. Behind a reverse proxy, set `TRUSTED_PROXIES` (comma-separated `loopback`, `linklocal`, `uniquelocal`, addresses or CIDRs) to the proxy's network so login lockouts and throttles see real client addresses; unset trusts loopback only.

Installation bootstraps core administrator authorization, synchronizes managed AGENTS rules/skills, and installs the UI registry when `@adula/ui` is present. Customized components are protected. It does not supply all reference-app authentication/admin screens or automatically wire every optional adapter; consuming applications own that integration.

Repeated installation also repairs a missing bootstrap `manage all` grant for an existing administrator role. It preserves other rules, including explicit denies. Normal administration prevents removal of the last active administrator and removal of the acting administrator's own access. See [ADR 019](decisions/019-admin-safety-and-calendar-preferences.md).

The generated settings page offers Gregorian, Umm al-Qura Hijri, or both calendars. Both mode shows two representations of one stored date and lets users choose the input calendar. It also controls edit-dialog dismissal confirmation and page transitions; reduced motion is respected. Existing consumers must merge updated application-owned pages/middleware and review registry changes through `adula:ui` before adopting these defaults.

After publication, replace archives with the **exact published version** of each package. Do not assume 1.0 already exists.

## First domain resource and design

Run `node ace adula:resource inspections --module=inspections`, fill the generated labels, fields, validation and test fixture, then migrate and test. AdulaJS installs no customers/orders/tasks modules; the repository's examples are test-only.

At kickoff the design agent requests company name, logo, approved colors, fonts and brand guidelines, reuses supplied information, and records sources in project-owned `docs/design-identity.md`. Pending assets allow independent work with a provisional neutral preview. Installation never overwrites that document.

UI work uses `.agents/skills/adula-frontend-design/SKILL.md`, local shadcn components, and Dialog for forms/row details by default. Explicit user requests can choose a full page. Preview updates with `node ace adula:ui add all --preview` and review customized files before merging.

## Meaning of one-command installation

`npm create adulajs my-system` creates and initializes a complete system from an empty folder. `node ace adula:install` initializes AdulaJS inside an existing AdonisJS application. The plan's `make deploy` deploys an application; it is not an npm installer.
