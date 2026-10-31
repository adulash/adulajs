import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, join } from 'node:path'

/** Packages that `--packages` can supply as local archives instead of the registry. */
export const LOCAL_PACKAGES = ['adula', '@adula/ui']

/** The archive name pnpm pack writes: adula -> adula-2.2.0.tgz, @adula/ui -> adula-ui-2.2.0.tgz. */
export function packageArchive(name, version) {
  const base = name.replace(/^@/, '').replace('/', '-')
  return version ? `${base}-${version}.tgz` : `${base}.tgz`
}

export function projectName(target) {
  const name = basename(resolve(target))
  if (!/^[a-z][a-z0-9-]{0,49}$/.test(name))
    throw new Error(
      'Project directory name must start with a lowercase letter and use lowercase letters, digits or hyphens (up to 50 characters). For example, use dental-gate for the directory; the company display name can still be Dental-Gate.'
    )
  return name
}

export async function assertEmpty(target) {
  try {
    const info = await lstat(target)
    if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(target)).length)
      throw new Error(
        'Project directory is nonempty or a symbolic link. Choose a new directory; existing files will not be overwritten.'
      )
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

export async function writeNew(root, path, text, secret = false) {
  if (!path || path.includes('\\') || path.split('/').includes('..') || isAbsolute(path))
    throw new Error('Unsafe template path.')
  const dest = resolve(root, path)
  const rel = relative(resolve(root), dest)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe template path.')
  // Reject symlink parents as well as final symlinks; all writes use O_EXCL.
  let parent = dirname(dest)
  while (parent !== dirname(resolve(root))) {
    try {
      if ((await lstat(parent)).isSymbolicLink())
        throw new Error('Cannot write through a symbolic link.')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (parent === resolve(root)) break
    parent = dirname(parent)
  }
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, text, {
    flag: 'wx',
    ...(secret ? { mode: 0o600 } : {}),
  })
}

export function dotenv(values) {
  return (
    Object.entries(values)
      .map(([key, value]) => {
        const text = String(value)
        // Adonis interpolates dollars even inside quotes. Complex values are stored
        // with its file: identifier by prepareEnvironment, preserving exact bytes.
        if (/[\r\n\0'$\\]/.test(text))
          throw new Error(
            `Value for ${key} contains unsupported characters for direct environment encoding.`
          )
        return `${key}='${text}'`
      })
      .join('\n') + '\n'
  )
}

/** The committed .env.example: every variable, but none of this machine's secrets, hosts, users or addresses. */
export function exampleEnvironment(values, name) {
  return {
    ...values,
    APP_KEY: '',
    DB_HOST: '127.0.0.1',
    DB_USER: 'postgres',
    DB_PASSWORD: '',
    DB_DATABASE: name,
    REDIS_HOST: '127.0.0.1',
    ...('REDIS_PASSWORD' in values ? { REDIS_PASSWORD: '' } : {}),
    MAIL_FROM_ADDRESS: 'no-reply@example.com',
  }
}

export async function prepareEnvironment(target, values) {
  const encoded = { ...values }
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n\0'$\\]/.test(String(value)) || String(value).startsWith('file:')) {
      if (String(value).includes('\0')) throw new Error(`Invalid value for ${key}.`)
      await writeNew(target, `tmp/env/${key}`, String(value), true)
      encoded[key] = `file:./tmp/env/${key}`
    }
  }
  return encoded
}

export function composeFile() {
  return `services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: adula
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_DB: postgres
    ports: ["127.0.0.1:\${DB_PORT}:5432"]
    volumes: ["postgres-data:/var/lib/postgresql/data"]
    command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U adula -d postgres"]
      interval: 2s
      timeout: 5s
      retries: 30
  redis:
    image: redis:7
    ports: ["127.0.0.1:\${REDIS_PORT}:6379"]
    volumes: ["redis-data:/data"]
    command: ["redis-server", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 5s
      retries: 30
volumes:
  postgres-data:
  redis-data:
`
}

export async function readIdentity(file, company) {
  const identity = file ? await readJson(resolve(file), 'identity') : {}
  if (!identity || typeof identity !== 'object' || Array.isArray(identity))
    throw new Error('Identity file must contain a JSON object.')
  if (
    Object.keys(identity).some(
      (key) => !['primaryColor', 'fontFamily', 'logo', 'guidelines'].includes(key)
    )
  )
    throw new Error('Identity file accepts only primaryColor, fontFamily, logo and guidelines.')
  if (
    typeof company !== 'string' ||
    !company.trim() ||
    company.length > 150 ||
    /[\r\n\0]/.test(company)
  )
    throw new Error('Company name is required (up to 150 characters, without newlines).')
  for (const key of ['primaryColor', 'fontFamily', 'logo', 'guidelines'])
    if (identity[key] !== undefined && typeof identity[key] !== 'string')
      throw new Error(`Identity field ${key} must be a string.`)
  if (identity.primaryColor && !/^#[\da-fA-F]{6}$/.test(identity.primaryColor))
    throw new Error('Brand color must be a hex color such as #14532d.')
  if (identity.fontFamily && !/^[\p{L}\p{N} _,-]{1,100}$/u.test(identity.fontFamily))
    throw new Error('Invalid font family.')
  if (identity.logo) {
    const path = resolve(dirname(resolve(file)), identity.logo)
    if (!/\.(png|jpe?g|webp)$/i.test(path)) throw new Error('Use a local PNG, JPEG or WebP logo.')
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024)
      throw new Error('Logo must be an image file up to 5 MB.')
    identity.logoBytes = await readFile(path)
    identity.logoPath = `/brand/logo.${path.split('.').at(-1).toLowerCase()}`
  }
  return { ...identity, company: company.trim() }
}

export async function readJson(file, label) {
  const text = await readFile(file, 'utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`The ${label} file is not valid JSON. Review the file locally.`)
  }
}

export function brandCss(identity) {
  let css = '\n/* Company identity supplied during project creation. */\n'
  if (identity.primaryColor) {
    const channels = identity.primaryColor
      .slice(1)
      .match(/../g)
      .map((hex) => parseInt(hex, 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    const foreground = luminance > 0.179 ? '#000000' : '#ffffff'
    css += `:root, .dark { --primary: ${identity.primaryColor}; --primary-foreground: ${foreground}; --ring: ${identity.primaryColor}; }\n`
  }
  if (identity.fontFamily)
    css += `:root { --brand-font: "${identity.fontFamily}", "IBM Plex Sans Arabic"; }\n`
  return css
}

export async function renderProject(target, template, { name, identity, packageFiles }) {
  const files = { ...template.files }
  const pkg = JSON.parse(files['package.json'])
  pkg.name = name
  if (packageFiles) {
    // Acceptance tests and offline releases can use reviewed local tarballs.
    // They are copied into the new app, so no monorepo links survive.
    for (const name of LOCAL_PACKAGES) {
      const archive = resolve(packageFiles, packageArchive(name, template.version))
      const local = `.adula-packages/${packageArchive(name)}`
      await writeNew(target, local, await readFile(archive))
      pkg.dependencies[name] = `file:${local}`
    }
  }
  files['package.json'] = JSON.stringify(pkg, null, 2) + '\n'
  const brand = { company: identity.company, logo: identity.logoPath ?? null }
  files['company-identity.json'] = JSON.stringify(brand, null, 2) + '\n'
  files['inertia/brand.ts'] = `export const brand = ${JSON.stringify(brand, null, 2)}\n`
  for (const path of [
    'inertia/layouts/default.tsx',
    'inertia/layouts/workspace.tsx',
    'inertia/pages/home.tsx',
  ]) {
    files[path] = `import { brand } from '~/brand'\n` + files[path]
  }
  files['inertia/layouts/default.tsx'] = files['inertia/layouts/default.tsx']
    .replace('aria-label="AdulaJS — الرئيسية"', 'aria-label={brand.company}')
    .replace(
      '<strong dir="ltr">AdulaJS</strong>',
      '<strong>{brand.logo && <img src={brand.logo} alt="" className="inline-block size-8 object-contain" />} {brand.company}</strong>'
    )
  files['inertia/layouts/workspace.tsx'] = files['inertia/layouts/workspace.tsx']
    .replaceAll('>عدولة<', '>{brand.company}<')
    .replace('التطبيق المرجعي', '{brand.company}')
    .replace(
      '            ع\n',
      '            {brand.logo ? <img src={brand.logo} alt="" className="size-10 object-contain" /> : brand.company.charAt(0)}\n'
    )
    .replace('text-white', 'text-primary-foreground')
  files['inertia/pages/home.tsx'] = files['inertia/pages/home.tsx'].replace(
    "{ app: 'AdulaJS' }",
    '{ app: brand.company }'
  )
  files['inertia/app.tsx'] =
    `import { brand } from './brand'\n` +
    files['inertia/app.tsx'].replace(
      "import.meta.env.VITE_APP_NAME || 'AdulaJS'",
      'brand.company'
    )
  files['docs/design-identity.md'] =
    `# Company identity\n\nSource: project creator, supplied during installation.\n\n- Company: ${identity.company}\n- Logo: ${identity.logoPath ?? 'Pending; request it before further visual design.'}\n- Primary color: ${identity.primaryColor ?? 'Pending; existing AdulaJS colors are provisional.'}\n- Font: ${identity.fontFamily ?? 'Pending; IBM Plex Sans Arabic is provisional.'}\n- Guidelines: ${identity.guidelines ?? 'Pending; request the company brand guide.'}\n\nUse the bundled adula-frontend-design skill for business interfaces. Keep shadcn/ui and Dialog defaults. A specified font must be licensed and installed locally or added as a project-owned asset; do not fetch unprovided fonts or branding.\n`
  files['AGENTS.md'] =
    '# Project rules\n\nRead docs/design-identity.md before visual design. Request only missing identity items. Application code and UI belong to this project; never edit installed AdulaJS packages (adula, @adula/*).\n'
  for (const [path, contents] of Object.entries(files)) await writeNew(target, path, contents)
  if (identity.logoBytes) await writeNew(target, `public${identity.logoPath}`, identity.logoBytes)
  await writeNew(target, 'inertia/css/brand.css', brandCss(identity))
  // Applied after AdulaJS tokens, including after subsequent adula:ui upgrades.
  const app = join(target, 'inertia/app.tsx')
  await writeFile(
    app,
    (await readFile(app, 'utf8')).replace(
      "import './css/adula.css'",
      "import './css/adula.css'\nimport './css/brand.css'"
    )
  )
}
