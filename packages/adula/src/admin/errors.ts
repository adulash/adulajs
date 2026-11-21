import { currentLanguage, localizeText, messageKeyOf, translate } from '../languages/catalog.js'

/**
 * A refusal the caller can act on. The message is Arabic text from the catalog
 * (src/languages/ar.ts); inside a request running in another language (see
 * runWithLanguage) it is translated when that language translates the text, so a
 * response, flash or MCP answer built from `message` is already localized.
 */
export class AdulaError extends Error {
  /** The catalog key of the Arabic message, when the catalog defines it. */
  readonly messageKey?: string

  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(localizeText(message))
    this.messageKey = messageKeyOf(message)
  }
}

/**
 * A PostgreSQL constraint failure as the catalog error a client can act on, or undefined
 * for any other error: 23505 is 409 E_DUPLICATE, 23502 is 422 E_NOT_NULL, a foreign key
 * that rows of another table still reference (a hard delete, or a trigger refusing an
 * orphaning delete with that detail) is 409 E_HAS_DEPENDENTS naming that table, and any
 * other 23503 is 422 E_RELATION (#139). `label` names a table, usually its resource label.
 */
export function databaseError(
  error: unknown,
  label: (table: string) => string = (table) => table
): AdulaError | undefined {
  const failure = error as { code?: string; detail?: string }
  if (failure?.code === '23505')
    return new AdulaError(409, 'E_DUPLICATE', translate('errors.E_DUPLICATE', currentLanguage()))
  // A NOT NULL column the definition lets be empty (see adula:resource:migration).
  if (failure?.code === '23502')
    return new AdulaError(422, 'E_NOT_NULL', translate('errors.E_NOT_NULL', currentLanguage()))
  if (failure?.code !== '23503') return undefined
  const referencing = /is still referenced from table "([^"]+)"/.exec(failure.detail ?? '')?.[1]
  return referencing
    ? new AdulaError(
        409,
        'E_HAS_DEPENDENTS',
        translate('errors.E_HAS_DEPENDENTS', currentLanguage(), { dependents: label(referencing) })
      )
    : new AdulaError(422, 'E_RELATION', translate('errors.E_RELATION', currentLanguage()))
}

/*
 * Named constructors for errors that recur across the resource service. Each keeps the
 * exact status, code and message of the sites it replaced; clients and tests rely on them.
 */

/** 403 E_FORBIDDEN: the actor may not perform the action. */
export function forbiddenAction() {
  return new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء')
}

/** 404 E_NOT_FOUND: a record (by default) or another target outside the actor's reach. */
export function notFound(message = 'السجل غير موجود') {
  return new AdulaError(404, 'E_NOT_FOUND', message)
}

/** 403 E_FIELD_FORBIDDEN: a field the actor may not read, query or write. */
export function forbiddenField(message: string) {
  return new AdulaError(403, 'E_FIELD_FORBIDDEN', message)
}

/** 422 E_FILTER: an unsupported or invalid filter. */
export function invalidFilter(message: string) {
  return new AdulaError(422, 'E_FILTER', message)
}

/** 403 E_SEARCH: full-text search is not available to the actor. */
export function searchUnavailable() {
  return new AdulaError(403, 'E_SEARCH', 'Search is unavailable')
}

/** 422 E_CURSOR: a malformed or mismatched pagination cursor. */
export function invalidCursor() {
  return new AdulaError(422, 'E_CURSOR', 'Invalid cursor')
}

/** 409 E_DOCUMENT_LOCKED: a submitted or cancelled document cannot change this way. */
export function documentLocked(message = 'Only draft documents can be edited') {
  return new AdulaError(409, 'E_DOCUMENT_LOCKED', message)
}

/** 409 E_DOCUMENT_STATE: the document is not in a state that allows the transition. */
export function invalidDocumentState(message: string) {
  return new AdulaError(409, 'E_DOCUMENT_STATE', message)
}

/** 422 E_REQUIRED: a required field has no value. */
export function requiredField(key: string) {
  return new AdulaError(422, 'E_REQUIRED', `Required field: ${key}`)
}

/** 422 E_ACTOR: a system write without the author it needs. */
export function missingActor(message: string) {
  return new AdulaError(422, 'E_ACTOR', message)
}

/** 422 E_INLINE: malformed inline rows. */
export function invalidInline(message: string) {
  return new AdulaError(422, 'E_INLINE', message)
}

/** 422 E_INLINE_SCOPE: inline rows and their parent must share one organization unit. */
export function inlineScope(message: string) {
  return new AdulaError(422, 'E_INLINE_SCOPE', message)
}
