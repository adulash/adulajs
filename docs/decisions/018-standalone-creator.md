# ADR 018: standalone application creator

Status: accepted for implementation, 2026-09-19. Publication and 1.0 acceptance remain separate.

## Context

The owner requested one command that installs the application from scratch. Ace
runs inside AdonisJS, so adula:install cannot create its own host application.
The owner also requires business-focused shadcn UI, company identity from day one,
and no educational customers/orders/tasks modules in the installed application.

## Decision

Publish @adula/create-app alongside kit/UI. npm create @adula/app resolves to its
single executable. Bundle an allowlisted template derived from the verified
reference application at build time, rather than fetching a moving upstream
starter or maintaining a second full application. Exclude secrets, generated
assets, fixture modules, their hooks and UI files. Install UI through the kit
registry so the application owns it and updates track its hashes.

The creator pins package versions, bundles pnpm as a dependency installed by npm, asks for the
company name and administrator email, generates private credentials and unique
database/cache namespaces, migrates fresh PostgreSQL 17 databases, initializes
authorization, synchronizes managed skills and checks doctor/types/build.
Default local services run through Docker Compose; existing services are a
first-class option. Nonempty directories, symlink writes and existing database
names are rejected. Failures retain generated files/data; completion is recorded
only after all checks pass. No database is dropped by the creator.

The creator keeps its package manager outside the target dependency tree while
installing UI. This prevents Windows command shims from being replaced during
their own execution. The generated application also owns a local pnpm dependency
for later npm scripts, so no global pnpm installation is required.

Node.js/npm and Docker in Docker mode remain host prerequisites. SMTP/OAuth/S3,
off-site backups and production destinations require real user configuration.
Missing branding remains explicitly pending. No account, logo or approval is
invented. The existing Ace initialization command retains its existing contract.

## Verification

Unit checks cover destination safety, environment isolation, identity validation,
contrast and local Compose boundaries. The packed npm executable is exercised
from an empty directory with real PostgreSQL/Redis, HTTP authorization and real
administrator browser login. CI retains all three tested archives for publication.
Docker startup must also be exercised on a Docker-capable host; the original
workstation has no Docker. These checks do not close the separate 1.0 gates.

Amendment (2.2.2, #151): the interactive creator no longer asks for a company identity file.
`--identity` stays an optional, non-interactive option (not deprecated). Without it the generated
project records the identity as pending in `docs/design-identity.md`, and the managed AGENTS
kickoff rule asks for it before the first design. Without `--yes`, piped input answers the
remaining questions, so the acceptance harness drives the same interactive flow.
