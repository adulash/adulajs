import { useCallback, useSyncExternalStore } from 'react'
import { usePage } from '@inertiajs/react'
import axios from 'axios'
import { toast } from 'sonner'
import { useMessages } from '~/components/ui/messages'
import { failure, json } from '~/components/account/request'

/**
 * Per-user interface preferences (ADR 049). The server renders the stored values in the
 * shared `preferences` prop; a change applies at once and is then saved for the user.
 */
export type Preferences = Record<string, unknown>

const NONE = Symbol('none')
// Values changed in this page view, ahead of the next server render.
const overrides = new Map<string, unknown>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current value of a preference outside React (theme script, tests). */
export function preferenceOverride(key: string): unknown {
  return overrides.has(key) ? overrides.get(key) : NONE
}

function address(key: string) {
  return `/account/preferences/${encodeURIComponent(key)}`
}

function impersonating(caught: unknown) {
  return (
    axios.isAxiosError(caught) &&
    (caught.response?.data as { error?: { code?: string } } | undefined)?.error?.code ===
      'E_IMPERSONATING'
  )
}

export function usePreference<T>(
  key: string
): [T, (value: T) => Promise<void>, () => Promise<void>] {
  const server = usePage<{ preferences?: Preferences }>().props.preferences?.[key] as T
  const local = useSyncExternalStore(
    subscribe,
    () => (overrides.has(key) ? overrides.get(key) : NONE),
    () => NONE
  )
  const { t } = useMessages()
  const value = (local === NONE ? server : local) as T

  const save = useCallback(
    async (method: 'put' | 'delete', next?: T) => {
      const previous = overrides.has(key) ? overrides.get(key) : NONE
      if (method === 'put') {
        overrides.set(key, next)
        emit()
      }
      try {
        const response =
          method === 'put'
            ? await axios.put(address(key), { value: next }, json)
            : await axios.delete(address(key), json)
        overrides.set(key, (response.data as { data: { value: unknown } }).data.value)
        emit()
      } catch (caught) {
        // While impersonating, the change stays for this page view and is not saved.
        if (impersonating(caught)) return
        if (previous === NONE) overrides.delete(key)
        else overrides.set(key, previous)
        emit()
        toast.error(failure(caught, t('تعذر حفظ التفضيل.')))
      }
    },
    [key, t]
  )

  return [value, (next: T) => save('put', next), () => save('delete')]
}
