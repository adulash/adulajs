# ADR 020: Initial setup and receipt evidence

Status: implemented and locally verified, 2026-09-20. Work stays on `codex/initial-setup-readiness`; no merge or external release. The dated evidence file `docs/evidence/initial-setup-2026-09-20.json` was removed with the evidence archive (commit 497791f) and remains in the git history. External provider acceptance remains pending.

Provide a resumable administrator-only setup center in generated applications. Reuse project identity, UI preferences, notifications, mail/storage adapters, runtime heartbeats and backup tools. Credentials remain deployment-owned environment configuration; HTTP requests never rewrite `.env`. Dialogs explain required configuration and explicit tests.

SMTP acceptance is not receipt. Send tests only to the authenticated administrator's stored address, then request an explicit received/not-received answer for that attempt. Persist evidence and audit events; expire pending confirmations after 24 hours. Throttle sends, recover interrupted attempts and prevent delayed responses from overwriting newer attempts. A keyed configuration fingerprint invalidates evidence after mail configuration changes. Never expose raw transport errors or secrets.

Test notifications through the real inbox/read flow, storage through unique write/read/delete probes, and PostgreSQL/Redis through actual connections. Show worker/scheduler heartbeats separately from connectivity. Record OAuth verification only after successful authenticated provider callbacks. Backup-object inspection and record/attachment restoration remain distinct evidence. No local snapshot result proves offsite recovery.

Protect operational evidence from generic settings mutation. Identity confirmation is explicit and invalidated by changes to project-owned branding metadata/sources. No missing brand approval or overall production readiness is inferred.

This work configures and tests existing services. Universal notification routing/templates and additional SMS/WhatsApp/push channels remain later roadmap features. Actual external SMTP/OAuth/S3 acceptance requires supplied destinations and credentials.

Primary references: [Adonis mail](https://docs.adonisjs.com/guides/digging-deeper/mail), [FlyDrive disk operations](https://flydrive.dev/docs/disk_api).
