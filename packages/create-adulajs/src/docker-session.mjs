import { spawn } from 'node:child_process'

// systemd services do not keep WSL alive. Keep a foreground process attached
// to a pipe owned by Node; EOF also releases it if Node exits unexpectedly.
export async function holdDockerSession(docker, launch = spawn) {
  if (docker?.command !== 'wsl.exe') return () => {}
  const child = launch('wsl.exe', ['--exec', 'sh', '-c', 'printf ready; cat >/dev/null'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  child.stdin.on('error', () => {})
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Timed out keeping the WSL Docker session open.'))
    }, 30000)
    let output = ''
    child.once('error', () => {
      clearTimeout(timer)
      reject(new Error('Cannot keep the WSL Docker session open.'))
    })
    child.once('close', () => {
      clearTimeout(timer)
      reject(new Error('The WSL Docker session ended before it was ready.'))
    })
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      if (output === 'ready') {
        clearTimeout(timer)
        resolve(undefined)
      }
    })
  })
  return () => child.stdin.end()
}
