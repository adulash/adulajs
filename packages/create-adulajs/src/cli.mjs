#!/usr/bin/env node
import { Progress } from './progress.mjs'
import { prepareDocker } from './prerequisites.mjs'
import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { randomBytes } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { resolve, join, delimiter } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertEmpty,
  projectName,
  renderProject,
  writeNew,
  dotenv,
  prepareEnvironment,
  exampleEnvironment,
  composeFile,
  readIdentity,
  readJson,
  LOCAL_PACKAGES,
  packageArchive,
} from './project.mjs'
import { lockedManager, upgradeApplication } from './upgrade.mjs'
import {
  run,
  argumentBatches,
  npmEntry,
  packageManager,
  packageManagerBin,
  freePort,
  pingRedis,
  createDatabases,
  databaseNames,
  childEnvironment,
} from './system.mjs'

export const help = `Create a new business system with AdonisJS and AdulaJS

  npm create adulajs my-system
  npx create-adulajs@latest my-system

  --company "Company name"     Company display name (Arabic supported)
  --admin-email email          Administrator email
  --identity brand.json        Company logo, primaryColor, fontFamily and guidelines
  --services docker|existing   Default: Docker; requires Docker Compose
  --connection local.json      PostgreSQL and Redis profile for existing services
  --database name              Fresh database name; existing databases are rejected
  --packages directory         Local core and UI archives for pre-publication testing
  --yes                       Noninteractive; requires company and administrator email
  --help                      Show help

Requires Node.js 24+ and npm. Installs pnpm, AdonisJS, adula, the Arabic UI,
databases, administrator and agent skills. External SMTP, OAuth and S3 require
your configuration. Credentials are saved privately in tmp/dev-admin.txt.
Set NO_COLOR=1 for plain progress output.

Upgrade a 1.x system in place to AdulaJS 2:

  npx create-adulajs@latest upgrade [directory]

  --force                     Rewrite even when git reports uncommitted changes
  --no-install                Rewrite files only; install dependencies yourself
  --packages directory        Local core and UI archives instead of the registry
`

function validateConnection(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile))
    throw new Error('The connection file must contain a JSON object.')
  for (const key of ['postgres', 'redis']) {
    const value = profile[key]
    if (
      !value ||
      typeof value.host !== 'string' ||
      !value.host ||
      /[\r\n\0]/.test(value.host) ||
      !Number.isInteger(value.port) ||
      value.port < 1 ||
      value.port > 65535
    )
      throw new Error(`Invalid ${key} connection: provide host and port.`)
    if (value.password !== undefined && typeof value.password !== 'string')
      throw new Error(`Invalid ${key} password.`)
  }
  if (
    typeof profile.postgres.user !== 'string' ||
    !profile.postgres.user ||
    typeof profile.postgres.password !== 'string'
  )
    throw new Error('Provide PostgreSQL user and password. The account needs CREATEDB permission.')
  if (profile.postgres.database || profile.postgres.testDatabase)
    throw new Error(
      'Do not specify an existing database. Setup creates two fresh databases; maintenanceDatabase is only for the administrative connection.'
    )
  return profile
}

async function upgrade(positionals, values) {
  if (positionals.length > 1) throw new Error('Specify one system directory.')
  const root = resolve(positionals[0] ?? '.')
  const template = JSON.parse(await readFile(new URL('./template.json', import.meta.url), 'utf8'))
  const changed = await upgradeApplication(root, {
    version: template.version,
    packages: values.packages,
    force: values.force,
  })
  if (!changed.length) {
    console.log('Already on adula; nothing to rewrite. Run node ace adula:upgrade if it has not run yet.')
    return
  }
  for (const path of changed) console.log(`updated ${path}`)
  if (!values['no-install']) {
    // Keep the application's own package manager; the bundled pnpm serves pnpm projects.
    const locked = await lockedManager(root)
    if (locked === 'yarn') console.log('\nRun yarn install, then continue with the steps below.')
    else {
      const manager =
        locked === 'npm' ? [process.execPath, await npmEntry()] : await packageManager()
      // The manifest just changed on purpose; pnpm freezes the lockfile in CI by default.
      const install = locked === 'npm' ? ['install'] : ['install', '--no-frozen-lockfile']
      await run(manager[0], [...manager.slice(1), ...install], { cwd: root })
    }
  }
  console.log(
    `\nNext, after a database backup:\n  node ace adula:upgrade\n  ADULA_ADMIN_EMAIL=<email> node ace adula:install\n  node ace adula:doctor`
  )
}

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv.filter((arg) => arg !== '--'),
    allowPositionals: true,
    options: {
      'help': { type: 'boolean' },
      'yes': { type: 'boolean' },
      'company': { type: 'string' },
      'admin-email': { type: 'string' },
      'identity': { type: 'string' },
      'services': { type: 'string', default: 'docker' },
      'connection': { type: 'string' },
      'database': { type: 'string' },
      'packages': { type: 'string' },
      'force': { type: 'boolean' },
      'no-install': { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(help)
    return
  }
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Creating a system requires Node.js 24 or later.')
  if (positionals[0] === 'upgrade') return upgrade(positionals.slice(1), values)
  if (values.force || values['no-install'])
    throw new Error('--force and --no-install apply to upgrade only.')
  if (positionals.length > 1) throw new Error('Specify one project directory.')
  if (values.database !== undefined && !/^[a-z][a-z0-9_]{0,49}$/.test(values.database))
    throw new Error(
      'Database name must start with a lowercase letter and use lowercase letters, digits or underscores (up to 50 characters).'
    )
  if (!['docker', 'existing'].includes(values.services))
    throw new Error('--services must be docker or existing.')
  if (values.services === 'existing' && !values.connection)
    throw new Error('Provide --connection when using existing services.')
  if (values.services === 'docker' && values.connection)
    throw new Error('--connection is only available for existing services.')
  let directory = positionals[0]
  let company = values.company
  let email = values['admin-email']
  let identityFile = values.identity
  const interactive = process.stdin.isTTY && !values.yes
  // Reject a supplied destination before collecting company details.
  if (directory) {
    projectName(resolve(directory))
    await assertEmpty(resolve(directory))
  }
  if (!interactive && (!directory || !company || !email))
    throw new Error('Provide a directory, --company and --admin-email, or run interactively.')
  // Host prerequisites must pass before prompts, package setup or project writes.
  let docker
  if (interactive) {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    try {
      directory ||= await prompt.question('System directory: ')
      projectName(resolve(directory))
      await assertEmpty(resolve(directory))
      if (values.services === 'docker') {
        const services = await prepareDocker({
          question: (message) => prompt.question(message),
          execute: async (command, args) => {
            prompt.pause()
            try {
              await run(command, args)
            } finally {
              prompt.resume()
            }
          },
        })
        if (services.connection) {
          values.services = 'existing'
          values.connection = services.connection
        } else {
          docker = services.docker
          console.log(`Docker is ready (${docker.display}). Continuing setup.`)
        }
      }
      company ||= await prompt.question('Company name as it should appear in the system: ')
      email ||= await prompt.question('Administrator email: ')
      identityFile ||= await prompt.question(
        'Company identity JSON (logo, colors, fonts, guidelines; Enter to record as pending): '
      )
    } finally {
      prompt.close()
    }
  } else if (values.services === 'docker') {
    docker = (await prepareDocker()).docker
  }
  if (!directory || !company || !email)
    throw new Error('Provide a directory, --company and --admin-email, or run interactively.')
  if (!/^[^\s@'\0]+@[^\s@'\0]+\.[^\s@'\0]+$/.test(email) || email.length > 254)
    throw new Error('Invalid administrator email.')
  const target = resolve(directory)
  const name = projectName(target)
  await assertEmpty(target)
  const identity = await readIdentity(identityFile || undefined, company)
  const template = JSON.parse(await readFile(new URL('./template.json', import.meta.url), 'utf8'))
  const manager = await packageManager()
  const suffix = randomBytes(6).toString('hex')
  const names = values.database
    ? { database: values.database, testDatabase: `${values.database}_test` }
    : databaseNames(name, suffix)
  const ports = new Set()
  const allocatePort = async () => {
    let port = await freePort()
    while (ports.has(port)) port = await freePort()
    ports.add(port)
    return port
  }
  const env = childEnvironment()
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = [
    await packageManagerBin(),
    join(target, 'node_modules/.bin'),
    env[pathKey] ?? '',
  ].join(delimiter)
  let profile
  const progress = new Progress()
  const releaseDocker =
    docker?.command === 'wsl.exe'
      ? await (await import('./docker-session.mjs')).holdDockerSession(docker)
      : () => {}
  try {
    progress.start('Check services and prepare configuration')
    if (values.services === 'docker') {
      profile = {
        postgres: {
          host: '127.0.0.1',
          port: await allocatePort(),
          user: 'adula',
          password: randomBytes(24).toString('hex'),
        },
        redis: { host: '127.0.0.1', port: await allocatePort() },
      }
    } else {
      profile = validateConnection(await readJson(resolve(values.connection), 'connection'))
      await pingRedis(profile.redis)
    }
    const port = await allocatePort()
    const testPort = await allocatePort()
    const appEnv = {
      TZ: 'UTC',
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: port,
      LOG_LEVEL: 'info',
      APP_KEY: randomBytes(32).toString('base64url'),
      APP_URL: `http://127.0.0.1:${port}`,
      ADULA_NAMESPACE: `${name}-${suffix}`,
      COMPOSE_PROJECT_NAME: `${name}-${suffix}`,
      SESSION_DRIVER: 'database',
      DB_HOST: profile.postgres.host,
      DB_PORT: profile.postgres.port,
      DB_USER: profile.postgres.user,
      DB_PASSWORD: profile.postgres.password,
      DB_DATABASE: names.database,
      REDIS_HOST: profile.redis.host,
      REDIS_PORT: profile.redis.port,
      ...(profile.redis.password ? { REDIS_PASSWORD: profile.redis.password } : {}),
      DRIVE_DISK: 'local',
      LIMITER_STORE: 'redis',
      MAIL_MAILER: 'smtp',
      MAIL_FROM_NAME: identity.company,
      MAIL_FROM_ADDRESS: email,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: 1025,
    }
    // Validate all local archives before the first write.
    if (values.packages)
      for (const name of LOCAL_PACKAGES)
        await readFile(resolve(values.packages, packageArchive(name, template.version)))
    progress.start('Create AdonisJS system and company identity')
    await renderProject(target, template, {
      name,
      identity,
      packageFiles: values.packages,
    })
    if (docker) {
      for (const file of [
        'docker-runtime.mjs',
        'services.mjs',
        ...(docker.command === 'wsl.exe' ? ['docker-session.mjs'] : []),
      ])
        await writeNew(
          target,
          `scripts/${file}`,
          await readFile(new URL(`./${file}`, import.meta.url), 'utf8')
        )
      await writeNew(
        target,
        'scripts/docker-backend.json',
        JSON.stringify({ backend: docker.command === 'docker' ? 'direct' : 'wsl' }, null, 2) + '\n'
      )
      const manifestPath = join(target, 'package.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      manifest.scripts['dev:app'] = manifest.scripts.dev
      manifest.scripts['test:app'] = manifest.scripts.test
      manifest.scripts.dev = 'node scripts/services.mjs dev'
      manifest.scripts.test = 'node scripts/services.mjs test'
      manifest.scripts.ace = 'node scripts/services.mjs ace'
      manifest.scripts.services = 'node scripts/services.mjs up'
      manifest.scripts['services:stop'] = 'node scripts/services.mjs stop'
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    }
    const encodedEnv = await prepareEnvironment(target, appEnv)
    await writeNew(target, '.env', dotenv(encodedEnv), true)
    await writeNew(
      target,
      '.env.test',
      dotenv({
        ...encodedEnv,
        NODE_ENV: 'test',
        PORT: testPort,
        APP_URL: `http://127.0.0.1:${testPort}`,
        APP_KEY: randomBytes(32).toString('base64url'),
        DB_DATABASE: names.testDatabase,
      }),
      true
    )
    await writeNew(
      target,
      '.env.example',
      dotenv(exampleEnvironment(encodedEnv, name))
    )
    const password = randomBytes(24).toString('base64url')
    await writeNew(
      target,
      'tmp/dev-admin.txt',
      `Local development administrator\nEmail: ${email}\nPassword: ${password}\n`,
      true
    )
    await writeNew(
      target,
      'README.md',
      `# ${name}\n\nCreated with create-adulajs ${template.version}. Node.js 24+ is required.\n\n## Local development\n\n\`\`\`sh\nnpm run dev\n\`\`\`\n\nOpen ${appEnv.APP_URL}. Administrator credentials are in ignored tmp/dev-admin.txt. After signing in, open /admin/setup and follow docs/initial-setup.md to review identity and verify service readiness.\nnpm run dev also runs the event worker (node ace adula:worker), which publishes the outbox to listeners and restarts when application code changes. In production run the worker and exactly one scheduler (node ace scheduler:run) as separate processes; node ace adula:outbox publishes one batch by hand. adula:doctor warns when outbox events wait longer than a minute.\n\n${values.services === 'docker' ? `PostgreSQL 17 and Redis 7 run in Docker. Start them with ${docker.display} compose up -d --wait; stop with ${docker.display} compose stop. The selected backend is saved in scripts/docker-backend.json. npm run dev, npm test and npm run ace -- migration:run start services through that same backend. npm run services attaches to services; npm run services:stop stops them. Only the WSL fallback keeps a WSL session open. Named volumes retain data; never use down -v unless deliberately deleting the local databases.` : 'PostgreSQL 17 and Redis use your existing services. Installation created fresh databases; keep .env and .env.test private.'}\n\n## Verification\n\nRun npm run typecheck, npm test, npm run lint and npm run build. Tests use the separate *_test database and a distinct Redis namespace.\n\n## Company identity\n\nRead docs/design-identity.md and the managed design skill before changing UI. Source files and shadcn components belong to this system.\n\n## External services and production\n\nLocal file storage is enabled. SMTP (including a local relay), OAuth provider credentials, S3, off-site backups, and production deployment need actual destination configuration. The creator does not enable unconfigured external services. Production requires backup variables validated in start/env.ts.\n\n## Incomplete installation\n\nReview the reported failing step; files and databases are retained. After resolving it, use npm exec --yes --package=pnpm@11.19.0 -- pnpm install, node ace migration:run, and node ace adula:setup. Setup reads tmp/dev-admin.txt; it refuses to promote an existing account with a different password. Then run node ace adula:doctor and npm run build. Never recreate over a nonempty directory.\n`
    )
    await writeNew(target, 'tmp/install.log', '', true)
    const options = {
      cwd: target,
      env,
      logFile: join(target, 'tmp/install.log'),
    }
    progress.start('Install AdonisJS, adula and UI dependencies')
    await run(manager[0], [...manager.slice(1), 'install', '--prod=false'], options)
    progress.start('Start services and create fresh databases')
    if (values.services === 'docker') {
      await writeNew(target, 'compose.yaml', composeFile())
      await run(
        docker.command,
        [
          ...docker.prefix,
          'compose',
          '--env-file',
          '.env',
          'up',
          '-d',
          '--wait',
          '--wait-timeout',
          '120',
        ],
        options
      )
      await pingRedis(profile.redis)
    }
    await createDatabases(profile.postgres, names)
    progress.start('Apply migrations and configure administrator, UI and skills')
    await run(process.execPath, ['ace', 'codegen'], options)
    await run(process.execPath, ['ace', 'migration:run', '--force'], options)
    await run(process.execPath, ['ace', 'adula:setup'], options)
    const sourceFiles = [
      ...Object.keys(template.files).filter((path) => /\.(?:ts|tsx|js|json|css)$/.test(path)),
      'inertia/brand.ts',
      'inertia/css/brand.css',
    ]
    for (const batch of argumentBatches(sourceFiles)) {
      await run(manager[0], [...manager.slice(1), 'exec', 'prettier', '--write', ...batch], options)
    }
    await run(process.execPath, ['ace', 'adula:doctor'], options)
    progress.start('Typecheck and build the system')
    await run(manager[0], [...manager.slice(1), 'run', 'typecheck'], options)
    await run(manager[0], [...manager.slice(1), 'run', 'build'], options)
    await writeNew(
      target,
      'adula-setup.json',
      JSON.stringify(
        {
          version: template.version,
          completed: true,
          services: values.services,
          database: names.database,
          testDatabase: names.testDatabase,
        },
        null,
        2
      ) + '\n'
    )
    progress.finish()
    console.log(
      `\nYour system is ready: ${target}\nAdministrator credentials: tmp/dev-admin.txt\nInstallation log: tmp/install.log\nNext: cd "${target}"\n      npm run dev\nOpen: ${appEnv.APP_URL}\n`
    )
  } catch (error) {
    progress.finish(true)
    throw error
  } finally {
    releaseDocker()
  }
}

// npm bin entries are symlinks on Linux. Node resolves the imported module URL,
// but argv retains the link path; compare their real paths before starting.
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      `\nSetup did not complete: ${error.message}\nIf setup created files or databases, they have been retained for inspection. See the generated README for recovery steps.`
    )
    process.exitCode = 1
  })
