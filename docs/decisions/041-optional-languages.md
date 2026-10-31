# ADR 041 — Arabic base language with optional languages

Date: 2026-10-18. Status: accepted by the owner. Supersedes the "mandatory bilingual
labels" clause of ADR 001.

## Context

ADR 001 required `label.ar` and `label.en` on every resource and field. In practice
systems are built for Arabic-speaking companies: the English labels were filler, the
framework's own messages were Arabic literals, and VineJS answered resource validation
in its English defaults. The owner decided that Arabic is the base language of every
system, that other languages are optional and added through a translation layer, and
that an English interface is a per-user option, never a requirement.

## Decision

* `label.ar` is required; `label.en` and any other language are optional, and
  `label.<lang>` falls back to `label.ar`. A label that names a language must give it
  text.
* The framework's strings live in a keyed catalog whose base is Arabic
  (`arabicMessages`). Optional catalogs translate a subset; missing keys show Arabic.
  Existing Arabic literals are translated at the boundary by exact text match, so
  Arabic output stays byte-identical and migration can be progressive.
* The request language comes from the signed-in user's `users.language` when the
  system enables it (`config/adula.ts`, Arabic only by default) and is carried with
  AsyncLocalStorage so `AdulaError` and VineJS messages follow it.
* English is bundled for the framework's own strings only, so the feature has a
  consumer; consumer resources translate through their labels.

## Consequences

Code that reads `label.en` must handle `undefined`. Screens move to the catalog
progressively; until then they render Arabic. See docs/languages.md.
