/**
 * The CSS entry `adula:ui` keeps in `inertia/css/adula.css`: the layer order first, then the
 * legacy application stylesheet. Formatters may rewrite quotes and spacing (prettier writes
 * `@import './app.css';`), so detection is quote- and whitespace-agnostic and re-running the
 * command never prepends the lines again.
 */
export const ADULA_CSS_LAYERS = '@layer theme, base, legacy, components, utilities;'
export const ADULA_CSS_IMPORT = '@import "./app.css";'

const LAYERS = /@layer\s+theme\s*,\s*base\s*,\s*legacy\s*,\s*components\s*,\s*utilities\s*;/
const IMPORT = /@import\s+(["'])\.\/app\.css\1[^;]*;/

export function ensureAdulaCssEntry(css: string) {
  const layers = css.match(LAYERS)
  if (IMPORT.test(css)) return layers ? css : `${ADULA_CSS_LAYERS}\n${css}`
  // A missing import goes right after the layer order, which must stay the first statement.
  if (layers) return css.replace(LAYERS, (statement) => `${statement}\n${ADULA_CSS_IMPORT}`)
  return `${ADULA_CSS_LAYERS}\n${ADULA_CSS_IMPORT}\n${css}`
}
