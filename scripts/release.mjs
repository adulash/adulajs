// Release tooling (ADR 054). Repository tooling only, never part of a published package.
//
//   pnpm release:prepare patch|minor|major|X.Y.Z   set every version and date the CHANGELOG
//   node scripts/release.mjs guard --published=X   CI: is this commit a new, semver-correct release?
//   node scripts/release.mjs notes X.Y.Z           the CHANGELOG section, for the GitHub release
//   node scripts/release.mjs baseline --published='["1.0.0",...]'  the genuine upgrade's start
//
// `--root=<dir>` points prepare at another checkout (used by its test).
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bumpKind,
  changelogSection,
  compareVersions,
  moveUnreleased,
  nextVersion,
  semverProblems,
  setVersion,
  upgradeBaseline,
  VERSION_FILES,
} from './lib/release-version.mjs'

const API = 'packages/adula/api/adula-api.json'

function option(args, name) {
  const found = args.find((arg) => arg.startsWith(`--${name}=`))
  return found?.slice(name.length + 3)
}

/** The API report as it was at tag v<version>, or null when the tag is not in this clone. */
function apiAt(root, version) {
  try {
    const text = execFileSync('git', ['show', `v${version}:${API}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function prepare(root, spec, date = new Date().toISOString().slice(0, 10)) {
  const current = (await readJson(join(root, 'packages/adula/package.json'))).version
  const version = nextVersion(current, spec)
  const kind = bumpKind(current, version)
  const previousApi = apiAt(root, current)
  if (previousApi) {
    const problems = semverProblems(kind, previousApi, await readJson(join(root, API)))
    if (problems.length) throw new Error(problems.join('\n'))
  }
  // Read and check everything before writing anything.
  const changelog = moveUnreleased(await readFile(join(root, 'CHANGELOG.md'), 'utf8'), version, date)
  const edits = []
  for (const file of VERSION_FILES) {
    const path = join(root, file.path)
    edits.push([path, setVersion(await readFile(path, 'utf8'), file, version)])
  }
  edits.push([join(root, 'CHANGELOG.md'), changelog])
  for (const [path, text] of edits) await writeFile(path, text)
  return { previous: current, version, kind, apiChecked: Boolean(previousApi) }
}

/**
 * Whether the checked-out commit is a release to publish: its version is after the latest
 * published one and the public API changed only as that kind of release allows.
 */
export async function guard(root, published) {
  const version = (await readJson(join(root, 'packages/adula/package.json'))).version
  if (published && compareVersions(version, published) <= 0)
    return { release: false, version, reason: `${version} is not after the published ${published}` }
  if (published) {
    const kind = bumpKind(published, version)
    const previousApi = apiAt(root, published)
    if (!previousApi) throw new Error(`Tag v${published} is missing; fetch tags before the guard`)
    const problems = semverProblems(kind, previousApi, await readJson(join(root, API)))
    if (problems.length) throw new Error(problems.join('\n'))
    return { release: true, version, kind }
  }
  return { release: true, version, kind: 'first' }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2).filter((arg) => arg !== '--')
  const root = option(args, 'root') ?? fileURLToPath(new URL('../', import.meta.url))
  const positional = args.filter((arg) => !arg.startsWith('--'))
  try {
    if (command === 'prepare') {
      if (!positional[0]) throw new Error('Usage: pnpm release:prepare patch|minor|major|X.Y.Z')
      const result = await prepare(root, positional[0])
      console.log(`Prepared ${result.version} (${result.kind} after ${result.previous}).`)
      if (!result.apiChecked) console.log(`Tag v${result.previous} is not in this clone: CI checks the API against it.`)
      console.log('Next: pnpm build, review the diff, open the pull request. Merging it releases the version.')
    } else if (command === 'guard') {
      const result = await guard(root, option(args, 'published') || undefined)
      console.log(JSON.stringify(result))
      if (process.env.GITHUB_OUTPUT)
        await writeFile(process.env.GITHUB_OUTPUT, `release=${result.release}\nversion=${result.version}\n`, { flag: 'a' })
    } else if (command === 'notes') {
      process.stdout.write(changelogSection(await readFile(join(root, 'CHANGELOG.md'), 'utf8'), positional[0]))
    } else if (command === 'baseline') {
      const current = (await readJson(join(root, 'packages/adula/package.json'))).version
      console.log(upgradeBaseline(JSON.parse(option(args, 'published') ?? '[]'), current))
    } else {
      throw new Error('Usage: node scripts/release.mjs prepare|guard|notes|baseline')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
