import { test } from '@japa/runner'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackupProviderError, googleDriveProvider, oneDriveProvider } from '../index.js'

type Handler = (request: IncomingMessage, body: Buffer, response: ServerResponse) => void

async function serve(handler: Handler) {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => handler(request, Buffer.concat(chunks), response))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { server, base }
}

function close(...servers: Server[]) {
  for (const server of servers) server.close()
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

async function categoryOf(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    if (error instanceof BackupProviderError) return error.category
    throw error
  }
  return 'no error'
}

const outbound = { allowPrivateTargets: true }
const KIB = 1024

/**
 * A local stand-in for Google's OAuth token endpoint and the Drive v3 resumable upload API.
 * `faults` script one-off failures; `received` is what the fake Drive stored.
 */
async function fakeGoogle(options: { sessionOrigin?: string; badChecksum?: boolean } = {}) {
  const state = {
    tokenRequests: [] as URLSearchParams[],
    authorization: [] as (string | undefined)[],
    received: Buffer.alloc(0),
    total: 0,
    faults: [] as ('partial' | '503')[],
    folderCreated: false,
    uploadName: '',
  }
  const { server, base } = await serve((request, body, response) => {
    const url = new URL(request.url!, 'http://fake')
    if (url.pathname === '/token') {
      const form = new URLSearchParams(body.toString())
      state.tokenRequests.push(form)
      if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'good')
        return sendJson(response, 200, {
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          scope: 'https://www.googleapis.com/auth/drive.file',
        })
      if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'refresh-1')
        return sendJson(response, 200, { access_token: 'access-2', refresh_token: 'refresh-2' })
      return sendJson(response, 400, { error: 'invalid_grant' })
    }
    state.authorization.push(request.headers.authorization)
    if (
      request.headers.authorization !== 'Bearer access-2' &&
      !url.pathname.startsWith('/drive/v3/about')
    )
      return sendJson(response, 401, { error: 'unauthorized' })
    if (url.pathname === '/drive/v3/about')
      return sendJson(response, 200, { user: { emailAddress: 'owner@example.test' } })
    if (url.pathname === '/drive/v3/files' && request.method === 'GET')
      return sendJson(response, 200, { files: state.folderCreated ? [{ id: 'folder-1' }] : [] })
    if (url.pathname === '/drive/v3/files' && request.method === 'POST') {
      state.folderCreated = true
      return sendJson(response, 200, { id: 'folder-1' })
    }
    if (url.pathname === '/upload/drive/v3/files') {
      const metadata = JSON.parse(body.toString())
      state.uploadName = metadata.name
      state.total = Number(request.headers['x-upload-content-length'])
      const origin = options.sessionOrigin ?? `http://${request.headers.host}`
      response.writeHead(200, { Location: `${origin}/upload/session/1` }).end()
      return
    }
    if (url.pathname === '/upload/session/1' && request.method === 'PUT') {
      const range = String(request.headers['content-range'])
      const done = () => {
        const sha256 = options.badChecksum
          ? 'f'.repeat(64)
          : createHash('sha256').update(state.received).digest('hex')
        sendJson(response, 200, {
          id: 'file-1',
          size: String(state.received.length),
          sha256Checksum: sha256,
        })
      }
      const resume = () => {
        const headers: Record<string, string> = state.received.length
          ? { Range: `bytes=0-${state.received.length - 1}` }
          : {}
        response.writeHead(308, headers).end()
      }
      if (range.startsWith('bytes */'))
        return state.received.length === state.total ? done() : resume()
      const fault = state.faults.shift()
      if (fault === '503') return sendJson(response, 503, { error: 'busy' })
      const [, start] = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)!.map(Number)
      if (start !== state.received.length) return sendJson(response, 400, { error: 'gap' })
      // A partial fault stores only half of the chunk, as Drive may.
      const kept = fault === 'partial' ? body.subarray(0, body.length / 2) : body
      state.received = Buffer.concat([state.received, kept])
      return state.received.length === state.total ? done() : resume()
    }
    sendJson(response, 404, {})
  })
  const endpoints = {
    auth: `${base}/auth`,
    token: `${base}/token`,
    api: base,
    upload: base,
    revoke: `${base}/revoke`,
  }
  return { server, base, state, endpoints }
}

async function backupFile(size: number) {
  const root = await mkdtemp(join(tmpdir(), 'adula-provider-test-'))
  const bytes = randomBytes(size)
  const file = join(root, 'backup.adulabackup')
  await writeFile(file, bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { root, file, bytes, sha256 }
}

test.group('Backup providers', () => {
  test('Google asks only for drive.file, with PKCE, state and an offline grant', ({ assert }) => {
    const client = googleDriveProvider({ clientId: 'client-id', clientSecret: 'secret' })
    const url = new URL(
      client.authorizeUrl({
        state: 'state-1',
        codeChallenge: 'challenge-1',
        redirectUri: 'https://app.example/cb',
      })
    )
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('code_challenge'), 'challenge-1')
    assert.equal(url.searchParams.get('state'), 'state-1')
    assert.equal(url.searchParams.get('access_type'), 'offline')
    assert.equal(url.searchParams.get('include_granted_scopes'), 'false')
    assert.isNull(url.searchParams.get('client_secret'))
  })

  test('OneDrive asks only for its app folder and offline access', ({ assert }) => {
    const client = oneDriveProvider({
      clientId: 'client-id',
      clientSecret: 'secret',
      tenant: 'consumers',
    })
    const url = new URL(
      client.authorizeUrl({ state: 's', codeChallenge: 'c', redirectUri: 'https://app.example/cb' })
    )
    assert.equal(
      url.origin + url.pathname,
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
    )
    assert.equal(url.searchParams.get('scope'), 'Files.ReadWrite.AppFolder offline_access')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.throws(() => oneDriveProvider({ clientId: 'x', clientSecret: 'y', tenant: '../evil' }))
  })

  test('Google exchanges a code, rotates the refresh token and resumes a broken upload', async ({
    assert,
  }) => {
    const google = await fakeGoogle()
    const { root, file, bytes, sha256 } = await backupFile(700 * KIB)
    try {
      const client = googleDriveProvider({
        clientId: 'client-id',
        clientSecret: 'secret',
        endpoints: google.endpoints,
        outbound,
        chunkSize: 256 * KIB,
        retries: 3,
      })
      const connected = await client.exchange({
        code: 'good',
        verifier: 'verifier-1',
        redirectUri: 'https://app.example/cb',
      })
      assert.deepEqual(connected, { refreshToken: 'refresh-1', accountLabel: 'owner@example.test' })
      const exchange = google.state.tokenRequests[0]
      assert.equal(exchange.get('code_verifier'), 'verifier-1')
      assert.equal(exchange.get('client_secret'), 'secret')
      const access = await client.refresh('refresh-1')
      assert.deepEqual(access, { accessToken: 'access-2', refreshToken: 'refresh-2' })
      google.state.faults = ['partial', '503']
      const result = await client.upload({
        file,
        name: 'adulajs-backup-20261105-0200.adulabackup',
        size: bytes.length,
        sha256,
        accessToken: access.accessToken,
      })
      assert.deepEqual(result, { remoteId: 'file-1', size: bytes.length })
      assert.deepEqual(google.state.received, bytes)
      assert.equal(google.state.uploadName, 'adulajs-backup-20261105-0200.adulabackup')
      assert.isTrue(google.state.folderCreated)
    } finally {
      close(google.server)
      await rm(root, { recursive: true, force: true })
    }
  })

  test('Google refuses a checksum mismatch, a revoked grant and a foreign session URL', async ({
    assert,
  }) => {
    const mismatch = await fakeGoogle({ badChecksum: true })
    const foreign = await fakeGoogle({ sessionOrigin: 'http://127.0.0.2:9' })
    const { root, file, bytes, sha256 } = await backupFile(10 * KIB)
    try {
      const client = (endpoints: typeof mismatch.endpoints) =>
        googleDriveProvider({
          clientId: 'c',
          clientSecret: 's',
          endpoints,
          outbound,
          chunkSize: 256 * KIB,
          retries: 1,
        })
      const upload = (endpoints: typeof mismatch.endpoints) =>
        client(endpoints).upload({
          file,
          name: 'x.adulabackup',
          size: bytes.length,
          sha256,
          accessToken: 'access-2',
        })
      assert.equal(await categoryOf(() => upload(mismatch.endpoints)), 'integrity')
      assert.equal(await categoryOf(() => upload(foreign.endpoints)), 'blocked-target')
      assert.equal(await categoryOf(() => client(mismatch.endpoints).refresh('gone')), 'revoked')
      assert.equal(
        await categoryOf(() =>
          client(mismatch.endpoints).upload({
            file,
            name: 'x',
            size: bytes.length,
            sha256,
            accessToken: 'wrong',
          })
        ),
        'auth'
      )
    } finally {
      close(mismatch.server, foreign.server)
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses plain http and private addresses unless the host allows them', async ({
    assert,
  }) => {
    const google = await fakeGoogle()
    try {
      const strict = googleDriveProvider({
        clientId: 'c',
        clientSecret: 's',
        endpoints: google.endpoints,
      })
      assert.equal(await categoryOf(() => strict.refresh('refresh-1')), 'blocked-target')
    } finally {
      close(google.server)
    }
  })

  test('a token response above the size bound is refused', async ({ assert }) => {
    const { server, base } = await serve((_request, _body, response) =>
      sendJson(response, 200, { access_token: 'x'.repeat(2 * 1024 * 1024) })
    )
    try {
      const client = googleDriveProvider({
        clientId: 'c',
        clientSecret: 's',
        endpoints: { token: `${base}/token` },
        outbound,
      })
      assert.equal(await categoryOf(() => client.refresh('refresh-1')), 'response')
    } finally {
      close(server)
    }
  })

  test('OneDrive uploads through a session URL without sending the bearer token there', async ({
    assert,
  }) => {
    const uploads = {
      received: Buffer.alloc(0),
      authorization: [] as (string | undefined)[],
      failOnce: true,
    }
    let total = 0
    const session = await serve((request, body, response) => {
      uploads.authorization.push(request.headers.authorization)
      if (request.method === 'GET')
        return sendJson(response, 200, { nextExpectedRanges: [`${uploads.received.length}-`] })
      if (uploads.failOnce && uploads.received.length > 0) {
        uploads.failOnce = false
        return sendJson(response, 503, {})
      }
      const [, start, end, size] = /^bytes (\d+)-(\d+)\/(\d+)$/
        .exec(String(request.headers['content-range']))!
        .map(Number)
      total = size
      if (start !== uploads.received.length || end - start + 1 !== body.length)
        return sendJson(response, 416, {})
      uploads.received = Buffer.concat([uploads.received, body])
      if (uploads.received.length === total)
        return sendJson(response, 201, { id: 'item-1', size: total })
      sendJson(response, 202, { nextExpectedRanges: [`${uploads.received.length}-`] })
    })
    const graph = await serve((request, body, response) => {
      const url = new URL(request.url!, 'http://fake')
      if (url.pathname.endsWith('/token'))
        return sendJson(response, 200, {
          access_token: 'graph-access',
          refresh_token: 'graph-refresh',
        })
      if (request.headers.authorization !== 'Bearer graph-access')
        return sendJson(response, 401, {})
      if (url.pathname === '/v1.0/me/drive')
        return sendJson(response, 200, { owner: { user: { displayName: 'المالك' } } })
      if (decodeURIComponent(url.pathname).startsWith('/v1.0/me/drive/special/approot:/')) {
        assert.equal(JSON.parse(body.toString()).item['@microsoft.graph.conflictBehavior'], 'fail')
        return sendJson(response, 200, { uploadUrl: `${session.base}/session/1` })
      }
      sendJson(response, 404, {})
    })
    const { root, file, bytes, sha256 } = await backupFile(1000 * KIB)
    try {
      const client = oneDriveProvider({
        clientId: 'c',
        clientSecret: 's',
        endpoints: { authority: graph.base, graph: `${graph.base}/v1.0` },
        outbound,
        chunkSize: 320 * KIB,
        retries: 2,
      })
      const connected = await client.exchange({
        code: 'code',
        verifier: 'v',
        redirectUri: 'https://app/cb',
      })
      assert.deepEqual(connected, { refreshToken: 'graph-refresh', accountLabel: 'المالك' })
      const result = await client.upload({
        file,
        name: 'backup.adulabackup',
        size: bytes.length,
        sha256,
        accessToken: 'graph-access',
      })
      assert.deepEqual(result, { remoteId: 'item-1', size: bytes.length })
      assert.deepEqual(uploads.received, bytes)
      assert.isTrue(uploads.authorization.every((value) => value === undefined))
      assert.isFalse(uploads.failOnce, 'the transient failure was retried')
    } finally {
      close(session.server, graph.server)
      await rm(root, { recursive: true, force: true })
    }
  })
})
