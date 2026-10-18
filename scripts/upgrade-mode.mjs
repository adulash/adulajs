import assert from 'node:assert/strict'

export function requireSyntheticRehearsal(args, env) {
  assert(args.length === 1 && args[0] === '--synthetic',
    'No published predecessor is configured. Use pnpm test:upgrade:synthetic for a local regression rehearsal; it is NOT release acceptance. Use pnpm test:upgrade --published=<version> for the genuine upgrade.')
  assert(!Object.hasOwn(env, 'ADULA_PREVIOUS_VERSION'),
    'ADULA_PREVIOUS_VERSION cannot select a published baseline in the synthetic harness. Remove it; never relabel current source as a genuine release.')
  return '0.1.0'
}

/**
 * Genuine upgrade: `--published=<version>` installs that exact version of
 * adula and @adula/ui from the npm registry as the consumer's baseline.
 */
export function publishedBaseline(args, current) {
  assert(args.length === 1 && args[0].startsWith('--published='), 'Usage: pnpm test:upgrade --published=<npm version>')
  const version = args[0].slice('--published='.length)
  assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version), 'The published baseline must be an exact version')
  assert.notEqual(version, current, 'The baseline must be an earlier published release')
  return version
}

export function upgradeMode(args, env, current) {
  if (args.length === 1 && args[0].startsWith('--published='))
    return { mode: 'published', previous: publishedBaseline(args, current) }
  return { mode: 'synthetic', previous: requireSyntheticRehearsal(args, env) }
}
