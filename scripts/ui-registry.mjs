// Maintenance entry point for the @adula/ui registry, the single source of copied UI.
//   sync       fetch the upstream shadcn primitives (network, explicit maintenance)
//   prepare    adapt sources for Arabic RTL and refresh pinned versions (--sources-only skips npm)
//   build      write packages/ui/build (JSON registry items and manifest)
//   reference  generate apps/reference/inertia/components/ui and ui.lock.json from the registry
// registry.json is edited by hand: add or change an item's entry directly (issue #163).
import { cp, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const root = new URL('../packages/ui/', import.meta.url)
const reference = new URL('../apps/reference/', import.meta.url)
const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'))
const writeJson = (url, value) => writeFile(url, JSON.stringify(value, null, 2) + '\n')

// Same digest as adula:ui and adula:doctor (packages/adula/src/commands/agent_assets.ts).
export const digest = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')

// The direction transform shadcn applies on `add` when components.json sets "rtl": true.
export async function loadTransformDirection() {
  const require = createRequire(new URL('package.json', root))
  const { transformDirection } = await import(pathToFileURL(require.resolve('shadcn/utils')).href)
  return transformDirection
}

// shadcn's direction transform appends an `rtl:` counterpart after every physical
// translate-x class without checking for an existing one, so a second install adds a
// duplicate (the reference switch carried two). An explicit ltr:/rtl: pair is left alone,
// which makes the stored source a fixed point: installing it reproduces it byte for byte.
// The same holds for the resize cursors of shadcn's SidebarRail.
const TRANSLATE = /^((?:[^\s:'"`]+:)*)(-?translate-x-\S+|cursor-[ew]-resize)$/
// [text, code before the class (up to its opening quote), class, closing punctuation]
const token = (text) => {
  const end = text.match(/[)}"'`,;]*$/).index
  const body = text.slice(0, end)
  const start = Math.max(body.lastIndexOf('"'), body.lastIndexOf("'"), body.lastIndexOf('`')) + 1
  return [text, body.slice(0, start), body.slice(start), text.slice(end)]
}
export function pairDirectionalTranslates(code) {
  const parts = code.split(/(\s+)/)
  for (let index = 0; index < parts.length; index += 2) {
    const [, lead, core, trail] = token(parts[index])
    const match = core.match(TRANSLATE)
    if (!match || /(^|:)(rtl|ltr):/.test(match[1]) || trail) continue
    const partner = `rtl:${match[1]}`
    const partners = []
    for (let next = index + 2; next < parts.length; next += 2) {
      const [, nextLead, nextCore, nextTrail] = token(parts[next])
      if (nextLead || !nextCore.startsWith(partner)) break
      if (!/^(-?translate-x-|cursor-[ew]-resize$)/.test(nextCore.slice(partner.length))) break
      partners.push(next)
      if (nextTrail) break
    }
    if (!partners.length) continue
    parts[index] = `${lead}ltr:${core}${trail}`
    const kept = token(parts[partners.at(-1)])[2]
    for (const duplicate of partners.slice(0, -1))
      if (token(parts[duplicate])[2] === kept) parts[duplicate] = parts[duplicate - 1] = ''
  }
  return parts.join('')
}

// Every rewrite is a no-op on its own output for the current sources, so prepare can run on
// adapted files. The pairing covers translate-x only; the drift gate in packages/ui/tests fails
// when an upstream source brings another class the direction transform keeps appending to.
export async function adaptSource(filename, source, transformDirection) {
  let code = source
    .replaceAll('@/registry/new-york-v4/ui/', '~/components/ui/')
    // Registry .ts files are snake_case (the application's lint rules), so the hook is use_mobile.
    .replaceAll('@/registry/new-york-v4/hooks/use-mobile', '~/components/ui/use_mobile')
    .replace(/\bml-/g, 'ms-').replace(/\bmr-/g, 'me-').replace(/\bpl-/g, 'ps-').replace(/\bpr-/g, 'pe-')
    .replaceAll('text-left', 'text-start').replaceAll('text-right', 'text-end')
    .replaceAll('absolute top-4 right-4', 'absolute top-4 end-4')
    .replaceAll('absolute right-2', 'absolute end-2').replaceAll('absolute left-2', 'absolute start-2')
    .replaceAll('after:-right-1', 'after:-end-1').replaceAll('>Close<', '>إغلاق<')
  code = code.replace(/<(SelectPrimitive|DropdownMenuPrimitive|RadioGroupPrimitive|TabsPrimitive|SliderPrimitive)\.Root(?! dir=)/g, '<$1.Root dir="rtl"')
  if (filename === 'breadcrumb.tsx') code = code.replace('aria-label="breadcrumb"', 'aria-label="مسار التنقل"')
    .replace('{children ?? <ChevronRight />}', '{children ?? <ChevronRight className="rtl:rotate-180" />}')
    .replace('>More</span>', '>المزيد</span>')
  if (filename === 'sidebar.tsx') code = code.replace('>Toggle Sidebar<', '>إظهار القائمة الجانبية أو طيها<')
    .replace('aria-label="Toggle Sidebar"', 'aria-label="إظهار القائمة الجانبية أو طيها"')
    .replace('title="Toggle Sidebar"', 'title="إظهار القائمة الجانبية أو طيها"')
    .replace('<SheetTitle>Sidebar</SheetTitle>', '<SheetTitle>القائمة الجانبية</SheetTitle>')
    .replace('Displays the mobile sidebar.', 'القائمة الجانبية على الجوال.')
    // The rail sits on the sidebar's inner edge; the direction transform leaves these physical.
    .replace('group-data-[side=left]:-right-4 group-data-[side=right]:left-0', 'group-data-[side=left]:-end-4 group-data-[side=right]:start-0')
  if (filename === 'pagination.tsx') code = code.replaceAll('"pagination"', '"التنقل بين الصفحات"')
    .replaceAll('Go to previous page', 'الصفحة السابقة').replaceAll('Go to next page', 'الصفحة التالية')
    .replaceAll('>Previous<', '>السابق<').replaceAll('>Next<', '>التالي<').replaceAll('>More pages<', '>صفحات أخرى<')
    .replaceAll('<ChevronLeftIcon />', '<ChevronLeftIcon className="rtl:rotate-180" />')
    .replaceAll('<ChevronRightIcon />', '<ChevronRightIcon className="rtl:rotate-180" />')
  if (filename === 'use_mobile.ts') code = code.replace(/"([^"\n]*)"/g, "'$1'")
  if (filename === 'dropdown-menu.tsx') code = code.replace('className="ms-auto size-4"', 'className="ms-auto size-4 rtl:rotate-180"')
  if (filename === 'command.tsx') code = code.replace('"Command Palette"', '"قائمة الأوامر"').replace('"Search for a command to run..."', '"ابحث عن أمر لتنفيذه"')
  if (filename === 'calendar.tsx' && !code.includes('react-day-picker/locale')) code =
    code.replace('import * as React', "import { ar } from 'react-day-picker/locale'\nimport * as React").replace('<DayPicker\n', '<DayPicker\n      dir="rtl"\n      locale={ar}\n').replace('toLocaleString("default"', 'toLocaleString("ar"')
  if (filename === 'sonner.tsx') code = code.replace('import { useTheme } from "next-themes"\n', '')
    .replace('  const { theme = "system" } = useTheme()\n', '').replace('theme={theme as ToasterProps["theme"]}', 'theme="light"\n      dir="rtl"')
  // Applications use "rsc": false, so shadcn strips the directive on install; Inertia ignores it.
  code = code.replace(/^(["'])use client\1;?\n\n?/, '')
  return pairDirectionalTranslates(await transformDirection(code, true))
}

// The shadcn new-york-v4 items AdulaJS stores (ADR 055). Their files as fetched live in
// packages/ui/upstream (not published); UPSTREAM.json records each file's sha256, and the
// registry test checks both the hashes and that registry/ui is the prepared copy.
export const UPSTREAM_ITEMS = ['button', 'input', 'textarea', 'select', 'checkbox', 'switch', 'radio-group', 'table', 'form', 'label', 'dialog', 'sheet', 'dropdown-menu', 'popover', 'command', 'calendar', 'badge', 'card', 'tabs', 'sonner', 'skeleton', 'pagination', 'tooltip', 'separator', 'alert', 'breadcrumb', 'sidebar', 'avatar', 'slider', 'alert-dialog', 'scroll-area', 'use-mobile', 'collapsible']

// Fetches the upstream files only; registry/ui and registry.json are reviewed edits
// (prepare --sources-only refreshes the stored files that carry no AdulaJS edit).
async function sync() {
  await mkdir(new URL('upstream/', root), { recursive: true })
  const sources = []
  for (const name of UPSTREAM_ITEMS) {
    const url = `https://ui.shadcn.com/r/styles/new-york-v4/${name}.json`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
    const item = await response.json()
    if (item.name !== name || !Array.isArray(item.files)) throw new Error(`Invalid registry response: ${name}`)
    for (const file of item.files) {
      const filename = file.path.split('/').at(-1)
      if (!/^[a-z][a-z0-9_-]*\.tsx?$/.test(filename)) throw new Error(`Unexpected upstream file: ${file.path}`)
      await writeFile(new URL(`upstream/${filename}`, root), file.content)
      sources.push({
        name, url, path: `registry/ui/${filename.endsWith('.ts') ? filename.replaceAll('-', '_') : filename}`, upstream: `upstream/${filename}`,
        sha256: createHash('sha256').update(file.content).digest('hex'),
        dependencies: item.dependencies ?? [], registryDependencies: item.registryDependencies ?? [],
      })
    }
    console.log(`Fetched ${name}`)
  }
  await writeJson(new URL('UPSTREAM.json', root), sources)
  const licenseResponse = await fetch('https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md')
  if (!licenseResponse.ok) throw new Error(`License: HTTP ${licenseResponse.status}`)
  await writeFile(new URL('LICENSE.shadcn.md', root), await licenseResponse.text())
  console.log('Registry sources saved. Review dependencies, Arabic labels and RTL before building.')
}

// Stored upstream files that carry an AdulaJS edit beyond adaptSource, with the reason (ADR 055).
// prepare leaves them alone; their upstream changes are merged by hand. Every other upstream
// file is regenerated from packages/ui/upstream, and the registry test refuses any drift.
export const UPSTREAM_EDITS = {
  dialog: 'unsaved-change protection, confirm mode and dialog URLs (ADR 016, ADR 035)',
  tabs: 'the `wrap` option of TabsList, its overflow Scroll Area and the interface direction (ADR 049, ADR 055)',
  pagination: 'interface text through useMessages for the optional languages (ADR 041)',
  sidebar: 'no Ctrl+B keyboard shortcut and no sidebar_state cookie: the state is the user preference shell.sidebar (ADR 049)',
}

async function prepare({ sourcesOnly }) {
  const transformDirection = await loadTransformDirection()
  for (const entry of await readJson(new URL('UPSTREAM.json', root))) {
    if (UPSTREAM_EDITS[entry.name]) continue
    const source = await readFile(new URL(entry.upstream, root), 'utf8')
    await writeFile(new URL(entry.path, root), await adaptSource(basename(entry.path), source, transformDirection))
  }
  for (const filename of await readdir(new URL('registry/ui/', root))) {
    const path = new URL(`registry/ui/${filename}`, root)
    const code = await readFile(path, 'utf8')
    const adapted = await adaptSource(filename, code, transformDirection)
    if (adapted !== code) await writeFile(path, adapted)
  }
  if (sourcesOnly) return
  // Refresh exactly the packages already pinned; adding one is a reviewed edit to dependencies.json.
  const exec = promisify(execFile)
  const registry = await readJson(new URL('registry.json', root))
  const packages = Object.keys(await readJson(new URL('dependencies.json', root)))
  const metadata = {}
  const nodeDirectory = dirname(process.execPath)
  const npm =
    process.env.NPM_CLI_PATH ??
    [
      join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
      join(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
    ].find((candidate) => existsSync(candidate))
  if (!npm) throw new Error('npm CLI not found next to Node.js; set NPM_CLI_PATH')
  for (let offset = 0; offset < packages.length; offset += 4) {
    await Promise.all(packages.slice(offset, offset + 4).map(async (name) => {
      const { stdout } = await exec(process.execPath, [npm, 'view', name, 'version', 'time.modified', 'peerDependencies', '--json'])
      metadata[name] = JSON.parse(stdout)
    }))
  }
  const pins = Object.fromEntries(Object.entries(metadata).map(([name, value]) => [name, value.version]))
  await writeJson(new URL('dependencies.json', root), pins)
  await writeJson(new URL('../.work/ui-dependency-metadata.json', import.meta.url), metadata)
  for (const item of registry.items) {
    item.dependencies = (item.dependencies ?? []).filter((name) => name !== 'next-themes').map((spec) => {
      const name = spec.replace(/@[^/@]+$/, '')
      if (!pins[name]) throw new Error(`Missing version: ${name}`)
      return `${name}@${pins[name]}`
    })
    if (['button', 'badge', 'tabs', 'alert'].includes(item.name)) item.dependencies.push(`class-variance-authority@${pins['class-variance-authority']}`)
    if (item.files.some((file) => file.path.endsWith('.tsx'))) item.dependencies.push(`lucide-react@${pins['lucide-react']}`)
    item.dependencies = [...new Set(item.dependencies)]
  }
  await writeJson(new URL('registry.json', root), registry)
  console.log(JSON.stringify(pins, null, 2))
}

async function build() {
  const pkg = await readJson(new URL('package.json', root))
  const registry = await readJson(new URL('registry.json', root))
  const dependencies = await readJson(new URL('dependencies.json', root))
  await mkdir(new URL('build/', root), { recursive: true })
  const items = []
  for (const entry of registry.items) {
    const files = await Promise.all(entry.files.map(async (file) => {
      const content = await readFile(new URL(file.path, root), 'utf8')
      return { ...file, content, target: `inertia/components/ui/${file.path.split('/').at(-1)}` }
    }))
    const item = { ...entry, files, $schema: 'https://ui.shadcn.com/schema/registry-item.json' }
    await writeJson(new URL(`build/${entry.name}.json`, root), item)
    items.push({ name: entry.name, version: pkg.version,
      hash: createHash('sha256').update(JSON.stringify(item)).digest('hex') })
  }
  await cp(new URL('registry/theme.css', root), new URL('build/theme.css', root))
  await writeJson(new URL('build/manifest.json', root), {
    // Derived so a minor release actually signals a compatibility review in doctor.
    version: pkg.version, adulaCompatibility: pkg.version.split('.').slice(0, 2).join('.'), items, dependencies,
  })
  console.log(`Built ${items.length} RTL registry items (${pkg.version})`)
}

// What `adula:ui add all` leaves in an application: every registry file under
// inertia/components/ui (the sources are install fixed points) and their hashes.
export async function referenceSnapshot() {
  const pkg = await readJson(new URL('package.json', root))
  const registry = await readJson(new URL('registry.json', root))
  const files = new Map()
  const lock = { version: pkg.version, adulaCompatibility: pkg.version.split('.').slice(0, 2).join('.'), files: {} }
  for (const item of registry.items)
    for (const file of item.files) {
      const target = `inertia/components/ui/${basename(file.path)}`
      const source = new URL(file.path, root)
      files.set(target, source)
      lock.files[target] = { hash: digest(await readFile(source, 'utf8')), component: item.name }
    }
  return { files, lock }
}

// The reference application's copy is generated, never edited: it is replaced as a whole.
export async function writeReference(app = fileURLToPath(reference)) {
  const { files, lock } = await referenceSnapshot()
  const directory = join(app, 'inertia/components/ui')
  if (resolve(directory) !== resolve(app, 'inertia', 'components', 'ui')) throw new Error('Invalid target')
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  for (const [target, source] of files) await copyFile(source, join(app, target))
  await writeJson(pathToFileURL(join(app, 'ui.lock.json')), lock)
  return files.size
}

const commands = {
  sync,
  prepare: () => prepare({ sourcesOnly: process.argv.includes('--sources-only') }),
  build,
  reference: async () => console.log(`Generated ${await writeReference()} reference UI files from @adula/ui`),
}
// Node resolves the main module through symlinks and junctions; argv[1] keeps the given path.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const command = commands[process.argv[2]]
  if (!command) throw new Error(`Usage: node scripts/ui-registry.mjs <${Object.keys(commands).join('|')}>`)
  await command()
}
