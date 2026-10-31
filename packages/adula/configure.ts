/*
|--------------------------------------------------------------------------
| Configure hook
|--------------------------------------------------------------------------
|
| The configure hook is called when someone runs "node ace configure <package>"
| command. You are free to perform any operations inside this function to
| configure the package.
|
| To make things easier, you have access to the underlying "Configure"
| instance and you can use codemods to modify the source files.
|
*/

import type Configure from '@adonisjs/core/commands/configure'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { stubsRoot } from './stubs/main.js'

export async function configure(command: Configure) {
  const pkgPath = command.app.makePath('package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  for (const dependency of ['@adonisjs/lucid', '@adonisjs/auth', '@adonisjs/session', '@adonisjs/shield', 'pg']) {
    if (!pkg.dependencies?.[dependency]) throw new Error(`Install and configure ${dependency} before adula`)
  }
  const aliases = { '#modules/*': './app/modules/*.js', '#tests/*': './tests/*.js' }
  for (const [key, target] of Object.entries(aliases)) {
    if (pkg.imports?.[key] && pkg.imports[key] !== target) throw new Error(`Conflicting package import ${key}`)
  }
  const dbPath = command.app.configPath('database.ts')
  const databaseSource = await readFile(dbPath, 'utf8')
  if (!/client:\s*['"]pg['"]/.test(databaseSource.replace(/\/\/[^\n]*/g, '')))
    throw new Error('Configure PostgreSQL with node ace configure @adonisjs/lucid --db=postgres before adula')
  const codemods = await command.createCodemods()
  const project = await codemods.getTsMorphProject()
  if (!project) throw new Error('The host must have @adonisjs/assembler installed to configure AdulaJS')
  const dbFile = project.addSourceFileAtPathIfExists(dbPath)!
  const dbExport = dbFile.getExportAssignments()[0]
  if (!dbExport) throw new Error('config/database.ts must have a default export')
  if (!dbExport.getExpression().getText().startsWith('withAdulaDatabase(')) {
    const adulaImport = dbFile.getImportDeclaration('adula')
    if (adulaImport) adulaImport.addNamedImport('withAdulaDatabase')
    else dbFile.addImportDeclaration({ moduleSpecifier: 'adula', namedImports: ['withAdulaDatabase'] })
    const urlImport = dbFile.getImportDeclaration('node:url')
    if (!urlImport?.getNamedImports().some((entry) => entry.getName() === 'fileURLToPath')) {
      if (urlImport) urlImport.addNamedImport('fileURLToPath')
      else dbFile.addImportDeclaration({ moduleSpecifier: 'node:url', namedImports: ['fileURLToPath'] })
    }
    dbExport.setExpression(`withAdulaDatabase(${dbExport.getExpression().getText()}, fileURLToPath(new URL('../', import.meta.url)))`)
    await dbFile.save()
  }
  pkg.imports = { ...pkg.imports, ...aliases }
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  codemods.overwriteExisting = false
  for (const stub of ['modules', 'service', 'controller', 'routes', 'resource_contract'])
    await codemods.makeUsingStub(stubsRoot, `${stub}.stub`, {}, stub === 'resource_contract'
      ? { contentsFromFile: fileURLToPath(new URL('./stubs/resource_contract.txt', import.meta.url)) } : undefined)
  await codemods.updateRcFile((rc) => {
    rc.addProvider('adula/provider').addCommand('adula/commands').addPreloadFile('#start/adula_routes')
  })
  if (!pkg.devDependencies?.['@japa/api-client'] && !pkg.dependencies?.['@japa/api-client']) {
    const installed = await codemods.installPackages([{ name: '@japa/api-client@3.2.1', isDevDependency: true }])
    if (!installed) throw new Error('Install @japa/api-client@3.2.1, then rerun configure')
  }
  for (const [name, path, args] of [
    ['apiClient', '@japa/api-client', ''],
    ['sessionApiClient', '@adonisjs/session/plugins/api_client', 'app'],
    ['authApiClient', '@adonisjs/auth/plugins/api_client', 'app'],
    ['shieldApiClient', '@adonisjs/shield/plugins/api_client', ''],
  ]) await codemods.registerJapaPlugin(`${name}(${args})`, [{ module: path!, isNamed: true, identifier: name! }])
  command.logger.success('AdulaJS configured. Run migration:run, then ADULA_ADMIN_EMAIL=<email> node ace adula:install (it creates the first administrator when that user does not exist).')
}
