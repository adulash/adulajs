# ADR 009 — Stored field representations and typed authorization

Status: accepted locally, 2026-09-18.

CASL and PostgreSQL must evaluate the same value. Money uses canonical decimal strings of integer minor units within PostgreSQL's signed bigint range. Safe JavaScript integer input is normalized to a string before authorization; leading zeroes, negative zero, unsafe numbers and overflow are rejected. `buildAbility(rules, registry.all())` supplies the field types needed for ordered money predicates. The SQL adapter rejects ordered money rules built without these schemas.

Dates are calendar strings (`YYYY-MM-DD`); timestamps are canonical UTC strings with milliseconds. The pg driver's native DATE value represents local midnight, so row conversion reads its local calendar components rather than shifting it through UTC. Since the calendar-days fix, `adula/provider` also registers a DATE parser on every PostgreSQL connection, so applications and module code read the server's `YYYY-MM-DD` text and never see that local-midnight value. Text ordering uses Unicode code points in CASL and the PostgreSQL C collation. JSON values are validated before serialization so undefined values, cycles and class instances cannot silently change a write.

Vine still owns application validation. The kit additionally enforces storage representations before evaluating a prospective record, and again after beforeSave hooks. Relation visibility and lookup membership are checked after those hooks. JSON, attachment and hasMany authorization predicates remain explicitly unsupported rather than being coerced to text.

Evidence: real PostgreSQL parity cases include positive/negative and unsafe-range money, calendar dates, timestamps, null membership, numeric-looking text and supplementary Unicode. Resource write tests verify representations, rejected coercions and rollback. The browser-safe `@adula/kit/auth` entry uses the same matcher.
