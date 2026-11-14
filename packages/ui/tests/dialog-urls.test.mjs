import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Owner decision 30 (2.3.0): a dialog that creates, edits or shows a lasting item has its own
 * address, through the registry's `useDialogParam` / `useEntityDialog` (dialog_param.ts).
 * Transient dialogs keep no address. This guard reads every Dialog of the project-owned screens
 * and fails on one whose `open` is neither bound to that hook nor listed below as transient, so
 * a new entity dialog opened from plain useState is flagged until someone decides which it is.
 *
 * It reads source text, not types: a dialog counts as bound when its `open` expression names a
 * variable created by the hook, directly or through one derived constant in the same file.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url))
const screens = join(root, 'apps/reference/inertia')

async function files(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      // The generated copy of the registry; its dialogs are the primitives themselves.
      if (entry.name === 'node_modules' || path === join(screens, 'components/ui')) continue
      found.push(...(await files(path)))
    } else if (entry.name.endsWith('.tsx')) found.push(path)
  }
  return found
}

/**
 * The text of a JSX opening tag from `start` (at `<`) to its `>`: braces are counted, attribute
 * strings and comments inside expressions are skipped.
 */
function openingTag(source, start) {
  let depth = 0
  let quote = null
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index)
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index) + 1
      continue
    }
    if (depth === 0 && (char === '"' || char === "'")) quote = char
    else if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`unterminated tag at ${start}`)
}

/** The `open` attribute: `open={…}` with its expression, a bare `open`, or null. */
function openAttribute(tag) {
  const match = /\sopen(=\{)?/.exec(tag)
  if (!match) return null
  if (!match[1]) return { text: 'open', expression: '' }
  let depth = 1
  let index = match.index + match[0].length
  const begin = index
  for (; index < tag.length && depth > 0; index++) {
    if (tag[index] === '{') depth++
    else if (tag[index] === '}') depth--
  }
  const expression = tag.slice(begin, index - 1).replace(/\s+/g, ' ').trim()
  return { text: `open={${expression}}`, expression }
}

/** Variables created by the hook, plus constants derived from them in one step. */
function boundNames(source) {
  const names = new Set()
  for (const match of source.matchAll(/const (\w+) = use(?:Dialog|Entity)(?:Param|Dialog)\b/g))
    names.add(match[1])
  for (const match of source.matchAll(/const (\w+) =([^\n]*(?:\n {4,}[^\n]*)*)/g)) {
    const words = new Set(match[2].match(/\w+/g) ?? [])
    if ([...names].some((name) => words.has(name))) names.add(match[1])
  }
  return names
}

/** Every non-confirmation Dialog of the screens with its file, `open` and whether it is bound. */
async function inventory() {
  const dialogs = []
  for (const path of await files(screens)) {
    const source = await readFile(path, 'utf8')
    const file = relative(screens, path).replaceAll('\\', '/')
    const names = boundNames(source)
    for (const match of source.matchAll(/<Dialog(?=[\s>])/g)) {
      let tag
      try {
        tag = openingTag(source, match.index)
      } catch (error) {
        throw new Error(`${file}: ${error.message}`)
      }
      if (/\smode="confirm"/.test(tag)) continue
      const open = openAttribute(tag)
      const words = new Set(open?.expression.match(/\w+/g) ?? [])
      dialogs.push({
        file,
        open: open?.text ?? '(no open prop)',
        bound: [...names].some((name) => words.has(name)),
      })
    }
  }
  return dialogs
}

test('every entity dialog takes its open state from the address (decision 30)', async () => {
  const dialogs = await inventory()
  const bound = dialogs.filter((dialog) => dialog.bound)
  // The eight entity dialogs of the audit, bound in seven screens.
  for (const file of [
    'pages/account/delegations.tsx',
    'pages/admin/delegations/index.tsx',
    'components/inbound-webhooks.tsx',
    'pages/admin/webhooks/index.tsx',
    'pages/admin/print_templates/index.tsx',
    'pages/admin/templates/index.tsx',
    'pages/admin/lookups/index.tsx',
    'pages/admin/org_units/index.tsx',
  ])
    assert.ok(
      bound.some((dialog) => dialog.file === file) ||
        dialogs.every((dialog) => dialog.file !== file),
      `${file}: its entity dialog is not bound to useDialogParam`
    )
})

test('a dialog opened from plain state is either bound to the hook or listed as transient', async () => {
  const dialogs = await inventory()
  const unclassified = dialogs
    .filter((dialog) => !dialog.bound)
    .map((dialog) => `${dialog.file} ${dialog.open}`)
    .filter((key) => !unbound.has(key))
  assert.deepEqual(
    unclassified,
    [],
    'Each of these opens from local state. An entity dialog (create, edit or show a lasting ' +
      'item) uses useDialogParam / useEntityDialog; a transient one is added to `unbound` in ' +
      'packages/ui/tests/dialog-urls.test.mjs with its reason.'
  )
  // A listed dialog that no longer exists is removed from the list.
  const present = new Set(dialogs.map((dialog) => `${dialog.file} ${dialog.open}`))
  for (const key of unbound.keys())
    assert.ok(present.has(key), `listed but not found: ${key}`)
})

/**
 * Dialogs without an address of their own, by file and `open` expression, each with the reason.
 * Decision 30 keeps transient dialogs without one: confirmations, one-setting edits, reorder or
 * customise, one-time secrets, step flows, logs and history views. A dialog listed here must
 * not create, edit or show a lasting item; if it does, it is bound to the hook instead.
 */
const unbound = new Map(Object.entries({
  // Bound one level up: the component is opened or mounted by a screen that uses the hook.
  'components/delegations.tsx open={open}':
    'bound by its callers (account/delegations, admin/delegations) through useDialogParam',
  'pages/admin/appearance/index.tsx open':
    'OccasionDialog is mounted only while useEntityDialog names an occasion; IdentityDialog edits one setting group',
  // Already addressed before decision 30: the users list opens it from `?invite=1`.
  'components/invite-user-dialog.tsx open={open}': 'bound by the users list to ?invite=1',
  // One setting or one personal preference.
  'components/account/avatar-dialog.tsx open={open}': 'one personal setting (the picture)',
  'components/account/notification-channels-card.tsx open={draft !== null}':
    'one personal setting (a notification channel)',
  'components/messaging-channel-settings.tsx open={draft !== null}':
    'one setting (the messaging channel)',
  'pages/admin/assistant/index.tsx open={draft !== null}': 'one setting group (the assistant)',
  'pages/admin/sequences/index.tsx open={draft !== null}': 'one setting (a sequence next number)',
  'pages/admin/settings/index.tsx open={draft !== null}': 'one setting value',
  'pages/admin/backups/index.tsx open={Boolean(destination)}':
    'one setting (a destination schedule)',
  // Step flows, sign-in steps and one-time secrets.
  'components/account/connected-accounts-card.tsx open={linking !== null}':
    'step flow (linking an external account)',
  "components/account/two-factor-card.tsx open={panel === 'enrol'}":
    'step flow with a one-time secret',
  "components/account/two-factor-card.tsx open={panel === 'regenerate'}":
    'one-time secret (recovery codes)',
  "components/account/two-factor-card.tsx open={panel === 'disable'}": 'confirmation',
  'components/mail-setup.tsx open={open}': 'step flow (mail setup)',
  'pages/admin/setup/index.tsx open={guide !== null}': 'step flow (setup guides)',
  'pages/auth/two_factor.tsx open': 'sign-in step, the page itself',
  'pages/work/imports.tsx open={id !== null}':
    'step flow: the validation report before an import starts',
  'components/messaging-channel-settings.tsx open={testing !== null}':
    'action (send a test message)',
  'pages/work/my_tasks.tsx open={closing !== null}': 'action (close a task with a note)',
  'components/inbound-webhooks.tsx open={secret !== null}': 'one-time secret',
  'components/messaging-channel-settings.tsx open={secret !== null}': 'one-time secret',
  'pages/admin/webhooks/index.tsx open={secret !== null}': 'one-time secret',
  'pages/admin/tokens/index.tsx open={creating}': 'token creation ends in a one-time secret',
  'pages/admin/tokens/index.tsx open={secret !== null}': 'one-time secret',
  // Reorder or customise.
  'components/nav-order-dialog.tsx open={open}': 'reorder (navigation)',
  'components/overview/customize-dialog.tsx open={open}': 'customise (overview widgets)',
  // Logs and history.
  'components/inbound-webhooks.tsx open={log !== null}': 'delivery log',
  'pages/admin/webhooks/index.tsx open={log !== null}': 'delivery log',
  'components/sync-jobs.tsx open={history !== null}': 'run history',
  'pages/admin/print_templates/index.tsx open={historyOpen}': 'version history',
  // Small actions on a unit or a user, and the role rule editor kept by decision 30.
  'pages/admin/org_units/index.tsx open={renaming !== null}': 'one field (a unit name)',
  'pages/admin/org_units/index.tsx open={deleting !== null}': 'confirmation with a target',
  'pages/admin/roles/show.tsx open': 'RuleEditor, kept without an address by decision 30',
  'pages/admin/users/show.tsx open={open}': 'action on the user (picture or impersonation)',
}))
