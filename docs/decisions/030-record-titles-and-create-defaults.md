# ADR 030 — Record titles and create-form defaults (1.1.0)

Date: 2026-09-29. Status: accepted by the owner for 1.1.0. After the decisions and their consequences were
explained, the owner stated in conversation: "موافق، ادمج #54 وابدأ #42" (agreed; merge
#54 and start #42).

Issues #47, #32 and #48 came from consumers whose users saw raw lookup keys, database
ids, or had to pick a parent record again that the page already knew.

## Decisions

1. **`title` on a resource.** A resource may declare `title: ['code', 'status']`. The
   fields must exist, have a displayable type (text, number, money, date or lookup) and
   be serialized. Without a declaration, the title is the first sequence field plus the
   first text field in `list`, so a lookup is never used by default. Lookups show their
   Arabic label, and parts are joined with « · ». Titles are computed on the server from
   the record as serialized for the viewer, so a field the viewer may not read never
   appears. They reach clients as:
   - `_title` on each related row (a key that cannot collide with a camelCase field);
   - relation option labels in forms and filters;
   - `recordTitle` in `Assignment` and `WorkflowRun` (the approver's view);
   - `ResourceService.titles(name, ids, actor)` for module pages.
     `relationLabel` keeps its old first-string fallback for servers that send no `_title`.
2. **Create defaults.** `ResourceService.editor(name, actor, undefined, { defaults })` and
   the create route's `?defaults[field]=value` return `defaults` with the form. Only
   fields visible in the actor's create form are kept. A lookup must be active, and a
   related record must pass the same `show` authorization as opening it; its option is
   added with its title. Invalid or unauthorized values are dropped silently: the page is
   a GET, and dropping reveals nothing about records the actor cannot see. Defaults are
   initial values only, and saving validates them as usual.
   Since 2.2.1 (#115) a required `belongsTo` whose options hold exactly one record the
   actor may view (the whole option list, not its first page) starts on that record when
   neither a requested nor a declared default applies. It is an initial value like the others:
   the record is one the actor can already see, and saving authorizes the reference.

## Consequences

- The relation labels of resources without a declared title change from `list[0]` to
  the default title. For example, an order becomes `ORD-000001 · notes`.
- The copied `resource-value` and `resource-form` components changed. Projects that
  customized them should merge the change with `adula:ui add --preview`.
