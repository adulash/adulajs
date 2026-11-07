# ADR 053 — Appearance, identity and occasion themes

Date: 2026-11-07. Status: accepted for 2.3.0 (owner decision 19).

## Context

The owner asked for this in their own words: «نعم اضفها كميزة داخل الاعدادات ليمكن تخصيصها مثل
تغيير اللون اوالتصميم بشكل مؤقت بحيث يكون التماشي مع العيد الوطني او المناسبات». Until now
the company name came from `company-identity.json` or the root unit, and the colours from the
theme tokens, so changing them needed a developer and a deployment. A temporary look for the
national day or another occasion was not possible at all.

## Decision

* **Where.** «الإدارة ← الإعدادات ← المظهر والهوية» (`/admin/appearance`). The administration
  area already requires `all/manage`; the PostgreSQL test proves a user with every record
  permission but not `all/manage` is refused.
* **Base identity.** The system setting `appearance.identity` holds the company name, a
  logo, the login title and description, the guest home title and description, and the
  primary colour. Texts are plain, single-line or short, bounded and free of control
  characters; React renders them as text. `appearance.*` is a protected setting, so the
  generic settings screen cannot write around these checks. «استعادة الافتراضي» deletes the
  setting and its logo; occasions stay.
* **Colour.** Only `#rrggbb` is accepted, never free-form CSS. The light theme uses the
  colour as `--primary`; the dark theme uses a tint of it, mixed with white in 5% steps until
  it reaches 4.5:1 on the dark background. Both themes must reach WCAG AA (4.5:1) for the
  colour as text on the page background and for the foreground on the colour; otherwise the
  save is refused with the Arabic reason and the ratio. The foreground is white or
  near-black, whichever reads better. The client writes one `<style>` element that sets
  `--primary` and `--primary-foreground` on `:root` and `:root.dark`.
* **Logos.** PNG, JPEG or still WebP, recognised by their first bytes; SVG is refused
  because it can carry script. At most 1 MiB. libvips decodes one frame within a pixel
  budget and re-encodes it in the same format, fitted inside 1024×512, so no metadata or
  payload from the original survives. A logo is an `attachments` row (`core_appearance /
  logo`), so backups and storage migration carry it as they carry profile pictures (ADR
  050). An upload is unbound until the identity or an occasion is saved with it; until then
  only an administrator can open it (`private, no-store`). The base identity's logo and the
  logo of today's occasion are public at `/appearance/logos/:id`, because the login page
  shows them, with their stored type, `nosniff`, a sandbox CSP and a five-minute cache that
  revalidates with the ETag. The logo of an upcoming or ended occasion is served only to an
  administrator, uncached, so an unannounced occasion does not leak before its date.
  Binding an upload locks its row, so two saves cannot claim the same file. Replacing or
  removing a logo deletes the previous row and file.
* **Occasions.** `appearance_occasions` rows have a name, a start and an end date (inclusive,
  read in the system time zone, `adula.timeZone`) and optional overrides: colour, logo, a
  short banner message, and the login title and description. At least one override is
  required. Only one occasion is active on any day: a range that overlaps another is refused
  with 409, checked under a table lock so two administrators cannot both pass.
* **Resolution.** `Appearance.resolve()` reads the identity and the occasion whose dates
  include today and returns the result; nothing is scheduled, so the base identity returns
  by itself on the day after an occasion ends. The result is cached for 30 seconds per date
  in each process and cleared by every change in that process; another process sees a
  change within 30 seconds. The service's `clock` can be replaced, which the tests use to
  move past an occasion's end.
* **Shared prop.** Every Inertia page, guests included, receives `appearance`: `company`,
  `logoUrl`, `login`, `guestHome`, `banner`, `occasion` (`name`, `endsOn`) and `theme`. A
  null text means the page keeps its own wording. The guest shell (team D's guest-shell
  work) and the workspace shell show the name, logo and banner once those branches merge;
  this change applies the colour and the page title on every page.
* **Documents and fallback.** `identity()` returns the saved company name and logo over the
  project's `company-identity.json` or the root unit's name, so printed documents and the
  two-factor issuer follow the setting. The setup checklist still approves the project's
  own identity files, so changing the appearance never reopens that step.
* **Audit.** Every change is in the activity log under `core.appearance`: `identity.update`,
  `identity.reset`, `logo.upload`, `occasion.create`, `occasion.update`, `occasion.delete`.
* **Migration** `1770000000056_appearance` adds `appearance_occasions`; it is additive.

## Alternatives

* Free-form CSS or a theme editor: a stored-CSS injection surface and no contrast guarantee;
  rejected for one checked colour.
* SVG logos: they can carry script and external references; rejected.
* A scheduled job that switches occasions on and off: a missed run leaves the wrong look;
  rejected for per-request resolution.
* Several active occasions with priorities: harder to explain and to preview; the owner can
  change this default later.

## Consequences

The owner can still change two defaults: one active occasion at a time, and logos in PNG,
JPEG or WebP only. Consumers run the migration and copy the project-owned page, the
`appearance` helpers and the `app.tsx` change listed in the upgrade notes. Root exports are
added, so the change ships in the minor release 2.3.0.
