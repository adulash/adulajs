import axios from 'axios'

/** JSON requests from the account cards; axios sends the XSRF-TOKEN cookie as a header. */
export const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }

/**
 * The server's Arabic message for a failed request: AdulaError answers with
 * `{ error: { message } }`, validation and throttling with `{ errors: [{ message }] }`.
 */
export function failure(caught: unknown, fallback: string) {
  if (!axios.isAxiosError(caught)) return fallback
  const body = caught.response?.data as
    { error?: { message?: unknown }; errors?: { message?: unknown }[] } | undefined
  const message = body?.error?.message ?? body?.errors?.[0]?.message
  return typeof message === 'string' && message ? message : fallback
}
