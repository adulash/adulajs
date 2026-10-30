// Every relative link in docs/ (the Arabic set in docs/ar/ included) must point to an
// existing file, and every #anchor to a heading of the target page.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const docs = join(root, 'docs')

function markdownFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return markdownFiles(path)
    return name.endsWith('.md') ? [path] : []
  })
}

/** The text outside fenced code blocks and inline code spans. */
function prose(text) {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '')
}

/** GitHub heading anchors: lower case, punctuation removed, spaces as hyphens, -n for repeats. */
export function anchors(text) {
  const seen = new Map()
  const result = new Set()
  for (const line of text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').split('\n')) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    const html = line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)
    for (const match of html) result.add(match[1])
    if (!heading) continue
    const slug = heading[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
      .replace(/ /g, '-')
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    result.add(count ? `${slug}-${count}` : slug)
  }
  return result
}

function links(text) {
  return [...prose(text).matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((match) => match[1])
}

test('GitHub anchors follow its slug rules, Arabic headings included', () => {
  assert.deepEqual(
    [...anchors('# Field `types`\n## Step 1: run it\n## Step 1: run it\n## إنشاء النظام (System)\n')],
    ['field-types', 'step-1-run-it', 'step-1-run-it-1', 'إنشاء-النظام-system']
  )
})

test('internal links in docs/ and docs/ar/ resolve', () => {
  const files = markdownFiles(docs)
  assert(files.some((file) => file.includes(join('docs', 'ar'))), 'docs/ar/ is missing')
  const broken = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const link of links(text)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue
      const [path, anchor] = link.split('#')
      const target = path ? resolve(dirname(file), decodeURIComponent(path.split('?')[0])) : file
      const where = `${relative(root, file)}: ${link}`
      if (!existsSync(target)) {
        broken.push(`${where} (no such file)`)
        continue
      }
      if (anchor && target.endsWith('.md') && !anchors(readFileSync(target, 'utf8')).has(decodeURIComponent(anchor)))
        broken.push(`${where} (no such heading)`)
    }
  }
  assert.deepEqual(broken, [])
})
