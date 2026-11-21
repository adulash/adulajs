import { test } from '@japa/runner'
import { createServer, get, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { listenOnIpv6Loopback } from '../../bin/ipv6_loopback.js'

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
const close = (server: Server) => new Promise((resolve) => server.close(resolve))
const fetchBody = (url: string) =>
  new Promise<string>((resolve, reject) => {
    get(url, (response) => {
      let body = ''
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => resolve(body))
    }).on('error', reject)
  })
const handler = (_: unknown, response: { end: (body: string) => void }) => response.end('adula')

test.group('Development server on localhost (#107)', () => {
  test('development serves the same handler on ::1, so localhost does not wait for IPv4', async ({
    assert,
  }) => {
    const port = await freePort()
    const server = await listenOnIpv6Loopback(handler, {
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
    })
    assert.exists(server, 'the IPv6 loopback listener started')
    try {
      // Loopback only: never `::` or 0.0.0.0, so the network cannot reach the dev server.
      assert.equal((server!.address() as AddressInfo).address, '::1')
      assert.equal(await fetchBody(`http://[::1]:${port}/`), 'adula')
    } finally {
      await close(server!)
    }
  })

  test('production, another HOST or a taken port adds no listener', async ({ assert }) => {
    const port = await freePort()
    for (const env of [
      { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port) },
      { NODE_ENV: 'development', HOST: '0.0.0.0', PORT: String(port) },
      { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port) },
    ])
      assert.isUndefined(await listenOnIpv6Loopback(handler, env), JSON.stringify(env))

    const taken = await listenOnIpv6Loopback(handler, {
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
    })
    assert.exists(taken)
    try {
      const second = await listenOnIpv6Loopback(handler, {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(port),
      })
      assert.isUndefined(
        second,
        'a taken ::1 port falls back quietly instead of failing the server'
      )
    } finally {
      await close(taken!)
    }
  })
})
