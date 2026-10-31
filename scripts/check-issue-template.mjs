import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const formsDir = new URL('../.github/ISSUE_TEMPLATE/', import.meta.url)
export const FORMS = ['gap.yml', 'bug.yml']
export const LABEL = 'needs-template'

/** Labels of the required fields of an issue form, read without a YAML dependency. */
export function requiredLabels(form) {
  return form
    .split(/\n  - type: /)
    .slice(1)
    .filter((block) => /\n\s+required: true/.test(block))
    .map((block) => block.match(/\n\s+label: (.+)/)?.[1].trim())
    .filter(Boolean)
}

/** Required labels whose section is absent or empty in a body rendered from an issue form. */
export function missingSections(body, labels) {
  const sections = new Map()
  for (const part of `\n${body ?? ''}`.replace(/\r\n/g, '\n').split(/\n### /).slice(1)) {
    const newline = part.indexOf('\n')
    const heading = (newline < 0 ? part : part.slice(0, newline)).trim()
    const value = newline < 0 ? '' : part.slice(newline + 1).trim()
    sections.set(heading, value)
  }
  return labels.filter((label) => {
    const value = sections.get(label)
    return !value || value === '_No response_'
  })
}

/** The form an issue body satisfies, or the missing sections of the closest form. */
export async function checkIssue(body) {
  let closest
  for (const name of FORMS) {
    const labels = requiredLabels(await readFile(new URL(name, formsDir), 'utf8'))
    const missing = missingSections(body, labels)
    if (!missing.length) return { form: name, missing }
    if (!closest || missing.length < closest.missing.length) closest = { form: name, missing }
  }
  return { form: undefined, missing: closest.missing, closest: closest.form }
}

async function github(path, init = {}) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
  })
  if (!response.ok && !(init.allow ?? []).includes(response.status))
    throw new Error(`${init.method ?? 'GET'} ${path} failed with ${response.status}`)
  return response
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const issue = event.issue
  const labelled = issue.labels.some((label) => label.name === LABEL)
  const result = await checkIssue(issue.body)
  if (!result.form) {
    if (labelled) return
    await github('/labels', {
      method: 'POST',
      body: JSON.stringify({ name: LABEL, color: 'd93f0b' }),
      allow: [422],
    })
    await github(`/issues/${issue.number}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labels: [LABEL] }),
    })
    const body = [
      'This issue does not follow AdulaJS issue forms (`.github/ISSUE_TEMPLATE/gap.yml` or `bug.yml`).',
      `Missing or empty in the closest form (${result.closest}): ${result.missing.join(', ')}.`,
      'Edit the issue to add these sections as `### <label>` headings. Describe AdulaJS, not a project, and reproduce on a new system from create-adulajs. `node ace adula:gaps report` prints a prefilled form link for each GAPS.md entry.',
    ].join('\n\n')
    await github(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
    console.log(`#${issue.number}: missing ${result.missing.join(', ')}`)
  } else if (labelled) {
    await github(`/issues/${issue.number}/labels/${LABEL}`, { method: 'DELETE', allow: [404] })
    console.log(`#${issue.number}: follows ${result.form}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
