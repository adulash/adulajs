import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = 'git+https://github.com/adulash/adulajs.git'
export const packageNames = ['adula', '@adula/ui', 'create-adulajs']
export const packageDirectories = ['adula', 'ui', 'create-adula-app']
/** The archive name pnpm pack writes for a package: @adula/ui -> adula-ui-<version>.tgz. */
export const tarballName = (name, version) => `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
export function validateManifest(pkg, name, version) {
  assert.equal(pkg.name, name, 'Unexpected package name')
  assert.equal(pkg.version, version, 'Package versions must match')
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Invalid release version')
  assert.notEqual(pkg.private, true, 'Package is private')
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.repository?.url, repository, 'Provenance repository mismatch')
  assert.equal(pkg.repository?.directory, `packages/${packageDirectories[packageNames.indexOf(name)]}`)
  assert.equal(pkg.publishConfig?.access, 'public')
  assert.equal(pkg.publishConfig?.provenance, true)
  assert(pkg.files?.includes('build'), 'Build allowlist is missing')
  for (const dependencies of [pkg.dependencies, pkg.devDependencies]) {
    for (const [dependency, range] of Object.entries(dependencies ?? {})) {
      assert(!/^(workspace:|file:|link:)/.test(range), `${dependency} has a local dependency`)
    }
  }
}

export function validateContents(pkg, files) {
  const paths = new Set(files)
  for (const path of paths) {
    assert(path.startsWith('package/') && !path.includes('..') && !path.includes('\\'), `Unsafe archive path: ${path}`)
    assert(!/(^|\/)(?:node_modules|tests|bin|\.git|\.work)(?:\/|$)/.test(path), `Private source in archive: ${path}`)
    assert(!/(^|\/)(?:\.env(?:\..*)?|\.npmrc|.*\.(?:pem|key|pfx|log))$/i.test(path), `Private file in archive: ${path}`)
  }
  const required = ['package/package.json', 'package/README.md']
  if (pkg.name === 'adula') required.push('package/LICENSE.md', 'package/build/index.js', 'package/build/index.d.ts', 'package/build/configure.js', 'package/build/commands/main.js', 'package/build/agent/AGENTS.template.md', 'package/build/agent/skills/adula-frontend-design/SKILL.md', 'package/build/agent/skills/idea-review/SKILL.md')
  else if (pkg.name === '@adula/ui') required.push('package/LICENSE', 'package/LICENSE.shadcn.md', 'package/UPSTREAM.json', 'package/build/manifest.json', 'package/build/dialog.json', 'package/build/resource-page.json', 'package/build/resource-surface.json')
  else required.push('package/LICENSE', 'package/build/cli.mjs', 'package/build/project.mjs', 'package/build/system.mjs', 'package/build/prerequisites.mjs', 'package/build/template.json')
  for (const path of required) assert(paths.has(path), `Required package file missing: ${path}`)
  for (const target of [...Object.values(pkg.exports ?? {}), ...Object.values(pkg.bin ?? {})]) {
    const path = `package/${target.replace(/^\.\//, '')}`
    if (path.includes('*')) {
      const [prefix, suffix] = path.split('*')
      assert([...paths].some((file) => file.startsWith(prefix) && file.endsWith(suffix)), `Empty export: ${target}`)
    } else assert(paths.has(path), `Broken export: ${target}`)
  }
}

export async function checkRelease({ root = fileURLToPath(new URL('../', import.meta.url)), artifacts } = {}) {
  const manifests = await Promise.all(packageDirectories.map(async (name) => JSON.parse(await readFile(resolve(root, `packages/${name}/package.json`), 'utf8'))))
  const version = manifests[0].version
  manifests.forEach((pkg, index) => validateManifest(pkg, packageNames[index], version))
  if (artifacts) {
    const sums = []
    for (const source of manifests) {
      const filename = tarballName(source.name, version)
      const archive = resolve(root, artifacts, filename)
      // A bare filename avoids GNU tar interpreting a Windows drive colon as a remote host.
      const tar = (args) => execFileSync('tar', args, { cwd: dirname(archive), encoding: 'utf8', windowsHide: true })
      const files = tar(['-tf', filename]).trim().split(/\r?\n/).filter((file) => !file.endsWith('/'))
      const packed = JSON.parse(tar(['-xOf', filename, 'package/package.json']))
      validateManifest(packed, source.name, version)
      assert.deepEqual(packed.exports, source.exports, 'Packed exports differ from source')
      assert.deepEqual(packed.bin, source.bin, 'Packed executable differs from source')
      validateContents(packed, files)
      if (source.name === '@adula/ui') {
        const registry = JSON.parse(tar(['-xOf', filename, 'package/build/manifest.json']))
        assert.equal(registry.version, version, 'Registry was not rebuilt')
        for (const item of registry.items) assert(files.includes(`package/build/${item.name}.json`), `Missing registry item: ${item.name}`)
      }
      if (source.name === 'create-adulajs') {
        const template = JSON.parse(tar(['-xOf', filename, 'package/build/template.json']))
        assert.equal(template.version, version, 'Creator template was not rebuilt')
        const app = JSON.parse(template.files['package.json'])
        for (const dependency of ['adula', '@adula/ui']) assert.equal(app.dependencies[dependency], version, 'Creator dependency version mismatch')
        for (const path of Object.keys(template.files)) {
          assert(!path.startsWith('/') && !path.includes('..') && !path.includes('\\'), 'Unsafe template path')
          assert(!/(^|\/)(?:\.env(?:\..*)?|node_modules|fixtures|\.git|\.work)(?:\/|$)/.test(path), `Private template file: ${path}`)
        }
      }
      sums.push(`${createHash('sha256').update(await readFile(archive)).digest('hex')}  ${filename}`)
    }
    await writeFile(resolve(root, artifacts, 'SHA256SUMS'), sums.join('\n') + '\n')
  }
  return version
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = {}
    for (const arg of process.argv.slice(2)) {
      assert(/^--artifacts=.+$/.test(arg), 'Usage: pnpm check:release [--artifacts=.work]')
      const separator = arg.indexOf('=')
      options[arg.slice(2, separator)] = arg.slice(separator + 1)
    }
    console.log(`Release package checks passed (${await checkRelease(options)}${options.artifacts ? ', archives and SHA256SUMS' : ', manifests only'}).`)
  } catch (error) {
    console.error(`Release blocked: ${error.message}`)
    process.exitCode = 1
  }
}
