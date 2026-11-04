import { createServer, type Socket, type AddressInfo } from 'node:net'

/**
 * Loopback-only SMTP sink: exercises the real SMTP transport without external delivery.
 * With `auth`, it advertises AUTH PLAIN and LOGIN, refuses mail before a successful login
 * and answers wrong credentials with 535, as a provider would.
 */
export async function smtpSink(options: { auth?: { user: string; pass: string } } = {}) {
  const messages: string[] = []
  const logins: string[] = []
  const decode = (value: string) => Buffer.from(value, 'base64').toString('utf8')
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.setEncoding('utf8')
    socket.write('220 localhost test SMTP\r\n')
    let buffer = ''
    let inData = false
    let lines: string[] = []
    let authenticated = !options.auth
    let login: { step: 'plain' | 'user' | 'pass'; user?: string } | null = null
    const verify = (user: string, pass: string) => {
      authenticated = user === options.auth?.user && pass === options.auth?.pass
      if (authenticated) logins.push(user)
      socket.write(authenticated ? '235 Authenticated\r\n' : '535 5.7.8 Authentication failed\r\n')
    }
    const plain = (value: string) => {
      const [, user = '', pass = ''] = decode(value).split('\0')
      verify(user, pass)
    }
    socket.on('data', (chunk) => {
      buffer += chunk
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n')
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (inData) {
          if (line === '.') {
            messages.push(lines.join('\r\n'))
            lines = []
            inData = false
            socket.write('250 stored\r\n')
          } else lines.push(line.replace(/^\.\./, '.'))
        } else if (login) {
          const step = login
          login = null
          if (step.step === 'plain') plain(line)
          else if (step.step === 'user') {
            login = { step: 'pass', user: decode(line) }
            socket.write('334 UGFzc3dvcmQ6\r\n')
          } else verify(step.user ?? '', decode(line))
        } else if (/^(EHLO|HELO) /i.test(line))
          socket.write(
            options.auth ? '250-localhost\r\n250 AUTH PLAIN LOGIN\r\n' : '250 localhost\r\n'
          )
        else if (options.auth && /^AUTH PLAIN/i.test(line)) {
          const initial = line.split(' ')[2]
          if (initial) plain(initial)
          else {
            login = { step: 'plain' }
            socket.write('334 \r\n')
          }
        } else if (options.auth && /^AUTH LOGIN/i.test(line)) {
          const initial = line.split(' ')[2]
          login = initial ? { step: 'pass', user: decode(initial) } : { step: 'user' }
          socket.write(initial ? '334 UGFzc3dvcmQ6\r\n' : '334 VXNlcm5hbWU6\r\n')
        } else if (/^(MAIL FROM|RCPT TO)/i.test(line))
          socket.write(authenticated ? '250 OK\r\n' : '530 5.7.0 Authentication required\r\n')
        else if (/^(RSET|NOOP)/i.test(line)) socket.write('250 OK\r\n')
        else if (line === 'DATA') {
          inData = true
          socket.write('354 End with dot\r\n')
        } else if (line === 'QUIT') socket.end('221 Bye\r\n')
        else socket.write('502 Unsupported\r\n')
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    port: (server.address() as AddressInfo).port,
    messages,
    /** Usernames that logged in successfully. */
    logins,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    },
  }
}
