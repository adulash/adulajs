# Documentation map

The approved [v4 plan](../adulajs-plan.md) records the original architecture and 1.0 scope. Later owner decisions are recorded in ADRs and take precedence where they change that plan, including the [removal of educational modules](decisions/017-test-only-examples-and-release-gates.md).

AdulaJS builds one **system** (نظام) per company; each business module inside it is an **application** (تطبيق).

| Question | Document |
|---|---|
| How do I create a system? | [Installation](installation.md) |
| How do I upgrade a 1.x system to 2.x? | [Upgrade to 2.0](upgrade-2.0.md) |
| What do I do after the first sign-in? | [Initial setup](initial-setup.md) |
| How do I run and test the source? | [Development](development.md) |
| How do I use collaboration, webhooks, API tokens, imports, printing and workflows? | [Business features](business-features.md) |
| How do I deploy, back up and restore? | [Operations](operations.md) |
| What exists today, and how much is tested? | [Implementation status](implementation-status.md) |
| What can AdulaJS not do yet? | [Gaps](../GAPS.md) |
| How is a version published? | [Releasing](releasing.md) |
| Which versions are published? | [Releases](releases.md) |
| What are the package contracts? | [Core README](../packages/adula/README.md), [UI README](../packages/ui/README.md), [Creator README](../packages/create-adulajs/README.md) |
| Why was a design chosen? | [Architecture decisions](decisions/) |
| What changed? | [Changelog](../CHANGELOG.md) |

Each topic has one home: package READMEs link to these guides, test counts live in implementation status, open needs in GAPS and the chronology in the changelog.
