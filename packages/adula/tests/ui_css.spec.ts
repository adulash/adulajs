import { test } from '@japa/runner'
import { ADULA_CSS_IMPORT, ADULA_CSS_LAYERS, ensureAdulaCssEntry } from '../commands/ui_css.js'
import { getMetaData } from '../commands/main.js'

const theme = "@import 'tailwindcss' source(none);\n:root { --radius: 0.5rem; }\n"
const count = (text: string, part: string) => text.split(part).length - 1

test.group('adula:ui CSS entry', () => {
  test('prepends the layer order and the application stylesheet once', ({ assert }) => {
    const once = ensureAdulaCssEntry(theme)
    assert.equal(once, `${ADULA_CSS_LAYERS}\n${ADULA_CSS_IMPORT}\n${theme}`)
    assert.equal(ensureAdulaCssEntry(once), once)
  })

  test('recognizes the entry after a formatter rewrote quotes and spacing', ({ assert }) => {
    for (const entry of [
      "@layer theme, base, legacy, components, utilities;\n@import './app.css';\n",
      '@layer theme,base,legacy,components,utilities ;\n@import   "./app.css" ;\n',
      "@layer theme, base, legacy, components, utilities;\n@import './app.css' layer(legacy);\n",
    ]) {
      const css = entry + theme
      assert.equal(ensureAdulaCssEntry(css), css)
    }
  })

  test('restores a missing layer order or import without duplicating the other', ({ assert }) => {
    const withoutLayers = ensureAdulaCssEntry(`@import './app.css';\n${theme}`)
    assert.isTrue(withoutLayers.startsWith(`${ADULA_CSS_LAYERS}\n@import './app.css';`))
    assert.equal(count(withoutLayers, 'app.css'), 1)

    const withoutImport = ensureAdulaCssEntry(`${ADULA_CSS_LAYERS}\n${theme}`)
    assert.isTrue(withoutImport.startsWith(`${ADULA_CSS_LAYERS}\n${ADULA_CSS_IMPORT}\n`))
    assert.equal(count(withoutImport, '@layer theme'), 1)
  })

  test('does not mistake another stylesheet for the application one', ({ assert }) => {
    const css = `@import './app.css.map';\n@import "../app.css";\n${theme}`
    assert.isTrue(ensureAdulaCssEntry(css).startsWith(`${ADULA_CSS_LAYERS}\n${ADULA_CSS_IMPORT}\n`))
  })
})

test.group('Operational commands', () => {
  test('ship in the package exactly once with their flags', async ({ assert }) => {
    const metadata = await getMetaData()
    const names = metadata.map((command) => command.commandName)
    assert.equal(new Set(names).size, names.length)
    for (const name of [
      'adula:outbox',
      'adula:runtime:health',
      'adula:uploads:prune',
      'adula:restore:reconcile',
      'backup:create',
      'backup:restore-files',
      'backup:restore-test',
      'backup:verify',
      'backup:verify-snapshot',
    ]) {
      const command = metadata.find((entry) => entry.commandName === name)
      assert.exists(command, name)
      assert.isTrue(command!.options.startApp, `${name} starts the application`)
    }
    const flags = (name: string) =>
      metadata
        .find((entry) => entry.commandName === name)!
        .flags.map((flag) => `${flag.flagName}${flag.required ? '!' : ''}`)
    assert.deepEqual(flags('backup:create'), ['snapshot!', 'prefix'])
    assert.deepEqual(flags('backup:restore-test'), ['dir', 'snapshot', 'allow-empty'])
    assert.deepEqual(flags('backup:restore-files'), ['snapshot!', 'apply'])
    assert.deepEqual(flags('adula:runtime:health'), ['service'])
    assert.deepEqual(flags('adula:restore:reconcile'), ['force'])
  })
})
