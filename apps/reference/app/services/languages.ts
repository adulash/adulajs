import config from '@adonisjs/core/services/config'
import type { HttpContext } from '@adonisjs/core/http'
import { registry } from '#start/modules'
import {
  BASE_LANGUAGE,
  enabledLanguages,
  labelText,
  languageDirection,
  resolveLanguage,
  type Label,
} from 'adula'

/** The languages config/adula.ts enables; Arabic is always among them. */
export function configuredLanguages(): string[] {
  return config.get<string[]>('adula.languages', [BASE_LANGUAGE])
}

export function availableLanguages() {
  return enabledLanguages(configuredLanguages())
}

/** A user's stored preference when it is still enabled, Arabic otherwise. */
export function languageOf(user: { language?: string | null } | undefined | null): string {
  return resolveLanguage(user?.language, configuredLanguages())
}

/** The language the language middleware chose for this request (Arabic before it ran). */
export function requestLanguage(ctx: Partial<HttpContext>): string {
  return ctx.language ?? BASE_LANGUAGE
}

export function requestDirection(ctx: Partial<HttpContext>) {
  return languageDirection(requestLanguage(ctx))
}

/** `label.<language>` falling back to `label.ar`. */
export function localLabel(label: Label | undefined, language: string): string | null {
  return label ? labelText(label, language) : null
}

declare module '@adonisjs/core/http' {
  interface HttpContext {
    /** The interface language of this request, see LanguageMiddleware. */
    language?: string
  }
}

/**
 * A resource description or editor with its headings in `language`: `label.<lang>`
 * when the resource defines it, the Arabic the service produced otherwise.
 */
export function localizeResource<
  T extends {
    name: string
    label: string
    recordLabel: string | null
    createLabel?: string | null
  },
>(value: T, language: string): T {
  if (language === BASE_LANGUAGE) return value
  const resource = registry.get(value.name)
  return {
    ...value,
    label: localLabel(resource.label, language) ?? value.label,
    recordLabel: localLabel(resource.recordLabel, language) ?? value.recordLabel,
    ...('createLabel' in value
      ? { createLabel: localLabel(resource.createLabel, language) ?? value.createLabel }
      : {}),
  }
}
