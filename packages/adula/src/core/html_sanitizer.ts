/**
 * In-house allowlist sanitizer for administrator-written print markup (ADR 048). It is
 * not a general HTML parser: it keeps a fixed set of structural tags and four attributes
 * and drops everything else, so the output can only lay out escaped text.
 *
 * - Allowed tags: ALLOWED_TAGS. Any other tag is removed; the contents of DROPPED_WITH_CONTENT
 *   (script, style, iframe, svg, form, …) are removed with it.
 * - Allowed attributes: class (word characters and dashes), colspan/rowspan (1–99),
 *   dir (rtl/ltr/auto) and style restricted by sanitizeStyle. Every other attribute,
 *   including on* handlers, href and src, is removed.
 * - An attribute value with `&`, `\`, `{{` or `}}` is removed: entities and CSS escapes
 *   could hide a URL, and template values may not flow into attributes.
 * - Comments, doctype and processing instructions are removed; a stray `<` becomes `&lt;`.
 * - Closing tags are balanced against the open allowed tags; unclosed ones are closed.
 */
export const ALLOWED_TAGS = new Set([
  'div',
  'section',
  'header',
  'footer',
  'p',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'ul',
  'ol',
  'li',
  'small',
])
const VOID = new Set(['br', 'hr'])
const DROPPED_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'svg',
  'math',
  'template',
  'noscript',
  'noembed',
  'noframes',
  'textarea',
  'title',
  'select',
  'form',
  'button',
  'xmp',
  'plaintext',
  'video',
  'audio',
  'canvas',
  'picture',
  'head',
])

/** CSS properties a style attribute may set. Values are checked by CSS_VALUE. */
const CSS_PROPERTIES = new Set([
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-style',
  'text-align',
  'text-decoration',
  'vertical-align',
  'line-height',
  'letter-spacing',
  'white-space',
  'direction',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'border',
  'border-top',
  'border-bottom',
  'border-left',
  'border-right',
  'border-color',
  'border-style',
  'border-width',
  'border-collapse',
  'border-radius',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-inline-start',
  'margin-inline-end',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-inline-start',
  'padding-inline-end',
  'page-break-before',
  'page-break-after',
  'page-break-inside',
  'break-before',
  'break-after',
  'break-inside',
])
/** Plain lengths, keywords, hex colours and rgb()/hsl() colours; no other function. */
const CSS_VALUE = /^[#%.,\w\s-]*$/
const CSS_COLOR_FUNCTION = /\b(?:rgba?|hsla?)\(\s*[\d.%,\s]+\)/gi
const CSS_FORBIDDEN = /url|expression|import|javascript|behavio|binding|image|attr|var|@|\/\/|:/i

/** Longest style attribute kept; longer ones are dropped whole. */
const STYLE_LIMIT = 500

/** A style attribute reduced to allowlisted properties with plain values; '' when none survive. */
export function sanitizeStyle(style: string): string {
  if (style.length > STYLE_LIMIT) return ''
  if (/[\\&<>"'`{}]|\/\*/.test(style)) return ''
  const declarations: string[] = []
  for (const part of style.split(';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const property = part.slice(0, colon).trim().toLowerCase()
    const value = part
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, ' ')
    if (!CSS_PROPERTIES.has(property) || !value || value.length > 200) continue
    if (CSS_FORBIDDEN.test(value)) continue
    if (!CSS_VALUE.test(value.replace(CSS_COLOR_FUNCTION, 'color'))) continue
    declarations.push(`${property}: ${value}`)
  }
  return declarations.join('; ')
}

function attributeValue(name: string, value: string): string | null {
  if (/[&\\]|\{\{|\}\}/.test(value)) return null
  switch (name) {
    case 'class':
      return /^[\w\s-]{0,200}$/.test(value) ? value.trim().replace(/\s+/g, ' ') : null
    case 'colspan':
    case 'rowspan':
      return /^[1-9]\d?$/.test(value.trim()) ? value.trim() : null
    case 'dir':
      return ['rtl', 'ltr', 'auto'].includes(value.trim().toLowerCase())
        ? value.trim().toLowerCase()
        : null
    case 'style': {
      const style = sanitizeStyle(value)
      return style || null
    }
    default:
      return null
  }
}

const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

function attributes(source: string) {
  const kept: string[] = []
  const seen = new Set<string>()
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase()
    if (seen.has(name)) continue
    seen.add(name)
    const value = attributeValue(name, match[2] ?? match[3] ?? match[4] ?? '')
    if (value !== null) kept.push(` ${name}="${value.replaceAll('"', '&quot;')}"`)
  }
  return kept.join('')
}

/** Text between tags: kept as written, except that a `>` is escaped. */
const text = (value: string) => value.replaceAll('>', '&gt;')

/**
 * A tag from `<` to its `>`. Attribute text cannot contain `<` or `>`, so a scan never runs
 * past the next angle bracket and the sanitizer stays linear in the input length.
 */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"<>]*"|'[^'<>]*')*)>/y
/** Deeper nesting is flattened: tags beyond it are dropped, their text kept. */
const MAX_DEPTH = 100

/** Sanitizes administrator print markup; see the module comment for the rules. */
export function sanitizePrintHtml(input: string): string {
  let output = ''
  const open: string[] = []
  let index = 0
  while (index < input.length) {
    const lt = input.indexOf('<', index)
    if (lt === -1) {
      output += text(input.slice(index))
      break
    }
    output += text(input.slice(index, lt))
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4)
      index = end === -1 ? input.length : end + 3
      continue
    }
    if (input[lt + 1] === '!' || input[lt + 1] === '?') {
      const end = input.indexOf('>', lt)
      index = end === -1 ? input.length : end + 1
      continue
    }
    TAG.lastIndex = lt
    const tag = TAG.exec(input)
    if (!tag) {
      output += '&lt;'
      index = lt + 1
      continue
    }
    index = lt + tag[0].length
    const closing = tag[1] === '/'
    const name = tag[2].toLowerCase()
    if (!closing && DROPPED_WITH_CONTENT.has(name)) {
      // Skip to the matching close tag (or the end): its contents never reach the page.
      const close = new RegExp(`</${name}\\s*>`, 'gi')
      close.lastIndex = index
      const end = close.exec(input)
      index = end ? end.index + end[0].length : input.length
      continue
    }
    if (!ALLOWED_TAGS.has(name)) continue
    if (closing) {
      const position = open.lastIndexOf(name)
      if (position === -1) continue
      while (open.length > position) output += `</${open.pop()}>`
      continue
    }
    if (!VOID.has(name) && open.length >= MAX_DEPTH) continue
    output += `<${name}${attributes(tag[3])}>`
    if (!VOID.has(name)) open.push(name)
  }
  while (open.length) output += `</${open.pop()}>`
  return output
}
