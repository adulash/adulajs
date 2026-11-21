import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

type Handler = (request: IncomingMessage, response: ServerResponse) => unknown

/**
 * Development only (issue #107). The server listens on HOST=127.0.0.1, while browsers resolve
 * `localhost` to ::1 first and wait about 300 ms before falling back to IPv4. A second listener
 * on the IPv6 loopback serves the same handler, so `localhost` answers at once and the server
 * stays unreachable from the network (no `::` or 0.0.0.0). When ::1 is unavailable (IPv6
 * disabled) or the port is taken there, the listener gives up quietly and `localhost` falls back
 * to IPv4 as before. It never keeps the process alive.
 */
export function listenOnIpv6Loopback(
  handler: Handler,
  env: NodeJS.ProcessEnv = process.env
): Promise<Server | undefined> {
  const port = Number(env.PORT)
  if (env.NODE_ENV !== 'development' || env.HOST !== '127.0.0.1' || !Number.isInteger(port))
    return Promise.resolve(undefined)
  const server = createServer(handler)
  server.unref()
  return new Promise((resolve) => {
    server.once('error', () => {
      server.close()
      resolve(undefined)
    })
    server.listen(port, '::1', () => resolve(server))
  })
}
