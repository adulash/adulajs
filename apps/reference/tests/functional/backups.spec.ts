import { test } from '@japa/runner'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApiRequest } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import db from '@adonisjs/lucid/services/db'
import encryption from '@adonisjs/core/services/encryption'
import { googleDriveProvider, openBackupArchive } from 'adula'
import User from '#models/user'
import { cloudBackups, overrideCloudBackups } from '#services/cloud_backups'
import { createSnapshot, verifySnapshot } from '#services/backup_snapshot'
import { setEnv } from '../helpers/fake_ally.js'

/**
 * Downloadable and cloud backups over real HTTP, PostgreSQL and pg_dump (ADR 051). Google
 * Drive is a local fake of its OAuth token endpoint and resumable upload API.
 */
type FakeDrive = { base: string; received: Buffer; tokens: URLSearchParams[]; close(): void }

async function fakeDrive(): Promise<FakeDrive> {
  const drive: FakeDrive = { base: '', received: Buffer.alloc(0), tokens: [], close: () => {} }
  let total = 0
  const reply = (response: ServerResponse, status: number, body: unknown, headers = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    response.end(JSON.stringify(body))
  }
  const server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      const url = new URL(request.url!, 'http://fake')
      if (url.pathname === '/token') {
        const form = new URLSearchParams(body.toString())
        drive.tokens.push(form)
        if (form.get('code') === 'good-code' || form.get('refresh_token') === 'drive-refresh')
          return reply(response, 200, {
            access_token: 'drive-access',
            refresh_token: 'drive-refresh',
            scope: 'https://www.googleapis.com/auth/drive.file',
          })
        return reply(response, 400, { error: 'invalid_grant' })
      }
      if (request.headers.authorization !== 'Bearer drive-access') return reply(response, 401, {})
      if (url.pathname === '/drive/v3/about')
        return reply(response, 200, { user: { emailAddress: 'backups@example.test' } })
      if (url.pathname === '/drive/v3/files')
        return reply(response, 200, request.method === 'GET' ? { files: [] } : { id: 'folder' })
      if (url.pathname === '/upload/drive/v3/files') {
        total = Number(request.headers['x-upload-content-length'])
        drive.received = Buffer.alloc(0)
        response.writeHead(200, { Location: `${drive.base}/upload/session` }).end()
        return
      }
      if (url.pathname === '/upload/session') {
        if (!String(request.headers['content-range']).startsWith('bytes */'))
          drive.received = Buffer.concat([drive.received, body])
        if (drive.received.length < total)
          return response.writeHead(308, { Range: `bytes=0-${drive.received.length - 1}` }).end()
        return reply(response, 200, {
          id: 'drive-file',
          size: String(total),
          sha256Checksum: createHash('sha256').update(drive.received).digest('hex'),
        })
      }
      reply(response, 404, {})
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  drive.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  drive.close = () => server.close()
  return drive
}

test.group('Downloadable and cloud backups', (group) => {
  let admin: User
  let member: User
  let manager: User
  let drive: FakeDrive
  const key = randomBytes(32)
  const unique = randomUUID().replaceAll('-', '').slice(0, 10)
  const directory = app.makePath('tmp', `backups-${unique}`)
  const knex = () => db.connection().getWriteClient()
  const json = (request: ApiRequest) => request.withCsrfToken().header('Accept', 'application/json')

  let configured: Parameters<typeof overrideCloudBackups>[0]
  group.setup(async () => {
    drive = await fakeDrive()
    configured = {
      key,
      directory,
      providers: {
        google: googleDriveProvider({
          clientId: 'test-client',
          clientSecret: 'test-secret',
          endpoints: {
            auth: `${drive.base}/auth`,
            token: `${drive.base}/token`,
            api: drive.base,
            upload: drive.base,
            revoke: `${drive.base}/revoke`,
          },
          outbound: { allowPrivateTargets: true },
        }),
      },
    }
    overrideCloudBackups(configured)
    const password = 'test-only-password-123'
    admin = await User.create({
      fullName: 'مدير النسخ',
      email: `backup-admin-${unique}@example.test`,
      password,
    })
    member = await User.create({
      fullName: 'موظف',
      email: `backup-member-${unique}@example.test`,
      password,
    })
    manager = await User.create({
      fullName: 'مدير الموارد',
      email: `backup-manager-${unique}@example.test`,
      password,
    })
    const [org] = await knex()('org_units')
      .insert({ name: 'وحدة النسخ', type: 'root', path: `backup${unique}` })
      .returning('id')
    const [all] = await knex()('roles')
      .insert({ name: `backup-admin-${unique}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert({ role_id: all.id, subject: 'all', action: 'manage' })
    // Full rights on every resource, but not the system: still not a backup administrator.
    const [resources] = await knex()('roles')
      .insert({ name: `backup-resources-${unique}`, permission_level: 1 })
      .returning('id')
    const { registry } = await import('#start/modules')
    await knex()('role_rules').insert(
      registry
        .all()
        .map((resource) => ({ role_id: resources.id, subject: resource.name, action: 'manage' }))
    )
    await knex()('user_roles').insert([
      { user_id: admin.id, role_id: all.id },
      { user_id: manager.id, role_id: resources.id },
    ])
    await knex()('user_org_units').insert(
      [admin, member, manager].map((user) => ({ user_id: user.id, org_unit_id: org.id }))
    )
  })
  group.each.setup(async () => {
    await knex()('backup_runs').delete()
    await knex()('backup_connections').delete()
    // Run and connection ids restart in every test; earlier audit rows would share them.
    await knex()('activities').where({ resource: 'core.backups' }).delete()
    await rm(join(directory, 'files'), { recursive: true, force: true })
  })
  group.teardown(async () => {
    overrideCloudBackups({})
    drive.close()
    await rm(directory, { recursive: true, force: true })
  })

  test('every backup route refuses guests, members and resource managers', async ({
    client,
    assert,
  }) => {
    const routes = Object.values(router.toJSON())
      .flat()
      .filter((route) => route.pattern.startsWith('/admin/backups'))
      .flatMap((route) =>
        route.methods
          .filter((method) => method !== 'HEAD')
          .map((method) => ({
            verb: method.toLowerCase() as 'get' | 'post' | 'put' | 'delete',
            route,
          }))
      )
    assert.lengthOf(routes, 7)
    for (const { verb, route } of routes) {
      const url = route.pattern.replace(':provider', 'google').replace(':id', '1')
      const guest = await json(client[verb](url)).redirects(0)
      assert.oneOf(guest.status(), [302, 401], `${verb} ${url} guest`)
      for (const user of [member, manager]) {
        const refused = await json(client[verb](url).loginAs(user)).redirects(0)
        assert.equal(refused.status(), 403, `${verb} ${url} ${user.email}`)
      }
    }
    // An administrator acting as another administrator is refused as well.
    const other = await User.create({
      fullName: 'مدير آخر',
      email: `backup-other-${unique}@example.test`,
      password: 'test-only-password-123',
    })
    const role = await knex()('roles')
      .where({ name: `backup-admin-${unique}` })
      .first()
    await knex()('user_roles').insert({ user_id: other.id, role_id: role.id })
    const impersonated = await json(client.get('/admin/backups').loginAs(other)).withSession({
      impersonator_id: { adminId: admin.id, targetId: other.id, startedAt: Date.now() },
    })
    impersonated.assertStatus(403)
    const allowed = await json(client.get('/admin/backups').loginAs(admin))
    allowed.assertStatus(200)
    assert.notInclude(JSON.stringify(allowed.body()), 'drive-refresh')
  })

  test('connecting needs the session state and stores the refresh token sealed', async ({
    client,
    assert,
  }) => {
    const started = await json(client.post('/admin/backups/connect/google').loginAs(admin))
    started.assertStatus(200)
    const url = new URL(started.body().url)
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file')
    const pending = started.session()['backups_oauth']
    assert.equal(url.searchParams.get('state'), pending.state)
    assert.notInclude(started.body().url, pending.verifier)

    const callback = (state: string, session: Record<string, unknown> | null, extra = '') => {
      const request = client
        .get(`/admin/backups/oauth/google/callback?state=${state}&code=good-code${extra}`)
        .loginAs(admin)
        .redirects(0)
      return session ? request.withSession({ backups_oauth: session }) : request
    }
    // Wrong state, no pending connection, an expired one and one started by someone else.
    for (const [state, session] of [
      ['forged', pending],
      [pending.state, null],
      [pending.state, { ...pending, at: Date.now() - 11 * 60 * 1000 }],
      [pending.state, { ...pending, userId: member.id }],
      [pending.state, { ...pending, provider: 'onedrive' }],
    ] as const) {
      const refused = await callback(state, session)
      refused.assertStatus(302)
      assert.isUndefined(await knex()('backup_connections').first())
    }
    const failures = await knex()('activities').where({
      resource: 'core.backups',
      action: 'connect_failed',
      actor_id: admin.id,
    })
    assert.isAtLeast(failures.length, 5)
    const denied = await callback(pending.state, pending, '&error=access_denied')
    denied.assertStatus(302)
    assert.isUndefined(await knex()('backup_connections').first())

    const accepted = await callback(pending.state, pending)
    accepted.assertStatus(302)
    accepted.assertHeader('location', '/admin/backups')
    const row = await knex()('backup_connections').where({ provider: 'google' }).first()
    assert.notEqual(row.refresh_token, 'drive-refresh')
    assert.equal(encryption.decrypt(row.refresh_token), 'drive-refresh')
    assert.equal(row.account_label, 'backups@example.test')
    assert.equal(drive.tokens.at(-1)?.get('code_verifier'), pending.verifier)
    // The state is single-use: the session no longer holds it.
    assert.isUndefined(accepted.session()['backups_oauth'])
  })

  test('a download backup is a real encrypted snapshot that expires', async ({
    client,
    assert,
  }) => {
    const queued = await json(client.post('/admin/backups/runs').loginAs(admin)).json({
      kind: 'download',
    })
    queued.assertStatus(200)
    const id = queued.body().data.id
    assert.equal(await cloudBackups().runNext(), id)
    const run = await knex()('backup_runs').where({ id }).first()
    assert.equal(run.status, 'succeeded', run.error_category)
    // Only the sealed archive remains: no plaintext working directory.
    assert.deepEqual(await readdir(directory), ['files'])

    const downloaded = await client
      .get(`/admin/backups/runs/${id}/download`)
      .loginAs(admin)
      .redirects(0)
    downloaded.assertStatus(200)
    downloaded.assertHeader('cache-control', 'no-store')
    assert.match(
      String(downloaded.header('content-disposition')),
      /adulajs-backup-\d{8}-\d{4}\.adulabackup/
    )
    downloaded.assertHeader('content-length', String(run.size_bytes))
    const stored = join(directory, 'files', run.file_name)
    const opened = join(directory, `opened-${unique}`)
    await openBackupArchive(stored, opened, key)
    try {
      assert.isNotNull(await verifySnapshot(opened))
    } finally {
      await rm(opened, { recursive: true, force: true })
    }
    const audit = await knex()('activities')
      .where({ resource: 'core.backups', record_id: id })
      .orderBy('id', 'asc')
      .pluck('action')
    assert.deepEqual(audit, ['queued', 'succeeded', 'downloaded'])

    await knex()('backup_runs')
      .where({ id })
      .update({ expires_at: new Date(Date.now() - 1000) })
    const expired = await json(client.get(`/admin/backups/runs/${id}/download`).loginAs(admin))
    expired.assertStatus(404)
    await cloudBackups().pruneExpired()
    assert.isFalse(existsSync(stored))
  })

  test('an upload to the fake Drive carries an archive that opens and verifies', async ({
    client,
    assert,
  }) => {
    await knex()('backup_connections').insert({
      provider: 'google',
      refresh_token: encryption.encrypt('drive-refresh'),
      connected_by: admin.id,
    })
    const queued = await json(client.post('/admin/backups/runs').loginAs(admin)).json({
      kind: 'google',
    })
    queued.assertStatus(200)
    const id = queued.body().data.id
    await cloudBackups().runNext()
    const run = await knex()('backup_runs').where({ id }).first()
    assert.equal(run.status, 'succeeded', run.error_category)
    assert.equal(run.remote_id, 'drive-file')
    assert.deepEqual(await readdir(join(directory, 'files')), [], 'the local copy is deleted')
    const uploaded = join(directory, `uploaded-${unique}.adulabackup`)
    const opened = join(directory, `uploaded-open-${unique}`)
    await writeFile(uploaded, drive.received)
    try {
      await openBackupArchive(uploaded, opened, key)
      assert.isNotNull(await verifySnapshot(opened))
    } finally {
      await rm(opened, { recursive: true, force: true })
      await rm(uploaded, { force: true })
    }
    const page = await json(client.get('/admin/backups').loginAs(admin))
    const google = page
      .body()
      .backups.destinations.find((entry: { kind: string }) => entry.kind === 'google')
    assert.equal(google.lastRun.status, 'succeeded')
    assert.notProperty(google.connection, 'refreshToken')
  })

  test('schedule and disconnect are validated and audited', async ({ client, assert }) => {
    await knex()('backup_connections').insert({
      provider: 'google',
      refresh_token: encryption.encrypt('drive-refresh'),
      connected_by: admin.id,
    })
    const invalid = await json(
      client.put('/admin/backups/connections/google/schedule').loginAs(admin)
    ).json({
      schedule: 'hourly',
    })
    invalid.assertStatus(422)
    const saved = await json(
      client.put('/admin/backups/connections/google/schedule').loginAs(admin)
    ).json({
      schedule: 'weekly',
    })
    saved.assertStatus(200)
    const connection = await knex()('backup_connections').first()
    assert.equal(connection.schedule, 'weekly')
    const removed = await json(client.delete('/admin/backups/connections/google').loginAs(admin))
    removed.assertStatus(200)
    assert.isUndefined(await knex()('backup_connections').first())
    const actions = await knex()('activities')
      .where({ resource: 'core.backups', actor_id: admin.id })
      .whereIn('action', ['scheduled', 'disconnected'])
      .pluck('action')
    assert.sameMembers(actions, ['scheduled', 'disconnected'])
  })

  test('without the encryption key the page says so and nothing is queued', async ({
    client,
    assert,
  }) => {
    overrideCloudBackups({ key: null, directory })
    try {
      const page = await json(client.get('/admin/backups').loginAs(admin))
      assert.isFalse(page.body().backups.configured)
      const refused = await json(client.post('/admin/backups/runs').loginAs(admin)).json({
        kind: 'download',
      })
      refused.assertStatus(409)
      assert.equal(refused.body().error.code, 'E_BACKUP_NOT_CONFIGURED')
    } finally {
      overrideCloudBackups(configured)
    }
  })
  test('backup:seal and backup:open turn a snapshot into an archive and back', async ({
    assert,
  }) => {
    const { default: ace } = await import('@adonisjs/core/services/ace')
    const restoreEnv = setEnv({ BACKUP_ENCRYPTION_KEY: key.toString('base64') })
    const snapshot = join(directory, `command-${unique}`)
    const file = join(directory, `command-${unique}.adulabackup`)
    const opened = join(directory, `command-open-${unique}`)
    const wrong = join(directory, `command-wrong-${unique}`)
    // The test does not depend on an earlier test having created the directory.
    await mkdir(directory, { recursive: true })
    try {
      await createSnapshot(snapshot, { workDirectory: directory })
      await writeFile(join(snapshot, 'COMPLETE'), '')
      const sealed = await ace.exec('backup:seal', [`--snapshot=${snapshot}`, `--file=${file}`])
      assert.equal(sealed.exitCode, 0)
      const reopened = await ace.exec('backup:open', [`--file=${file}`, `--snapshot=${opened}`])
      assert.equal(reopened.exitCode, 0)
      assert.isNotNull(await verifySnapshot(opened))
      // The target must be new, and a wrong key leaves nothing behind.
      const again = await ace.exec('backup:open', [`--file=${file}`, `--snapshot=${opened}`])
      assert.notEqual(again.exitCode, 0)
      setEnv({ BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
      const refused = await ace.exec('backup:open', [`--file=${file}`, `--snapshot=${wrong}`])
      assert.notEqual(refused.exitCode, 0)
      assert.isFalse(existsSync(wrong))
    } finally {
      restoreEnv()
      for (const path of [snapshot, file, opened, wrong])
        await rm(path, { recursive: true, force: true })
    }
  })
})
