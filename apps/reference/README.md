# AdulaJS reference application

Arabic customers, orders and tasks consuming the local `adula` package. This is an unreleased 0.1.0 foundation, not the finished resource UI or a production-ready deployment.

Use the [workspace setup instructions](../../README.md). The local URL is http://127.0.0.1:3333. Development fixtures and a random local account can be created with `node ace adula:seed --rows=25`; the first run writes credentials to ignored `tmp/dev-admin.txt`.

Run `node ace adula:worker` for outbox/queue delivery and one `node ace scheduler:run` for periodic backup checks. Redis and PostgreSQL must be running. Test execution uses the dedicated `_test` database and Redis DB 15 with the `adula-reference-test:<test database>` prefix, so runs on different test databases never clear each other's queue or cache.

Read the [implementation status](../../docs/implementation-status.md) and [open gaps](../../GAPS.md) before extending or deploying. The app began from the official Adonis React starter; its MIT license is retained.
