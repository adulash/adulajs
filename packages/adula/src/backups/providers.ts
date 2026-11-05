import { createHash, randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'
import {
  OutboundResponseTooLargeError,
  OutboundTargetError,
  guardOutboundUrl,
  outboundErrorCategory,
  pinnedRequest,
  type OutboundOptions,
  type PinnedResponse,
} from '../integrations/outbound.js'

/**
 * Backup destinations reached through OAuth (ADR 051). Each client asks for the narrowest
 * scope its API offers: Google Drive `drive.file` (only files this application created) and
 * OneDrive `Files.ReadWrite.AppFolder` (only the application's own folder). Endpoints are set
 * in code by the host; tests point them at local fakes. Tokens never appear in errors.
 */
export type BackupProvider = 'google' | 'onedrive'

export type BackupProviderErrorCategory =
  | 'revoked'
  | 'auth'
  | 'quota'
  | 'integrity'
  | 'response'
  | 'timeout'
  | 'blocked-target'
  | 'dns'
  | 'connect'
  | 'tls'
  | 'secret'
  | `http-status:${number}`

/** A provider failure with a stored category; the message never holds a token or URL query. */
export class BackupProviderError extends Error {
  constructor(
    public category: BackupProviderErrorCategory,
    message = `Backup provider request failed (${category})`
  ) {
    super(message)
  }
}

export type BackupProviderClient = {
  provider: BackupProvider
  /** The provider's consent page for an administrator; state and PKCE are the caller's. */
  authorizeUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string
  exchange(input: {
    code: string
    verifier: string
    redirectUri: string
  }): Promise<{ refreshToken: string; accountLabel: string | null }>
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string }>
  upload(input: {
    file: string
    name: string
    size: number
    sha256: string
    accessToken: string
    signal?: AbortSignal
  }): Promise<{ remoteId: string; size: number }>
  /** Revokes a refresh token at the provider, where the provider offers it. */
  revoke?(refreshToken: string): Promise<void>
}

export type GoogleDriveEndpoints = {
  auth: string
  token: string
  api: string
  upload: string
  revoke: string
}
export type OneDriveEndpoints = { authority: string; graph: string }
export type BackupProviderOptions = {
  clientId: string
  clientSecret: string
  outbound?: OutboundOptions
  /** Bytes per upload request. */
  chunkSize?: number
  /** Per-request timeout. */
  timeoutMs?: number
  retries?: number
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const ONEDRIVE_SCOPE = 'Files.ReadWrite.AppFolder offline_access'
const GOOGLE_FOLDER = 'AdulaJS backups'
const RESPONSE_LIMIT = 1024 * 1024
const GOOGLE_CHUNK = 8 * 1024 * 1024
const ONEDRIVE_CHUNK = 10 * 1024 * 1024

/** A PKCE verifier and its S256 challenge. */
export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

type Call = {
  method: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  signal?: AbortSignal
}

function http(options: BackupProviderOptions) {
  const timeoutMs = options.timeoutMs ?? 60_000
  return async (value: string | URL, call: Call): Promise<PinnedResponse> => {
    const signals = [AbortSignal.timeout(timeoutMs), ...(call.signal ? [call.signal] : [])]
    try {
      const { url, target } = await guardOutboundUrl(value, options.outbound)
      return await pinnedRequest(url, {
        method: call.method,
        headers: call.headers ?? {},
        body: call.body,
        signal: AbortSignal.any(signals),
        target,
        maxResponseBytes: RESPONSE_LIMIT,
      })
    } catch (error) {
      if (error instanceof BackupProviderError) throw error
      if (error instanceof OutboundResponseTooLargeError) throw new BackupProviderError('response')
      if (error instanceof OutboundTargetError) throw new BackupProviderError(error.category)
      throw new BackupProviderError(outboundErrorCategory(error) as BackupProviderErrorCategory)
    }
  }
}

function json(response: PinnedResponse): Record<string, any> {
  try {
    const value = JSON.parse(response.body.toString('utf8'))
    if (value && typeof value === 'object') return value
  } catch {}
  throw new BackupProviderError('response')
}

function header(response: PinnedResponse, name: string) {
  const value = response.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

/** Classifies a token endpoint refusal; `invalid_grant` means consent was withdrawn. */
function tokenFailure(response: PinnedResponse) {
  let error: unknown
  try {
    error = JSON.parse(response.body.toString('utf8'))?.error
  } catch {}
  if (error === 'invalid_grant') return new BackupProviderError('revoked')
  if (response.status === 400 || response.status === 401) return new BackupProviderError('auth')
  return new BackupProviderError(`http-status:${response.status}`)
}

function statusFailure(response: PinnedResponse) {
  if (response.status === 401) return new BackupProviderError('auth')
  if (response.status === 507) return new BackupProviderError('quota')
  if (response.status === 403) {
    const text = response.body.toString('utf8')
    if (/storageQuotaExceeded|quotaExceeded|quotaLimitReached/i.test(text))
      return new BackupProviderError('quota')
  }
  return new BackupProviderError(`http-status:${response.status}`)
}

function form(values: Record<string, string>) {
  return new URLSearchParams(values).toString()
}

async function tokenRequest(
  send: ReturnType<typeof http>,
  url: string,
  values: Record<string, string>
) {
  const response = await send(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: form(values),
  })
  if (response.status !== 200) throw tokenFailure(response)
  const body = json(response)
  if (typeof body.access_token !== 'string' || !body.access_token)
    throw new BackupProviderError('response')
  return body
}

/** Reads `length` bytes of a file at `offset`. */
async function readRange(file: string, offset: number, length: number) {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Retries a resumable upload step after transient failures, at most `retries` times. */
async function transient<T>(retries: number, step: (attempt: number) => Promise<T>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await step(attempt)
    } catch (error) {
      const category = error instanceof BackupProviderError ? error.category : 'connect'
      const retryable =
        category === 'connect' ||
        category === 'timeout' ||
        /^http-status:(5\d\d|429)$/.test(category)
      if (!retryable || attempt >= retries) throw error
      await new Promise((resolve) => setTimeout(resolve, Math.min(200 * 2 ** attempt, 5000)))
    }
  }
}

/** A session URL returned by the provider must stay on an allowed origin. */
function sessionUrl(value: string | undefined, allowedOrigin: string | null) {
  if (!value) throw new BackupProviderError('response')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BackupProviderError('response')
  }
  if (url.username || url.password) throw new BackupProviderError('blocked-target')
  if (allowedOrigin && url.origin !== allowedOrigin) throw new BackupProviderError('blocked-target')
  return url
}

/** The next byte the provider expects, from a Range header `bytes=0-N`. */
function nextFromRange(value: string | undefined) {
  if (!value) return 0
  const match = /^bytes=0-(\d+)$/.exec(value.trim())
  if (!match) throw new BackupProviderError('response')
  return Number(match[1]) + 1
}

export function googleDriveProvider(
  options: BackupProviderOptions & { endpoints?: Partial<GoogleDriveEndpoints> }
): BackupProviderClient {
  const endpoints: GoogleDriveEndpoints = {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    api: 'https://www.googleapis.com',
    upload: 'https://www.googleapis.com',
    revoke: 'https://oauth2.googleapis.com/revoke',
    ...options.endpoints,
  }
  const send = http(options)
  const chunkSize = options.chunkSize ?? GOOGLE_CHUNK
  if (chunkSize % (256 * 1024) !== 0) throw new RangeError('Drive chunks are multiples of 256 KiB')
  const retries = options.retries ?? 5
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

  async function folder(accessToken: string, signal?: AbortSignal) {
    const query = `name = '${GOOGLE_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    const search = new URL('/drive/v3/files', endpoints.api)
    search.searchParams.set('q', query)
    search.searchParams.set('fields', 'files(id)')
    search.searchParams.set('spaces', 'drive')
    const found = await send(search, { method: 'GET', headers: bearer(accessToken), signal })
    if (found.status !== 200) throw statusFailure(found)
    const existing = json(found).files?.[0]?.id
    if (typeof existing === 'string' && existing) return existing
    const created = await send(new URL('/drive/v3/files?fields=id', endpoints.api), {
      method: 'POST',
      headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: GOOGLE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
      signal,
    })
    if (created.status !== 200) throw statusFailure(created)
    const id = json(created).id
    if (typeof id !== 'string' || !id) throw new BackupProviderError('response')
    return id
  }

  return {
    provider: 'google',
    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL(endpoints.auth)
      url.search = form({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'false',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      return url.toString()
    },
    async exchange({ code, verifier, redirectUri }) {
      const body = await tokenRequest(send, endpoints.token, {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: options.clientId,
        client_secret: options.clientSecret,
      })
      if (typeof body.refresh_token !== 'string' || !body.refresh_token)
        throw new BackupProviderError('response')
      if (typeof body.scope === 'string' && !body.scope.split(' ').includes(GOOGLE_SCOPE))
        throw new BackupProviderError('auth')
      let accountLabel: string | null = null
      try {
        const about = await send(
          new URL('/drive/v3/about?fields=user(emailAddress,displayName)', endpoints.api),
          { method: 'GET', headers: bearer(body.access_token) }
        )
        if (about.status === 200) {
          const user = json(about).user ?? {}
          const label = user.emailAddress ?? user.displayName
          accountLabel = typeof label === 'string' ? label.slice(0, 320) : null
        }
      } catch {}
      return { refreshToken: body.refresh_token, accountLabel }
    },
    async refresh(refreshToken) {
      const body = await tokenRequest(send, endpoints.token, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: options.clientId,
        client_secret: options.clientSecret,
      })
      return {
        accessToken: body.access_token,
        refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
      }
    },
    async upload({ file, name, size, sha256, accessToken, signal }) {
      const parent = await folder(accessToken, signal)
      const start = new URL('/upload/drive/v3/files', endpoints.upload)
      start.search = form({ uploadType: 'resumable', fields: 'id,size,sha256Checksum' })
      const session = await transient(retries, async () => {
        const response = await send(start, {
          method: 'POST',
          headers: {
            ...bearer(accessToken),
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': 'application/octet-stream',
            'X-Upload-Content-Length': String(size),
          },
          body: JSON.stringify({ name, parents: [parent], mimeType: 'application/octet-stream' }),
          signal,
        })
        if (response.status !== 200) throw statusFailure(response)
        return sessionUrl(header(response, 'location'), new URL(endpoints.upload).origin)
      })
      const finish = (response: PinnedResponse) => {
        const item = json(response)
        if (typeof item.id !== 'string' || Number(item.size) !== size)
          throw new BackupProviderError('integrity')
        if (typeof item.sha256Checksum === 'string' && item.sha256Checksum.toLowerCase() !== sha256)
          throw new BackupProviderError('integrity')
        return { remoteId: item.id, size }
      }
      let offset = 0
      let result: { remoteId: string; size: number } | null = null
      while (!result) {
        result = await transient(retries, async (attempt) => {
          if (attempt > 0) {
            // Ask where the upload stands before sending more.
            const probe = await send(session, {
              method: 'PUT',
              headers: { ...bearer(accessToken), 'Content-Range': `bytes */${size}` },
              signal,
            })
            if (probe.status === 200 || probe.status === 201) return finish(probe)
            if (probe.status !== 308) throw statusFailure(probe)
            offset = nextFromRange(header(probe, 'range'))
          }
          const length = Math.min(chunkSize, size - offset)
          const bytes = length > 0 ? await readRange(file, offset, length) : Buffer.alloc(0)
          if (bytes.length !== length) throw new BackupProviderError('integrity')
          const range = size === 0 ? `bytes */0` : `bytes ${offset}-${offset + length - 1}/${size}`
          const response = await send(session, {
            method: 'PUT',
            headers: { ...bearer(accessToken), 'Content-Range': range },
            body: bytes,
            signal,
          })
          if (response.status === 200 || response.status === 201) return finish(response)
          if (response.status !== 308) throw statusFailure(response)
          const next = nextFromRange(header(response, 'range'))
          if (next <= offset && length > 0) throw new BackupProviderError('response')
          offset = next
          return null
        })
      }
      return result
    },
    async revoke(refreshToken) {
      await send(endpoints.revoke, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ token: refreshToken }),
      })
    },
  }
}

export function oneDriveProvider(
  options: BackupProviderOptions & { tenant?: string; endpoints?: Partial<OneDriveEndpoints> }
): BackupProviderClient {
  const endpoints: OneDriveEndpoints = {
    authority: 'https://login.microsoftonline.com',
    graph: 'https://graph.microsoft.com/v1.0',
    ...options.endpoints,
  }
  const tenant = options.tenant || 'common'
  if (!/^[A-Za-z0-9.-]+$/.test(tenant)) throw new RangeError('Invalid Microsoft tenant')
  const authorize = `${endpoints.authority}/${tenant}/oauth2/v2.0/authorize`
  const token = `${endpoints.authority}/${tenant}/oauth2/v2.0/token`
  const graph = endpoints.graph.replace(/\/$/, '')
  const send = http(options)
  const chunkSize = options.chunkSize ?? ONEDRIVE_CHUNK
  if (chunkSize % (320 * 1024) !== 0)
    throw new RangeError('OneDrive chunks are multiples of 320 KiB')
  const retries = options.retries ?? 5
  const bearer = (value: string) => ({ Authorization: `Bearer ${value}` })

  const nextExpected = (body: Record<string, any>) => {
    const first = body.nextExpectedRanges?.[0]
    const match = typeof first === 'string' ? /^(\d+)-/.exec(first) : null
    if (!match) throw new BackupProviderError('response')
    return Number(match[1])
  }

  return {
    provider: 'onedrive',
    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL(authorize)
      url.search = form({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        response_mode: 'query',
        scope: ONEDRIVE_SCOPE,
        prompt: 'select_account',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      return url.toString()
    },
    async exchange({ code, verifier, redirectUri }) {
      const body = await tokenRequest(send, token, {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        scope: ONEDRIVE_SCOPE,
      })
      if (typeof body.refresh_token !== 'string' || !body.refresh_token)
        throw new BackupProviderError('response')
      let accountLabel: string | null = null
      try {
        const drive = await send(`${graph}/me/drive?$select=owner`, {
          method: 'GET',
          headers: bearer(body.access_token),
        })
        if (drive.status === 200) {
          const user = json(drive).owner?.user ?? {}
          const label = user.email ?? user.displayName
          accountLabel = typeof label === 'string' ? label.slice(0, 320) : null
        }
      } catch {}
      return { refreshToken: body.refresh_token, accountLabel }
    },
    async refresh(refreshToken) {
      const body = await tokenRequest(send, token, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        scope: ONEDRIVE_SCOPE,
      })
      return {
        accessToken: body.access_token,
        refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
      }
    },
    async upload({ file, name, size, accessToken, signal }) {
      const create = `${graph}/me/drive/special/approot:/${encodeURIComponent(name)}:/createUploadSession`
      const session = await transient(retries, async () => {
        const response = await send(create, {
          method: 'POST',
          headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail' } }),
          signal,
        })
        if (response.status !== 200) throw statusFailure(response)
        // The upload URL is pre-authorized and may be on another host: no bearer token goes there.
        return sessionUrl(json(response).uploadUrl, null)
      })
      const finish = (response: PinnedResponse) => {
        const item = json(response)
        if (typeof item.id !== 'string' || Number(item.size) !== size)
          throw new BackupProviderError('integrity')
        return { remoteId: item.id, size }
      }
      if (size === 0) throw new BackupProviderError('integrity')
      let offset = 0
      let result: { remoteId: string; size: number } | null = null
      while (!result) {
        result = await transient(retries, async (attempt) => {
          if (attempt > 0) {
            const probe = await send(session, { method: 'GET', signal })
            if (probe.status !== 200) throw statusFailure(probe)
            offset = nextExpected(json(probe))
          }
          const length = Math.min(chunkSize, size - offset)
          const bytes = await readRange(file, offset, length)
          if (bytes.length !== length || length <= 0) throw new BackupProviderError('integrity')
          const response = await send(session, {
            method: 'PUT',
            headers: { 'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}` },
            body: bytes,
            signal,
          })
          if (response.status === 200 || response.status === 201) return finish(response)
          if (response.status !== 202) throw statusFailure(response)
          const next = nextExpected(json(response))
          if (next <= offset) throw new BackupProviderError('response')
          offset = next
          return null
        })
      }
      return result
    },
  }
}
