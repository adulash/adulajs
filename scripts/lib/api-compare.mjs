// Compares two public API reports of adula (packages/adula/api/adula-api.json). Removing or
// changing an export is breaking; adding one is not. Shared by check:api and the release guard.
export function compare(previous, current) {
  const breaking = []
  const added = []
  for (const [entry, exports] of Object.entries(previous)) {
    for (const [name, value] of Object.entries(exports)) {
      const next = current[entry]?.[name]
      if (!next) breaking.push(`${entry} ${name}: removed`)
      else if (next.type !== value.type || next.kind !== value.kind) breaking.push(`${entry} ${name}: changed`)
    }
  }
  for (const [entry, exports] of Object.entries(current))
    for (const name of Object.keys(exports)) if (!previous[entry]?.[name]) added.push(`${entry} ${name}`)
  return { breaking, added }
}
