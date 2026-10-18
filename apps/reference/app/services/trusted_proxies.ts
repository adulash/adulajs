import { BlockList, isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'

/** The proxy-addr names accepted in TRUSTED_PROXIES. */
const NAMED: Record<string, string[]> = {
  loopback: ['127.0.0.0/8', '::1/128'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
}

const family = (address: string) => (isIP(address) === 6 ? 'ipv6' : 'ipv4')
/** IPv4 peers on a dual-stack socket arrive as ::ffff:a.b.c.d. */
const plain = (address: string) =>
  address.startsWith('::ffff:') && address.includes('.') ? address.slice(7) : address

/**
 * Compiles TRUSTED_PROXIES (comma-separated names `loopback`, `linklocal`,
 * `uniquelocal`, addresses or CIDRs) into the `trustProxy` function AdonisJS passes
 * to proxy-addr. Only a trusted hop's X-Forwarded-For is believed, so an unset value
 * trusts loopback alone: a client connecting directly can never pick its own address.
 */
export function compileTrustedProxies(value: string | undefined) {
  const list = new BlockList()
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const entry of entries.length ? entries : ['loopback']) {
    for (const range of NAMED[entry] ?? [entry]) {
      const [address, prefix] = range.split('/')
      const bits = Number(prefix)
      const max = isIP(address) === 6 ? 128 : 32
      if (
        !isIP(address) ||
        (prefix !== undefined && !(Number.isInteger(bits) && bits >= 0 && bits <= max))
      )
        throw new Error(`TRUSTED_PROXIES: "${entry}" is not an address, CIDR or known name`)
      if (prefix === undefined) list.addAddress(address, family(address))
      else list.addSubnet(address, bits, family(address))
    }
  }
  return (address: string, _distance: number) => {
    const candidate = plain(String(address ?? ''))
    return isIP(candidate) ? list.check(candidate, family(candidate)) : false
  }
}

/**
 * A request sent by the trusted reverse proxy itself (its active health check):
 * the direct peer is trusted and no client address was forwarded. Requests the
 * proxy relays always carry X-Forwarded-For, so clients cannot pose as the probe.
 */
export function isDirectProxyRequest(
  request: IncomingMessage,
  trusted: (address: string, distance: number) => boolean
) {
  const peer = request.socket.remoteAddress
  return Boolean(peer && trusted(peer, 0) && !request.headers['x-forwarded-for'])
}
