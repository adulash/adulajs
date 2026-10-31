import { usePage } from '@inertiajs/react'
import { useMemo } from 'react'
import {
  createTranslator,
  localizedLabel,
  type InterfaceDirection,
  type InterfaceLanguage,
  type LocalizedLabel,
} from '~/components/ui/message_format'

export {
  arabicText,
  createTranslator,
  interpolate,
  localizedLabel,
  type InterfaceDirection,
  type InterfaceLanguage,
  type LocalizedLabel,
  type MessageParams,
  type Translate,
} from '~/components/ui/message_format'

type MessageProps = {
  locale?: string
  dir?: InterfaceDirection
  languages?: InterfaceLanguage[]
  messages?: Record<string, string>
}

const none: Record<string, string> = {}
const arabicOnly: InterfaceLanguage[] = [{ code: 'ar', name: 'العربية', dir: 'rtl' }]

/**
 * Interface text for the current user: `t('نص عربي', params)` and `label(field.label)`.
 * A consumer that does not share `locale`, `dir` and `messages` keeps rendering Arabic.
 */
export function useMessages() {
  const props = usePage<MessageProps>().props
  const locale = props.locale ?? 'ar'
  const dir = props.dir ?? 'rtl'
  const messages = props.messages ?? none
  return useMemo(
    () => ({
      locale,
      dir,
      t: createTranslator(messages),
      label: (value: LocalizedLabel) => localizedLabel(value, locale),
    }),
    [locale, dir, messages]
  )
}

/** The enabled interface languages, Arabic first; one entry when only Arabic is enabled. */
export function useLanguages(): InterfaceLanguage[] {
  return usePage<MessageProps>().props.languages ?? arabicOnly
}
