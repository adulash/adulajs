import { mkdir, readFile, writeFile, access, glob } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { identifier } from '../resource/define_resource.js'
import type { Label } from '../resource/types.js'
import {
  appendMarkedItem,
  moduleRegistered,
  moduleSource,
  registerModuleSource,
} from './source_markers.js'

/** Every file a resource generation writes, computed without touching the disk. */
export type ResourcePlan = {
  /** New files relative to the application root; none may exist yet. */
  files: Record<string, string>
  /** The module definition after registering the resource (created when missing). */
  module: { path: string; source: string }
  /** start/modules.ts after registering the module, or null when it is already registered. */
  modules: { path: string; source: string } | null
}

/** A single-quoted TypeScript string literal. */
export function quoted(value: string) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

/**
 * Plans a scoped resource with its migration, model, validator, factory and security
 * contract, without writing. `moduleSource` replaces the module definition read from disk
 * (adula:app passes the module it is about to create); `label` sets the resource labels.
 */
export async function planResource(
  root: string,
  name: string,
  module: string,
  options: {
    moduleSource?: string
    label?: Label
    /** Also write a VineJS validator file; by default the fields are the validator (ADR 045). */
    validator?: boolean
    /** Also write a Lucid model and its factory; AdulaJS itself never reads a model. */
    model?: boolean
  } = {}
): Promise<ResourcePlan> {
  identifier(name)
  identifier(module)
  for await (const existing of glob(`app/modules/*/resources/${name}.ts`, { cwd: root }))
    throw new Error(`Refusing to overwrite resource registered at ${existing}`)
  const base = resolve(root, 'app/modules', module)
  const title = name.replace(/_/g, ' ')
  const ar = quoted(options.label?.ar ?? title)
  const en = quoted(options.label?.en ?? title)
  const relative = `app/modules/${module}`
  const imports = [
    ...(options.model ? [`import Model from '#modules/${module}/models/${name}'`] : []),
    ...(options.validator
      ? [`import { validator } from '#modules/${module}/validators/${name}'`]
      : []),
  ]
  const resourceSource = `import { defineResource } from 'adula'\n${imports.map((line) => `${line}\n`).join('')}\n// The fields are the source of truth: validation, columns and forms derive from them.\nexport default defineResource({\n  name: '${name}', label: { ar: ${ar}, en: ${en} },\n  recordLabel: { ar: ${ar}, en: ${en} },${options.model ? ' model: Model,' : ''} scoped: true,\n  fields: { title: { type: 'string', label: { ar: 'العنوان', en: 'Title' }, required: true, searchable: true } },\n  list: ['title'], form: ['title'], show: ['title'],\n  actions: ['view', 'create', 'update', 'delete'],${options.validator ? ' validator,' : ''}\n})\n`
  const migration = {
    name,
    scoped: true,
    fields: {
      title: {
        type: 'string',
        label: { ar: 'العنوان', en: 'Title' },
        required: true,
        searchable: true,
      },
    },
  }
  const files: Record<string, string> = {
    [`${relative}/resources/${name}.ts`]: resourceSource,
    [`${relative}/models/${name}.ts`]: `import { BaseModel, column } from '@adonisjs/lucid/orm'\nimport { DateTime } from 'luxon'\n\nexport default class extends BaseModel {\n  static table = '${name}'\n  @column({ isPrimary: true }) declare id: number\n  @column() declare title: string\n  @column() declare orgUnitId: number\n  @column() declare createdBy: number\n  @column() declare updatedBy: number\n  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime\n  @column.dateTime({ autoCreate: true, autoUpdate: true }) declare updatedAt: DateTime\n  @column.dateTime() declare deletedAt: DateTime | null\n}\n`,
    [`${relative}/validators/${name}.ts`]: `import vine from '@vinejs/vine'\nexport const validator = vine.create({ title: vine.string().trim().minLength(1).maxLength(255) })\n`,
    [`${relative}/migrations/${Date.now()}_create_${name}.ts`]: `import { BaseSchema } from '@adonisjs/lucid/schema'\nimport { createResourceTable } from 'adula'\nexport default class extends BaseSchema {\n  async up() { await createResourceTable(this.db.getWriteClient(), ${JSON.stringify(migration, null, 2)}) }\n  async down() { throw new Error('Use an expand/contract migration or restore a backup') }\n}\n`,
    [`${relative}/factories/${name}.ts`]: `import factory from '@adonisjs/lucid/factories'\nimport Model from '#modules/${module}/models/${name}'\nexport default factory.define(Model, ({ faker }) => ({ title: faker.lorem.words(3) })).build()\n`,
    [`tests/functional/${name}.spec.ts`]: `import { resourceContract } from '#tests/helpers/resource_contract'\n\n// Extend this fixture whenever the resource form or its validator changes.\nresourceContract('${name}', ({ unique }) => ({\n  input: { title: 'سجل ' + unique },\n  expected: { title: 'سجل ' + unique },\n  update: { title: 'سجل محدث ' + unique },\n  updated: { title: 'سجل محدث ' + unique },\n}))\n`,
  }
  // Opt-in only: the definition derives the validator, and persistence never reads a model.
  if (!options.model) {
    delete files[`${relative}/models/${name}.ts`]
    delete files[`${relative}/factories/${name}.ts`]
  }
  if (!options.validator) delete files[`${relative}/validators/${name}.ts`]
  const modulePath = join(base, 'module.ts')
  let current = options.moduleSource
  if (current === undefined)
    try {
      current = await readFile(modulePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      current = moduleSource(module)
    }
  if (!current.includes('// adula:imports') || !current.includes('/* adula:resources */'))
    throw new Error('Module registration markers are missing; no files were changed')
  const modulesPath = join(root, 'start/modules.ts')
  const modules = await readFile(modulesPath, 'utf8')
  if (!modules.includes('// adula:imports') || !modules.includes('/* adula:modules */'))
    throw new Error('Module index markers are missing; no files were changed')
  for (const file of Object.keys(files)) {
    try {
      await access(join(root, file))
      throw new Error(`Refusing to overwrite ${file}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return {
    files,
    module: {
      path: modulePath,
      source: appendMarkedItem(
        current.replace(
          '// adula:imports',
          `import resource_${name} from './resources/${name}.js'
// adula:imports`
        ),
        '/* adula:resources */',
        `resource_${name}`
      ),
    },
    modules: moduleRegistered(modules, module)
      ? null
      : { path: modulesPath, source: registerModuleSource(modules, module) },
  }
}

/** Writes a plan: new files first (never overwriting), then the module and the index. */
export async function writeResourcePlan(root: string, plan: ResourcePlan) {
  for (const [file, content] of Object.entries(plan.files)) {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, { flag: 'wx' })
  }
  await mkdir(dirname(plan.module.path), { recursive: true })
  await writeFile(plan.module.path, plan.module.source)
  if (plan.modules) await writeFile(plan.modules.path, plan.modules.source)
}

export async function generateResource(
  root: string,
  name: string,
  module: string,
  options: { validator?: boolean; model?: boolean } = {}
) {
  const plan = await planResource(root, name, module, options)
  await writeResourcePlan(root, plan)
  return Object.keys(plan.files)
}
