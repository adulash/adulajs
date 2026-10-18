import { checkDocker, run } from './system.mjs'

/** Never install host software in unattended mode or without explicit consent. */
export async function prepareDocker({
  question = undefined,
  detect = checkDocker,
  execute = run,
  platform = process.platform,
} = {}) {
  try {
    return { docker: await detect() }
  } catch (error) {
    if (!question) throw error
    if (error.code === 'DOCKER_STOPPED') {
      const answer = await question(
        `${error.message}\nStart the engine, then press Enter to retry (or type cancel): `
      )
      if (answer.trim().toLowerCase() === 'cancel')
        throw new Error('Setup cancelled before project creation.')
      return { docker: await detect() }
    }
    if (error.code !== 'DOCKER_MISSING') throw error
    if (platform === 'win32') {
      const consent = await question(
        'Docker was not found. Install Docker Desktop using winget? Windows may request administrator approval or a restart. Docker license terms remain in the installer. [y/N]: '
      )
      if (/^(y|yes)$/i.test(consent.trim())) {
        try {
          await execute('winget', [
            'install',
            '--id',
            'Docker.DockerDesktop',
            '--exact',
            '--source',
            'winget',
            '--interactive',
          ])
        } catch {
          throw new Error(
            'Docker Desktop installation did not complete. Review the installer output. If Windows requests a restart, restart and rerun the same npx create-adulajs command. If winget is unavailable, install Docker Desktop from https://docs.docker.com/desktop/setup/install/windows-install/ . No system files or databases have been created.'
          )
        }
        const answer = await question(
          'Open Docker Desktop, complete its setup and wait for the engine. Press Enter when ready, or type restart to exit and rerun this command after restarting Windows: '
        )
        if (answer.trim().toLowerCase() === 'restart')
          throw new Error(
            'Restart Windows, start Docker Desktop, then rerun the same npx create-adulajs command. No system files or databases have been created.'
          )
        try {
          return { docker: await detect() }
        } catch {
          throw new Error(
            'Docker is not ready yet. Complete Docker Desktop setup, restart Windows if requested, then rerun the same npx create-adulajs command. No system files or databases have been created.'
          )
        }
      }
    } else {
      // Host installation differs by OS/distro; do not guess a privileged script.
      console.log(error.message)
    }
    const connection = (
      await question(
        'Use existing PostgreSQL 17 and Redis instead? Enter the connection JSON path, or press Enter to cancel: '
      )
    ).trim()
    if (!connection)
      throw new Error('Setup cancelled before project creation. No software was installed.')
    return { connection }
  }
}
