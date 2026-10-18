# ADR 017 — Test-only examples and evidence-gated releases

Release-gate paragraphs superseded by ADR 040; the test-only examples rule stands.

Date: 2026-09-19. Status: accepted for implementation; release acceptance pending.

The owner reserved `@adula`, requested documentation consolidation, release preparation and a local commit, selected complete 1.0 scope, and instructed removal of customers/orders/tasks from this checkout while preserving tests.

Move modules/migrations/listeners/page overrides to `apps/reference/tests/fixtures`, loading only in test mode against a dedicated `_test` database. Normal registries start without them and development seeding creates core administrator data only. Do not drop existing tables or change migration contents. Keep permission, CRUD, attachment, queue and browser coverage. Agent rules must not assume orders is installed.

The plan's original examples remain historical. Isolated acceptance fixtures or independent applications now satisfy its consumer requirement; later phases must not reintroduce these modules into the user's application.

Give installation, development, status, gaps and release instructions one canonical guide each. Keep 0.2.0/unreleased until acceptance justifies a candidate. Never rename unfinished work stable.

Prepare manual publication via a protected GitHub environment and npm trusted publishing. Reuse CI and publish the same independently tested archives. Validate contents, licenses, exports, metadata and checksums. Require early acceptance/explicit prerelease for `next`, and all eight gates for 1.0 `latest`.

Scope ownership closes one administrative gap. Visibility, remote CI, trusted publisher configuration, infrastructure and human/production acceptance remain real requirements. A local commit does not authorize a push or publication. Current stable publication must fail the guard.
