import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { spawn } from 'node:child_process'
import { digest } from '../src/commands/agent_assets.js'
import { ensureAdulaCssEntry } from './ui_css.js'

type Item = {
  name: string
  dependencies?: string[]
  registryDependencies?: string[]
  files: { path: string; target: string; type: string; content: string }[]
}
type Lock = {
  version: string
  adulaCompatibility: string
  files: Record<string, { hash: string; component: string }>
}

export default class Ui extends BaseCommand {
  static commandName = 'adula:ui'
  static description = 'Install reviewed RTL components through the project-owned shadcn registry'
  @args.string() declare action: string
  @args.string() declare component: string
  @flags.boolean({ description: 'Show shadcn changes without modifying UI files' })
  declare preview: boolean
  @flags.boolean({
    description: 'Keep already reviewed customizations, re-record their hashes and update others',
  })
  declare accept: boolean
  async run() {
    if (this.action !== 'add')
      throw new Error('Usage: adula:ui add <component|all> [--preview|--accept]')
    if (this.preview && this.accept) throw new Error('Use either --preview or --accept, not both')
    if (this.app.inProduction) throw new Error('Install UI components in the source checkout')
    const root = this.app.makePath()
    const require = createRequire(this.app.makeURL('package.json'))
    const uiRoot = dirname(require.resolve('@adula/ui/package.json'))
    const manifest = JSON.parse(await readFile(join(uiRoot, 'build/manifest.json'), 'utf8'))
    const available = new Set<string>(manifest.items.map((item: { name: string }) => item.name))
    if (this.component !== 'all' && !available.has(this.component))
      throw new Error(`Unknown UI component: ${this.component}`)
    const collected = new Map<string, Item>()
    const load = async (name: string): Promise<void> => {
      if (collected.has(name)) return
      if (!available.has(name)) throw new Error(`Unreviewed registry dependency: ${name}`)
      const item: Item = JSON.parse(await readFile(join(uiRoot, 'build', `${name}.json`), 'utf8'))
      collected.set(name, item)
      for (const dependency of item.registryDependencies ?? []) await load(dependency)
    }
    for (const name of this.component === 'all' ? available : [this.component]) await load(name)
    let lock: Lock = {
      version: manifest.version,
      adulaCompatibility: manifest.adulaCompatibility,
      files: {},
    }
    try {
      lock = JSON.parse(await readFile(this.app.makePath('ui.lock.json'), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const customized = new Map<string, string>()
    for (const item of collected.values())
      for (const file of item.files) {
        const path = resolve(root, file.target)
        const local = relative(root, path)
        if (
          local.startsWith('..') ||
          isAbsolute(local) ||
          !file.target.startsWith('inertia/components/ui/')
        )
          throw new Error('Registry files must stay in inertia/components/ui')
        try {
          const current = await readFile(path, 'utf8')
          if (digest(current) !== lock.files[file.target]?.hash) {
            // --accept is the documented end of a review: the developer merged by hand,
            // so the file stays exactly as it is and only its recorded hash moves.
            if (this.accept) customized.set(file.target, current)
            else if (!this.preview)
              throw new Error(
                `Project customized ${file.target}; review it with --preview, merge the changes, then re-run with --accept`
              )
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    if (!this.preview) await this.initialize(uiRoot)
    else await access(this.app.makePath('components.json'))
    const bundle = {
      $schema: 'https://ui.shadcn.com/schema/registry-item.json',
      name: 'adula-ui',
      type: 'registry:ui',
      dependencies: [
        ...new Set([
          ...[...collected.values()].flatMap((item) => item.dependencies ?? []),
          ...['tw-animate-css', '@fontsource/ibm-plex-sans-arabic'].map(
            (name) => `${name}@${manifest.dependencies[name]}`
          ),
        ]),
      ],
      files: [...collected.values()].flatMap((item) => item.files),
    }
    const bundlePath = this.app.tmpPath('adula-ui.json')
    await mkdir(dirname(bundlePath), { recursive: true })
    await writeFile(bundlePath, JSON.stringify(bundle, null, 2))
    const command = require.resolve('shadcn')
    const bundleArgument = `./${relative(root, bundlePath).replaceAll('\\', '/')}`
    await new Promise<void>((done, reject) => {
      const child = spawn(
        process.execPath,
        [
          command,
          'add',
          bundleArgument,
          '--yes',
          ...(this.preview ? ['--dry-run'] : ['--overwrite']),
        ],
        { cwd: root, stdio: 'inherit', shell: false }
      )
      child.once('error', reject)
      child.once('exit', (code) =>
        code === 0 ? done() : reject(new Error(`shadcn exited with ${code}`))
      )
    })
    if (this.preview) return
    // shadcn overwrites unconditionally; reviewed customizations are put back untouched.
    for (const [target, content] of customized) await writeFile(this.app.makePath(target), content)
    for (const item of collected.values())
      for (const file of item.files)
        lock.files[file.target] = {
          hash: digest(await readFile(this.app.makePath(file.target), 'utf8')),
          component: item.name,
        }
    lock.version = manifest.version
    lock.adulaCompatibility = manifest.adulaCompatibility
    await writeFile(this.app.makePath('ui.lock.json'), JSON.stringify(lock, null, 2) + '\n')
    this.logger.success(
      `Installed ${collected.size} registry items; project file hashes recorded in ui.lock.json`
    )
    if (customized.size)
      this.logger.info(
        `Preserved ${customized.size} reviewed customization(s): ${[...customized.keys()].join(', ')}`
      )
  }
  private async initialize(uiRoot: string) {
    const root = this.app.makePath()
    const create = async (path: string, content: string) => {
      await mkdir(dirname(path), { recursive: true })
      try {
        await writeFile(path, content, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    await create(
      join(root, 'components.json'),
      JSON.stringify(
        {
          $schema: 'https://ui.shadcn.com/schema.json',
          style: 'new-york',
          rsc: false,
          tsx: true,
          rtl: true,
          tailwind: {
            config: '',
            css: 'inertia/css/adula.css',
            baseColor: 'neutral',
            cssVariables: true,
          },
          aliases: {
            components: '~/components',
            ui: '~/components/ui',
            utils: '~/lib/utils',
            lib: '~/lib',
            hooks: '~/hooks',
          },
          iconLibrary: 'lucide',
        },
        null,
        2
      ) + '\n'
    )
    await create(
      join(root, 'inertia/css/adula.css'),
      await readFile(join(uiRoot, 'build/theme.css'), 'utf8')
    )
    await create(join(root, 'inertia/lib/utils.ts'), "export { cn } from 'cn'\n")
    const tsPath = join(root, 'tsconfig.json')
    const ts = JSON.parse(await readFile(tsPath, 'utf8'))
    ts.compilerOptions ??= {}
    ts.compilerOptions.paths = { ...ts.compilerOptions.paths, '~/*': ['./inertia/*'] }
    await writeFile(tsPath, JSON.stringify(ts, null, 2) + '\n')
    const cssPath = join(root, 'inertia/css/app.css')
    const css = await readFile(cssPath, 'utf8')
    if (!css.includes('/* adula:legacy-layer */'))
      await writeFile(
        cssPath,
        `/* adula:legacy-layer */\n@layer theme, base, legacy, components, utilities;\n@layer legacy {\n${css}\n}\n`
      )
    const codemods = await this.createCodemods()
    // The framework codemod only supports an object config. A configured host
    // may use a callback (for test aliases, for example); do not rewrite it.
    const vite = await readFile(join(root, 'vite.config.ts'), 'utf8')
    if (!vite.includes("from '@tailwindcss/vite'") && !vite.includes('from "@tailwindcss/vite"'))
      await codemods.registerVitePlugin('tailwindcss()', [
        { module: '@tailwindcss/vite', identifier: 'tailwindcss', isNamed: false },
      ])
    const project = await codemods.getTsMorphProject()
    if (!project) throw new Error('UI installation requires @adonisjs/assembler')
    const entry = project.addSourceFileAtPathIfExists(join(root, 'inertia/app.tsx'))!
    // One CSS entry fixes layer ordering in development and production bundlers.
    const adulaCssPath = join(root, 'inertia/css/adula.css')
    const adulaCss = await readFile(adulaCssPath, 'utf8')
    const entryCss = ensureAdulaCssEntry(adulaCss)
    if (entryCss !== adulaCss) await writeFile(adulaCssPath, entryCss)
    entry.getImportDeclaration('./css/app.css')?.remove()
    if (!entry.getImportDeclaration('./css/adula.css'))
      entry.addImportDeclaration({ moduleSpecifier: './css/adula.css' })
    await entry.save()
  }
}
