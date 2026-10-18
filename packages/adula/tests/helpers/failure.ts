import { AdulaError } from '../../index.js'

/**
 * Awaits work that must reject with an AdulaError and returns that error for status and
 * code assertions. Any other rejection is rethrown; a resolution fails the test.
 */
export async function failure(
  run: Promise<unknown> | (() => Promise<unknown>)
): Promise<AdulaError> {
  try {
    await (typeof run === 'function' ? run() : run)
  } catch (error) {
    if (error instanceof AdulaError) return error
    throw error
  }
  throw new Error('Expected an AdulaError')
}
