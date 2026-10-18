import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'

/** A validated address the outbound connection is pinned to. */
export type OutboundTarget = { address: string; family: 4 | 6 }

export type OutboundOptions = {
  /** Allow http:// and private or loopback addresses (explicit opt-in only). */
  allowPrivateTargets?: boolean
  /** Hostname resolution; replaceable in tests. */
  resolve?: (host: string) => Promise<string[]>
}

export type OutboundRequest = {
  headers: Record<string, string>
  body: string
  signal: AbortSignal
  /** The address validated before the request; the connection must use it. */
  target?: OutboundTarget
}

/** Stored failure categories; raw error messages and response bodies are never kept. */
export type OutboundErrorCategory =
  'dns' | 'connect' | 'tls' | 'timeout' | 'blocked-target' | 'secret' | `http-status:${number}`

/** Raised when a target is not allowed or cannot be resolved. */
export class OutboundTargetError extends Error {
  constructor(public category: 'blocked-target' | 'dns') {
    super(category === 'dns' ? 'Target host cannot be resolved' : 'Target address is not allowed')
  }
}

// IANA special-purpose and non-public ranges.
const IPV4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.31.196.0', 24], // AS112
  ['192.52.193.0', 24], // AMT
  ['192.168.0.0', 16],
  ['192.175.48.0', 24], // AS112 direct delegation
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]
const IPV6_BLOCKED: [string, number][] = [
  ['::', 96], // unspecified, loopback and deprecated IPv4-compatible addresses
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments, including Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 can tunnel to any IPv4 address
  ['3fff::', 20], // documentation
  ['5f00::', 16], // SRv6 SIDs
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
]
const ipv4Blocked = new BlockList()
for (const [network, prefix] of IPV4_BLOCKED) ipv4Blocked.addSubnet(network, prefix, 'ipv4')
ipv4Blocked.addAddress('255.255.255.255', 'ipv4')
const ipv6Blocked = new BlockList()
for (const [network, prefix] of IPV6_BLOCKED) ipv6Blocked.addSubnet(network, prefix, 'ipv6')

/** Expands an IPv6 address (optionally with a dotted IPv4 tail) to eight 16-bit groups. */
function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase().split('%')[0]
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const octets = dotted[1].split('.').map(Number)
    value =
      value.slice(0, -dotted[1].length) +
      `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const [head, tail] = value.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const missing = 8 - left.length - right.length
  if (value.includes('::') ? missing < 1 : missing !== 0) return null
  const groups = [...left, ...Array(value.includes('::') ? missing : 0).fill('0'), ...right].map(
    (group) => Number.parseInt(group, 16)
  )
  return groups.length === 8 && groups.every((group) => group >= 0 && group <= 0xffff)
    ? groups
    : null
}

function embeddedIPv4(groups: number[]) {
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.')
}

/**
 * True when an IP literal is not a public unicast address. IPv4-mapped and
 * NAT64 (64:ff9b::/96) addresses are checked by the IPv4 address they embed.
 */
export function isBlockedAddress(address: string): boolean {
  const value = address.replace(/^\[|\]$/g, '')
  const version = isIP(value)
  if (version === 4) return ipv4Blocked.check(value, 'ipv4')
  if (version !== 6) return true
  const groups = ipv6Groups(value)
  if (!groups) return true
  const prefix96 = groups.slice(0, 6)
  // IPv4-mapped ::ffff:0:0/96 and IPv4-translated ::ffff:0:0:0/96.
  if (prefix96.every((group, index) => group === (index === 5 ? 0xffff : 0)))
    return isBlockedAddress(embeddedIPv4(groups))
  if (prefix96.every((group, index) => group === (index === 4 ? 0xffff : 0)))
    return isBlockedAddress(embeddedIPv4(groups))
  if (groups[0] === 0x64 && groups[1] === 0xff9b && prefix96.slice(2).every((group) => group === 0))
    return isBlockedAddress(embeddedIPv4(groups))
  return ipv6Blocked.check(groups.map((group) => group.toString(16)).join(':'), 'ipv6')
}

const defaultResolve = async (host: string) => {
  const entries = await lookup(host, { all: true })
  return entries.map((entry) => entry.address)
}

/**
 * Resolves a URL's host once and returns the address to pin the connection to.
 * Every resolved address must be public unless private targets are allowed.
 */
export async function resolveOutboundTarget(
  url: URL,
  options: OutboundOptions = {}
): Promise<OutboundTarget> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: string[]
  if (isIP(host)) addresses = [host]
  else {
    try {
      addresses = await (options.resolve ?? defaultResolve)(host)
    } catch {
      throw new OutboundTargetError('dns')
    }
  }
  if (!addresses.length || addresses.some((address) => !isIP(address)))
    throw new OutboundTargetError('dns')
  if (options.allowPrivateTargets !== true && addresses.some(isBlockedAddress))
    throw new OutboundTargetError('blocked-target')
  const [address] = addresses
  return { address, family: isIP(address) === 6 ? 6 : 4 }
}

/** Sends a POST whose TCP connection goes to the pinned address; redirects are not followed. */
export function pinnedPost(url: URL, init: OutboundRequest & { target: OutboundTarget }) {
  const { address, family } = init.target
  const pinnedLookup: LookupFunction = (_host, options, callback) => {
    if (options.all) callback(null, [{ address, family }])
    else callback(null, address, family)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<{ status: number }>((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'POST',
        headers: { ...init.headers, 'Content-Length': String(Buffer.byteLength(init.body)) },
        lookup: pinnedLookup,
        servername: isIP(host) ? undefined : host,
        signal: init.signal,
      },
      (response) => {
        // The body is never read or stored.
        response.resume()
        resolve({ status: response.statusCode ?? 0 })
      }
    )
    request.on('error', reject)
    request.end(init.body)
  })
}

/**
 * The guarded outbound HTTP client: validates the URL, resolves its host once,
 * refuses private targets unless allowed and connects to the validated address.
 * A `target` supplied by the caller (already validated) is used as-is.
 */
export function createOutboundPoster(options: OutboundOptions = {}) {
  return async (value: string, init: OutboundRequest) => {
    const url = new URL(value)
    if (url.protocol !== 'https:' && !(options.allowPrivateTargets && url.protocol === 'http:'))
      throw new OutboundTargetError('blocked-target')
    if (url.username || url.password) throw new OutboundTargetError('blocked-target')
    const target = init.target ?? (await resolveOutboundTarget(url, options))
    if (options.allowPrivateTargets !== true && isBlockedAddress(target.address))
      throw new OutboundTargetError('blocked-target')
    return pinnedPost(url, { ...init, target })
  }
}

const TLS_CODES = /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|HOSTNAME_MISMATCH)/
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ENODATA', 'ESERVFAIL'])

/** Maps a delivery failure to a stored category without keeping its message. */
export function outboundErrorCategory(error: unknown): OutboundErrorCategory {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (current instanceof OutboundTargetError) return current.category
    const { name, code } = current as { name?: string; code?: string }
    if (name === 'TimeoutError' || name === 'AbortError' || code === 'ABORT_ERR') return 'timeout'
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'timeout'
    if (code && DNS_CODES.has(code)) return 'dns'
    if (code && TLS_CODES.test(code)) return 'tls'
    current = (current as { cause?: unknown }).cause
  }
  return 'connect'
}
