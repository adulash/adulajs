/**
 * Escapes LIKE/ILIKE metacharacters (backslash, percent, underscore) so user input
 * matches literally. PostgreSQL's default LIKE escape character is the backslash.
 */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')
