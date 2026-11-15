import { createInterface } from 'node:readline'

/** The questions the creator may ask, in order. Identity is not one of them (issue #151). */
export const prompts = {
  directory: 'System directory: ',
  company: 'Company name as it should appear in the system: ',
  email: 'Administrator email: ',
}

/**
 * Answers questions from a non-terminal input, one line each. Lines that arrive before a
 * question is asked are queued, so piped answers are never lost; when the input ends while
 * a question waits, the question fails with a clear message instead of hanging.
 */
export function pipedQuestions(input, output) {
  const reader = createInterface({ input, terminal: false })
  const lines = []
  const waiting = []
  let ended = false
  reader.on('line', (line) => {
    const next = waiting.shift()
    if (!next) return lines.push(line)
    // Echo the answer so a log reads like the terminal session it replaces.
    output.write(line + '\n')
    next.resolve(line)
  })
  reader.on('close', () => {
    ended = true
    for (const next of waiting.splice(0))
      next.reject(new Error(`Input ended before this question was answered: ${next.message.trim()}`))
  })
  return {
    question(message) {
      output.write(message)
      if (lines.length) {
        const line = lines.shift()
        output.write(`${line}\n`)
        return Promise.resolve(line)
      }
      if (ended)
        return Promise.reject(
          new Error(`Input ended before this question was answered: ${message.trim()}`)
        )
      return new Promise((resolve, reject) => waiting.push({ message, resolve, reject }))
    },
    pause: () => reader.pause(),
    resume: () => reader.resume(),
    close: () => reader.close(),
  }
}

/**
 * Asks for the company name and administrator email that the options did not supply.
 * @param {(message: string) => Promise<string>} question
 * @param {{ company?: string, email?: string }} [supplied]
 */
export async function askDetails(question, supplied = {}) {
  let { company, email } = supplied
  company ||= await question(prompts.company)
  email ||= await question(prompts.email)
  return { company, email }
}
