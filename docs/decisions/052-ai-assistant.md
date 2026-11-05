# ADR 052 — Built-in AI assistant through OpenRouter

Date: 2026-11-05. Status: accepted for 2.3.0 (issue #162).

## Context

The owner asked for an assistant inside the system that a deployment customises: an
administrator supplies an OpenRouter key, chooses the model and a persona, and decides
which roles may use it. The assistant answers questions and may use the system's existing
tool surface as the signed-in user. Record content is typed by people and may carry
prompt injection, so it must never widen permissions or trigger a write. ADR 010 already
routes MCP through ResourceService; ADR 043 keeps outbound HTTP vendor-neutral, guarded
and without vendor SDKs.

## Decision

* **One tool path.** The MCP adapter's argument parsing, dispatch and error mapping moved
  to `src/admin/resource_tools.ts` (`parseResourceToolArgs`, `runResourceTool`,
  `resourceToolError`, `RESOURCE_READ_SCHEMA`, `RESOURCE_WRITE_SCHEMA`). MCP is a thin
  wrapper over it, and the assistant calls the same functions with the request actor
  (`requestActor`, which also names an impersonating administrator). Scope, CASL rules
  and field levels stay inside ResourceService; the assistant has no permission logic of
  its own.
* **Permission.** A new non-resource subject `core.ai` with the action `use`, offered in
  the role matrix. `all/manage` passes. Like `core.users/invite`, it takes effect only
  through a deployment-wide role assignment: `ActorStore` expands org-scoped assignments
  onto scoped resources only, so a `core.ai` rule on an org-scoped assignment is dropped
  (a test pins this). A per-unit grant is a known gap.
* **Reads, then proposals.** The model gets `adula_resource_read` (list capped at 20 rows,
  show, editor). When the administrator allows it (`allowWriteProposals`, off by
  default), it also gets `adula_propose_write`, which only stores an `ai_pending_actions`
  row: single use, ten minutes, bound to the user, the conversation and the impersonator.
  Update and create proposals are pre-checked with `editor()` and refused when they name
  a field the user cannot write; the user sees the exact input, the record title and the
  current values in a review Dialog. Only a separate, CSRF-protected confirm request whose
  body is empty runs the proposal through the shared runner, so validators, scope and the
  record version are checked again at that moment.
* **Prompt injection containment.** Tool names, schemas, the argument whitelist (an
  `actorId` is refused), the iteration cap and every setting are fixed on the server. The
  turn body accepts only `message` and a history of `{role: 'user' | 'assistant',
  content}`; anything else (system or tool roles, tool calls, extra keys) is refused
  before the provider is called. Tool results are sent as
  `{"untrusted_record_data": …}`, after a fixed preamble the administrator cannot edit.
  Replies render as plain text. Even a model that obeys injected text can only read what
  the user may read or create a proposal the user can reject.
* **What the provider receives.** The preamble, the administrator's persona, the names,
  Arabic labels and allowed actions of resources the user may view, the date, the user's
  message and history, and the tool results of the turn (field-filtered by
  ResourceService, strings cut at 2000 characters, each result at most 16 KB). Never the
  user's name, e-mail or id, settings, secrets, hidden or levelled fields, or attachments.
  An Arabic notice says so; each user accepts it before the first question, and an
  impersonating administrator cannot accept it for them.
* **Key.** Stored in the system setting `ai.assistant`, sealed with the host's SecretBox
  (APP_KEY). `isSealedSetting` covers `ai.*`, so the generic settings screen lists it
  read-only without the secret. The administration sees only `hasKey`; the key is never
  in props, responses, activity or logs, and its route accepts JSON only so it is never
  flashed. Changing the provider address clears the key, so a key cannot be redirected.
* **Outbound HTTP.** `createOutboundRequester`/`pinnedRequest` extend the guarded client
  (pinned DNS, public addresses unless `WEBHOOKS_ALLOW_PRIVATE`, no redirects) with a
  response cap (1 MiB). Provider errors keep only a category; bodies are discarded. The
  client is OpenAI-compatible chat completions without streaming. No dependency is added.
* **Limits.** Turns per minute per user (setting, 1–60, through `@adonisjs/limiter`), a
  daily token budget per user reserved atomically before each provider call (UTC days;
  the first over-budget request is refused without calling the provider), at most 8 tool
  steps per turn (the last step offers no tools), 5–60 s per call and 90 s per turn.
* **Audit and retention.** Each tool call writes an `activities` row (`resource
  'core.ai'`, record id = the conversation id; actions `tool.read`, `tool.propose`,
  `tool.confirm`, `tool.reject`, `tool.denied`) with tool, resource, action, ids and
  outcome, never record content or input. `ai_conversations` keeps metadata only; the
  browser keeps the transcript. `adula:assistant:prune` (daily) removes conversations
  after 30 days, used proposals after a day and usage after 90 days, and clears the input
  of expired proposals.
* **Migration** `1770000000055_ai_assistant` adds `ai_conversations`,
  `ai_pending_actions` and `ai_usage`.

## Alternatives

* Calling ResourceService directly from the assistant: two copies of the argument rules;
  rejected for one shared runner.
* Letting the model write with MCP's `destructiveHint`: a single injected sentence could
  delete records; rejected for propose-and-confirm.
* Storing transcripts on the server: more personal data at rest and a replay surface;
  rejected for metadata only.
* A dedicated audit table: duplicates the activity screen and its retention.
* The OpenRouter or OpenAI SDK: not authorized (adulajs-plan.md) and unnecessary.
* Streaming (SSE): deferred; one JSON response keeps the caps and timeouts simple.

## Consequences

Root exports are added, so the change ships in the minor release 2.3.0 (docs/releasing.md). Consumers re-copy the
project-owned assistant files listed in the upgrade notes, run the migration, enter the
key in «الإدارة ← المساعد الذكي» and grant `core.ai/use` through a deployment-wide role.
