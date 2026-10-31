# ADR 026 — Council 2: does the framework work outside its owner's head?

Superseded by ADR 040.

Date: 2026-09-25. Status: **accepted** by the owner on 2026-09-25 (ADR 028).

Plan rule 8 calls the council twice: after phase 2 (ADR 025) and before public
release. The second question is whether someone other than the owner (a developer
or an agent) can build and operate an application with the kit using only what the
kit ships: the package, the generated project, the managed AGENTS rules, skills,
the capability catalog and the docs.

## Evidence considered

- **Agent without the owner:** an agent built a fourth module (support tickets with
  a sequence, lookup, searchable text, inline replies and an escalation workflow)
  from one Arabic sentence in a disposable consumer, using only `adula:resource`,
  idea-review and the generated capability catalog. Automatic checks caught three
  mistakes that the agent corrected; lint, typecheck and the functional suite
  passed (`docs/evidence/agent-module-exercise-2026-09-25.json`). Limit: the same
  agent that wrote the kit ran the exercise, inside a copy of the reference app
  using the workspace kit, and recorded no timings. An independent repetition from
  the published packages is a 2.0 item.
- **Independent consumers:** CI builds packed archives and runs a disposable
  consumer (`pnpm test:consumer`) and a creator-generated application with and
  without Docker (`pnpm test:create`). The medical consumer with four generated
  resources, backup, restore and reconciliation (`pnpm test:medical`) runs in the
  Performance workflow, which is not a merge gate. None of them imports
  repository sources.
- **Genuine upgrade:** CI installs the published `0.2.0-alpha.1` from npm, adds
  consumer data, a customized component and an overridden page, then upgrades to
  the current source. Data, customizations and additive migrations are verified
  (`pnpm test:upgrade --published=0.2.0-alpha.1`).
- **Public contract:** `packages/kit/api/kit-api.json` records every export and
  `pnpm check:api` fails on removals or signature changes.
- **Performance:** the section 13 workload (100000 rows, 50 users, compiled build)
  runs on a GitHub-hosted runner in the Performance workflow. Results are recorded
  in `docs/evidence/phase5-performance-2026-09-25.json`; it is not staging hardware.

## Seven angles

1. **Correctness:** the kit, reference (191) and creator (37) suites run on PostgreSQL 17;
   business features each have a kit test and an HTTP or browser consumer.
2. **Security:** authorization is re-checked by every record service; webhooks are
   signed and refuse private targets in production; API tokens carry the owner's
   current permissions. 2FA is not part of 1.0 (ADR 027). Impersonation is reviewed
   automatically; its human review is deferred to 2.0 (ADR 027).
3. **Performance:** see the evidence file; one web process on a shared runner.
4. **Upgrade safety:** doctor blocks unfinished upgrades; the UI compatibility
   review is enforced across minor versions; migrations are additive.
5. **Agent usability:** the catalog is generated from the package and tested for
   drift; five reviewer skills ship with the managed rules.
6. **Operability:** backup, offsite restore, attachment reconciliation and the
   worker (mail, workflows, imports, webhooks) run in the consumers.
7. **Scope discipline:** XLSX import is not shipped (GAP-006); no visual workflow
   editor, runtime plugins or dynamic fields.

## Proposed answer

Yes, with named limits: an agent or developer can build, test, upgrade and operate
an application from the published artifacts alone. The limits are the human
reviews above, the absence of an operated production consumer (the plan's phase 7
condition, relaxed for framework acceptance by ADR 024 only as far as the owner
decides), and performance measured on CI rather than staging hardware.

## What remains the owner's

- Accept or reject this council record.
- Accept phases 3 to 6 (and the open items of phases 0 and 1).
- Authorize publishing `1.0.0` and the public MIT repository.

## Owner answers, 2026-09-25

ADR 027 answers two limits above: 1.0 needs no operated production consumer
(users run production after 1.0), and 2FA is removed from 1.0 and moves to 2.0
with its human review. Acceptance
of this council record itself remains open.
