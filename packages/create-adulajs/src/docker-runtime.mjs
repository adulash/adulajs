import { spawn } from 'node:child_process'

export function dockerBackend(name) {
  if (name === 'direct') return { command: 'docker', prefix: [], display: 'docker' }
  if (name === 'wsl')
    return { command: 'wsl.exe', prefix: ['--exec', 'docker'], display: 'wsl.exe --exec docker' }
  throw new Error('Invalid Docker backend. Expected direct or wsl.')
}

export async function runCommand(command, args, { quiet = false } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      stdio: quiet ? 'ignore' : 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve(undefined)
      else reject(new Error(`Command failed: ${command} (${signal ?? code})`))
    })
  })
}

export async function detectDocker(execute = runCommand, platform = process.platform) {
  // Detection happens once. A later Compose or application failure must never
  // redirect the project to another daemon with different databases/volumes.
  for (const name of platform === 'win32' ? ['direct', 'wsl'] : ['direct']) {
    const backend = dockerBackend(name)
    try {
      await execute(backend.command, [...backend.prefix, 'version'], { quiet: true })
      await execute(backend.command, [...backend.prefix, 'compose', 'version'], { quiet: true })
      return backend
    } catch {
      // Only discovery may fall back, and only after the direct probe fails.
    }
  }
  throw Object.assign(
    new Error(
      'Docker with Compose is unavailable: docker version and docker compose version must succeed' +
        (platform === 'win32'
          ? ' in PowerShell; the default WSL Docker fallback also failed.'
          : '.') +
        ' Install or start Docker and verify these commands. Alternatively, use --services existing --connection ./local.json with PostgreSQL 17 and Redis.'
    ),
    { code: 'DOCKER_MISSING' }
  )
}

export async function withDockerServices(
  backend,
  action,
  { execute = runCommand, hold = undefined } = {}
) {
  // Native Docker never calls the WSL lifecycle helper.
  const release =
    backend.command === 'wsl.exe'
      ? await (hold ?? (await import('./docker-session.mjs')).holdDockerSession)(backend)
      : () => {}
  try {
    await execute(backend.command, [
      ...backend.prefix,
      'compose',
      '--env-file',
      '.env',
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '120',
    ])
    return await action()
  } finally {
    release()
  }
}
