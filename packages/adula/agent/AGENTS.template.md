<!-- adula:start (managed by adula:doctor — do not edit) -->

# AdulaJS rules

A plugin is just code that has not been written yet. No abstraction before the second need.

Structure

1. One system per company. Each business area (assets, maintenance, HR …) is an application implemented as a module in app/modules/<module>, and every entity lives in one of them. Applications share users, roles, the organisation tree, notifications and the task inbox; never create a separate deployment per application.
2. Generate the resource scaffold with adula:resource and follow its typed definition. Reuse an existing project resource when available; never assume educational applications are installed.
3. New application: `node ace adula:app <name> --label-ar=<Arabic label>` (module, example resource, default roles, smoke test). New entity in an application: `node ace adula:resource <name> --module=<module>`, then fill the fields.
4. Before creating an entity, check the registry. Same meaning exists → belongsTo. Never duplicate a table.
5. A module writes only its own tables; dependency direction follows start/modules.ts, never backwards.
6. Modules talk through events, never by importing each other's controllers. Heavy listeners go to jobs.
7. Every resource declares `scoped` explicitly. Standard columns are generated; never edit them. Migrations follow expand/contract: never drop or rename a column in the same release that stops using it.
8. Deletes are soft. Changeable lists come from lookups. Approvable documents use `submittable: true`.
9. Notify via notify(), number via sequence, configure via settings. Nothing else.

Security 10. Every route passes the authorize middleware. Every transformer uses `serialize` (explicit pick). `systemSave` and `rehome` skip role rules: use them only in listeners and module services after an explicit authorization, never in a controller or route (enforced by lint). 11. Never write crypto, sessions, or auth flows; use AdulaJS. 2FA and impersonation changes need a human review. 12. Never delete or weaken a test to make the build pass.

UI 13. Before designing or changing any interface, read and apply `.agents/skills/adula-frontend-design/SKILL.md` (AdulaJS's bundled frontend-design skill for business applications). At project kickoff, request the company's identity before the first design: name, logo, colors, fonts and brand guidelines when available. Reuse supplied identity, ask only for missing information, and preserve it in project-owned docs/design-identity.md. Fill the resource definition before writing a page. Override only via pages/<resource>/. 14. Compose interfaces from the project-owned shadcn/ui components in inertia/components/ui/. Use Button, Input, Select, Table, Card and the other registry primitives instead of hand-styled native controls or homemade equivalents. Semantic HTML for structure, text and form submission is allowed. Add components only via `node ace adula:ui add`, never `shadcn add`. 15. All forms (including create/edit) and row/record detail views use shadcn Dialog (modal) by default. Use ResourceSurface for resource forms/details; do not choose a standalone page, Sheet or custom overlay unless the user explicitly requests that alternative. View dialogs close on outside click; edit dialogs ask before closing by default. Honor system preferences for Gregorian, Hijri or both calendars and reduced motion. RTL by default; Arabic labels; English identifiers. Installation terminal instructions are English. Preserve explicit user exceptions and project-owned customizations.

Boundaries 16. Never modify node_modules/adula or node_modules/@adula, and never use patch-package (enforced by lint). Do not re-implement an AdulaJS service under another name (checked in review). 17. A limitation is recorded in GAPS.md (template inside) and reported to the developer — never worked around. Describe the AdulaJS capability, not this project, and reproduce it on a new system from create-adulajs. The developer submits it through the prefilled form link printed by `node ace adula:gaps report`, then records `Issue: #<number>`; never open AdulaJS issues through the API. 18. Only packages already in package.json. Ask before adding one. 19. New application (module) or workflow → run the idea-review skill first. Field changes do not need it. 20. Before finishing: `npm run typecheck && npm test && node ace adula:doctor`.
<!-- adula:end -->

## Project rules

This is a reference consumer. Additions approved by the implementation plan are authorized.
