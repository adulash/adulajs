// Generates docs/reference/define-resource.md from the TSDoc comments of
// packages/adula/src/resource/types.ts. `--write` regenerates the page; without it
// the script fails when the committed page is stale (also run by pnpm check:api).
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'packages/adula/package.json'))
const ts = require('typescript')
export const sourcePath = join(root, 'packages/adula/src/resource/types.ts')
export const pagePath = join(root, 'docs/reference/define-resource.md')

/** Parses one `/** … *\/` block into its description and `@default` text. */
function parseDoc(block) {
  if (!block) return { description: '', default: undefined }
  const lines = block
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trim())
  const text = lines.join('\n')
  const [body, ...tags] = text.split(/\n?(?=@\w+)/)
  const fallback = tags.find((tag) => tag.startsWith('@default'))
  return {
    description: body.replace(/\s+/g, ' ').trim(),
    default: fallback === undefined ? undefined : fallback.slice('@default'.length).replace(/\s+/g, ' ').trim(),
  }
}

/** The last JSDoc block written between `from` and `to` in the source text. */
function docBetween(text, from, to) {
  const blocks = text.slice(from, to).match(/\/\*\*[\s\S]*?\*\//g)
  return parseDoc(blocks?.at(-1))
}

function cell(value) {
  return value.replace(/\|/g, '\\|')
}

/** One-line code span; members written on separate lines are joined with `;`. */
function code(value) {
  const line = value.replace(/[ \t]*\/\*[\s\S]*?\*\/[ \t]*\r?\n?/g, '').replace(/([^{(,;|&\s])[ \t]*\r?\n\s*(?=[^\s})\]])/g, '$1; ')
  return '`' + line.replace(/\s+/g, ' ').trim() + '`'
}

function defaultCell(property) {
  if (property.default === undefined) return property.optional ? '—' : 'required'
  const value = property.default
  if (value.includes('`')) return value
  return /^(['"].*['"]|true|false|-?\d+(\.\d+)?|[A-Z][A-Z0-9_]+)$/.test(value) ? code(value) : value
}

export function renderReference(sourceText) {
  const source = ts.createSourceFile('types.ts', sourceText, ts.ScriptTarget.Latest, true)
  const aliases = new Map()
  for (const statement of source.statements)
    if (ts.isTypeAliasDeclaration(statement)) aliases.set(statement.name.text, statement)
  const alias = (name) => {
    const declaration = aliases.get(name)
    if (!declaration) throw new Error(`types.ts no longer declares ${name}`)
    return declaration
  }

  /** Property signatures of a type literal, a local alias reference or an intersection. */
  function properties(node) {
    if (ts.isParenthesizedTypeNode(node)) return properties(node.type)
    if (ts.isIntersectionTypeNode(node)) return node.types.flatMap(properties)
    if (ts.isTypeReferenceNode(node) && aliases.has(node.typeName.getText(source)))
      return properties(aliases.get(node.typeName.getText(source)).type)
    if (!ts.isTypeLiteralNode(node)) return []
    return node.members.filter(ts.isPropertySignature).map((member) => ({
      name: member.name.getText(source),
      type: member.type ? member.type.getText(source) : 'unknown',
      typeNode: member.type,
      optional: Boolean(member.questionToken),
      ...docBetween(sourceText, member.pos, member.getStart(source)),
    }))
  }

  function table(rows, first = 'Option') {
    const lines = [`| ${first} | Type | Default | Description |`, '|---|---|---|---|']
    for (const row of rows)
      lines.push(
        `| ${code(row.name)} | ${cell(code(row.type))} | ${cell(defaultCell(row))} | ${cell(row.description || '—')} |`
      )
    return lines.join('\n')
  }

  const doc = (name) => docBetween(sourceText, alias(name).pos, alias(name).getStart(source)).description

  const field = alias('Field').type
  if (!ts.isIntersectionTypeNode(field)) throw new Error('Field is no longer `{ common } & (variants)`')
  const [common, variantsNode] = field.types
  const union = ts.isParenthesizedTypeNode(variantsNode) ? variantsNode.type : variantsNode
  if (!ts.isUnionTypeNode(union)) throw new Error('Field variants are no longer a union')

  const variants = union.types.map((member, index) => {
    // Prettier may move the first variant's comment in front of the parenthesis.
    const previous = index === 0 ? common.end : union.types[index - 1].end
    const own = docBetween(sourceText, previous, member.getStart(source))
    const props = properties(member)
    const discriminant = props.find((prop) => prop.name === 'type')
    if (!discriminant) throw new Error(`A Field variant has no type: ${member.getText(source)}`)
    const literals = ts.isUnionTypeNode(discriminant.typeNode)
      ? discriminant.typeNode.types.map((type) => type.getText(source))
      : [discriminant.typeNode.getText(source)]
    return {
      types: literals.map((literal) => literal.replace(/^'|'$/g, '')),
      description: [own.description, discriminant.description].filter(Boolean).join(' '),
      props: props.filter((prop) => prop.name !== 'type'),
    }
  })

  const out = []
  out.push('# defineResource reference', '')
  out.push(
    '<!-- Generated by scripts/define-resource-reference.mjs from packages/adula/src/resource/types.ts. Do not edit by hand: run `pnpm docs:reference`. -->',
    ''
  )
  out.push(
    'Every option of `defineResource({ … })` and every field type, generated from the TSDoc comments of',
    '[`packages/adula/src/resource/types.ts`](../../packages/adula/src/resource/types.ts). The',
    '[resource definitions guide](../resources.md) explains how to use them: columns, wire values,',
    'list filters, migrations and validation.',
    ''
  )
  out.push('A Default of `required` means the option must be given; `—` means it is optional and has no default.', '')

  out.push('## Resource options', '', doc('Resource'), '', table(properties(alias('Resource').type)), '')
  out.push('## Common field props', '', 'Every field accepts these props, whatever its `type`.', '')
  out.push(table(properties(common), 'Prop'), '')

  out.push('## Field types', '')
  out.push(
    variants
      .flatMap((variant) => variant.types)
      .map((type) => code(type))
      .join(' · '),
    ''
  )
  for (const variant of variants) {
    out.push(`### ${variant.types.map(code).join(', ')}`, '')
    if (variant.description) out.push(variant.description, '')
    if (variant.props.length) out.push(table(variant.props, 'Prop'), '')
    else out.push('No type-specific props.', '')
  }

  out.push('## Supporting types', '')
  for (const name of ['Label', 'FieldOption', 'TextConstraints', 'NumberConstraints', 'HookContext']) {
    out.push(`### ${code(name)}`, '')
    if (doc(name)) out.push(doc(name), '')
    out.push(code(alias(name).type.getText(source)), '')
  }

  out.push('## Module options', '')
  out.push('A module (`app/modules/<name>/module.ts`) groups the resources of one application.', '')
  for (const name of ['Module', 'ModuleRole', 'ModuleLookup']) {
    out.push(`### ${code(name)}`, '')
    if (doc(name)) out.push(doc(name), '')
    out.push(table(properties(alias(name).type)), '')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** Whether the committed page matches the current types.ts. */
export async function referenceIsCurrent() {
  const expected = renderReference(await readFile(sourcePath, 'utf8'))
  let actual = ''
  try {
    actual = (await readFile(pagePath, 'utf8')).replace(/\r\n/g, '\n')
  } catch {
    /* a missing page is stale */
  }
  return actual === expected
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    await mkdir(dirname(pagePath), { recursive: true })
    await writeFile(pagePath, renderReference(await readFile(sourcePath, 'utf8')))
    console.log(`Wrote ${pagePath}`)
  } else if (!(await referenceIsCurrent())) {
    console.error('docs/reference/define-resource.md is stale. Run pnpm docs:reference and commit the page.')
    process.exit(1)
  } else console.log('defineResource reference is current')
}
