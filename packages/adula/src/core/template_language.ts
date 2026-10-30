import { AdulaError } from '../admin/errors.js'

/**
 * The `{{name}}` placeholder of message templates (core/message_templates.ts). Print
 * templates use the same delimiters with a small block grammar on top (see parseTemplate).
 */
export const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

const NAME = '[a-zA-Z][a-zA-Z0-9_]*'
const SCOPED = new RegExp(`^(field|row)\\.(${NAME})$`)
const LINES = new RegExp(`^lines\\.(${NAME})(?:\\.(${NAME}))?$`)
const META = new RegExp(`^(${NAME})$`)
const STRING = /^"([^"\\{}<>]{1,100})"$/
const HELPER = new RegExp(`^(${NAME})\\s+(\\S.*)$`)
/** Longest template accepted, in characters. */
export const TEMPLATE_SOURCE_LIMIT = 20000
const TAG_LIMIT = 2000

/** A value a template tag names. Nothing else is addressable: no expressions, no paths. */
export type TemplateRef =
  | { kind: 'field'; key: string }
  | { kind: 'row'; key: string }
  | { kind: 'lines'; key: string; column?: string }
  | { kind: 'meta'; key: string }
  | { kind: 'string'; value: string }
export type TemplateNode =
  | { type: 'text'; value: string }
  | { type: 'output'; helper: string | null; arg: TemplateRef; source: string }
  | { type: 'if'; test: TemplateRef; then: TemplateNode[]; else: TemplateNode[]; source: string }
  | { type: 'each'; group: string; body: TemplateNode[]; source: string }

export function templateError(message: string): never {
  throw new AdulaError(422, 'E_PRINT_TEMPLATE', message)
}

function reference(source: string, tag: string): TemplateRef {
  const scoped = SCOPED.exec(source)
  if (scoped) return { kind: scoped[1] as 'field' | 'row', key: scoped[2] }
  const lines = LINES.exec(source)
  if (lines) return { kind: 'lines', key: lines[1], ...(lines[2] ? { column: lines[2] } : {}) }
  const string = STRING.exec(source)
  if (string) return { kind: 'string', value: string[1] }
  if (META.test(source)) return { kind: 'meta', key: source }
  return templateError(`تعبير غير مسموح في القالب: {{${tag}}}`)
}

/**
 * Parses the template language shared by print templates:
 *
 * - `{{field.key}}`, `{{row.key}}` (inside each), `{{name}}` (document values such as id)
 * - `{{helper arg}}` where arg is one of the above, `lines.group.column` or `"text"`
 * - `{{#if ref}}…{{else}}…{{/if}}` and `{{#each lines.group}}…{{/each}}` (not nested)
 *
 * There are no expressions, no property paths beyond these and no raw output: `{{{`
 * is refused. Which names exist is checked by the caller against its own schema.
 */
export function parseTemplate(source: string): TemplateNode[] {
  if (source.length > TEMPLATE_SOURCE_LIMIT)
    templateError(`القالب أطول من ${TEMPLATE_SOURCE_LIMIT} حرف`)
  if (source.includes('{{{') || source.includes('}}}'))
    templateError('الصيغة {{{ }}} غير مسموحة؛ تُعرض كل القيم بعد تهريبها')
  const root: TemplateNode[] = []
  const stack: { node: TemplateNode & { type: 'if' | 'each' }; inElse: boolean }[] = []
  const target = () => {
    const top = stack.at(-1)
    if (!top) return root
    if (top.node.type === 'each') return top.node.body
    return top.inElse ? top.node.else : top.node.then
  }
  let index = 0
  while (index < source.length) {
    const open = source.indexOf('{{', index)
    if (open === -1) {
      target().push({ type: 'text', value: source.slice(index) })
      break
    }
    if (open > index) target().push({ type: 'text', value: source.slice(index, open) })
    const close = source.indexOf('}}', open + 2)
    if (close === -1) templateError('وسم غير مكتمل في القالب: {{ بلا }}')
    const raw = source.slice(open + 2, close)
    if (raw.length > TAG_LIMIT || raw.includes('{{')) templateError('وسم غير صالح في القالب')
    const tag = raw.trim().replace(/\s+/g, ' ')
    index = close + 2
    if (tag.startsWith('#if ')) {
      const node = {
        type: 'if' as const,
        test: reference(tag.slice(4).trim(), tag),
        then: [],
        else: [],
        source: tag,
      }
      target().push(node)
      stack.push({ node, inElse: false })
    } else if (tag.startsWith('#each ')) {
      if (stack.some((entry) => entry.node.type === 'each'))
        templateError('لا يمكن تداخل {{#each}} داخل {{#each}}')
      const group = reference(tag.slice(6).trim(), tag)
      if (group.kind !== 'lines' || group.column)
        templateError(`{{#each}} يقبل مجموعة بنود فقط مثل lines.items: {{${tag}}}`)
      const node = { type: 'each' as const, group: group.key, body: [], source: tag }
      target().push(node)
      stack.push({ node, inElse: false })
    } else if (tag === 'else') {
      const top = stack.at(-1)
      if (!top || top.node.type !== 'if' || top.inElse) templateError('{{else}} بلا {{#if}}')
      top.inElse = true
    } else if (tag === '/if' || tag === '/each') {
      const top = stack.pop()
      if (!top || `/${top.node.type}` !== tag) templateError(`{{${tag}}} بلا بداية مطابقة`)
    } else if (tag.startsWith('#') || tag.startsWith('/') || tag.startsWith('>')) {
      templateError(`وسم غير مسموح في القالب: {{${tag}}}`)
    } else {
      const helper = HELPER.exec(tag)
      if (helper)
        target().push({
          type: 'output',
          helper: helper[1],
          arg: reference(helper[2].trim(), tag),
          source: tag,
        })
      else target().push({ type: 'output', helper: null, arg: reference(tag, tag), source: tag })
    }
  }
  const open = stack.at(-1)
  if (open) templateError(`{{#${open.node.type}}} بلا {{/${open.node.type}}}`)
  return root
}

/** Visits every tag of a parsed template, with the line group of the enclosing each. */
export function walkTemplate(
  nodes: TemplateNode[],
  visit: (node: Exclude<TemplateNode, { type: 'text' }>, group: string | null) => void,
  group: string | null = null
) {
  for (const node of nodes) {
    if (node.type === 'text') continue
    visit(node, group)
    if (node.type === 'if') {
      walkTemplate(node.then, visit, group)
      walkTemplate(node.else, visit, group)
    } else if (node.type === 'each') walkTemplate(node.body, visit, node.group)
  }
}
