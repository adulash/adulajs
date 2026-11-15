import { test } from '@japa/runner'
import { crc32, deflateSync } from 'node:zlib'
import {
  AVATAR_LIMITS,
  AdulaError,
  UserAvatars,
  UsersAdmin,
  avatarHeaders,
  avatarUrl,
  avatarUrlFor,
  findAttachment,
  staleUploads,
} from '../index.js'
import { sanitizeAvatarImage } from '../src/core/avatar_image.js'
import { db, setup } from './helpers.js'

function chunk(type: string, data: Buffer = Buffer.alloc(0)) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}
function picture(side = 48) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.alloc(1 + side * 3, 0x40)
  row[0] = 0
  return sanitizeAvatarImage(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: side }, () => row)))),
      chunk('IEND'),
    ])
  )
}

async function failure(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    if (error instanceof AdulaError) return error
    throw error
  }
  throw new Error('expected an AdulaError')
}

test.group('Profile pictures (ADR 050)', (group) => {
  group.each.setup(async () => {
    await setup()
  })

  test('a user replaces and removes their own picture; old rows and files are retired', async ({
    assert,
  }) => {
    const avatars = new UserAvatars(db)
    assert.isNull(await avatars.find(2))
    const first = await avatars.replace({
      userId: 2,
      actorId: 2,
      disk: 'local',
      path: 'avatars/2/first.png',
      image: picture(),
    })
    assert.deepEqual(first.removed, [])
    assert.equal(first.avatar.userId, 2)
    assert.equal(first.avatar.mimeType, 'image/png')
    assert.equal(first.avatar.width, 48)
    const second = await avatars.replace({
      userId: 2,
      actorId: 2,
      disk: 'local',
      path: 'avatars/2/second.png',
      image: picture(64),
    })
    assert.isAbove(second.avatar.version, first.avatar.version)
    // The previous picture is deleted, row and file, so it does not outlive its replacement.
    assert.deepEqual(second.removed, [{ disk: 'local', path: 'avatars/2/first.png' }])
    assert.isUndefined(await db('attachments').where('id', first.avatar.version).first())
    const current = await avatars.find(2)
    assert.equal(current?.version, second.avatar.version)
    assert.deepEqual([...(await avatars.versions([1, 2, 2]))], [[2, second.avatar.version]])

    const removed = await avatars.remove({ userId: 2, actorId: 2 })
    assert.deepEqual(removed, [{ disk: 'local', path: 'avatars/2/second.png' }])
    assert.isNull(await avatars.find(2))
    // Removing again is a no-op and logs nothing.
    assert.deepEqual(await avatars.remove({ userId: 2, actorId: 2 }), [])
    const actions = await db('activities')
      .where({ resource: 'users', record_id: 2 })
      .orderBy('id')
      .pluck('action')
    assert.deepEqual(actions, ['avatar_updated', 'avatar_updated', 'avatar_removed'])
  })

  test('only an administered change may touch another user; impersonation is recorded', async ({
    assert,
  }) => {
    const avatars = new UserAvatars(db)
    const refused = await failure(() =>
      avatars.replace({
        userId: 1,
        actorId: 2,
        disk: 'local',
        path: 'avatars/1/x.png',
        image: picture(),
      })
    )
    assert.equal(refused.status, 403)
    const foreign = await failure(() => avatars.remove({ userId: 1, actorId: 2 }))
    assert.equal(foreign.status, 403)
    assert.isNull(await avatars.find(1))
    const missing = await failure(() =>
      avatars.remove({ userId: 999, actorId: 1, administered: true })
    )
    assert.equal(missing.status, 404)

    await avatars.replace({
      userId: 2,
      actorId: 1,
      administered: true,
      disk: 'local',
      path: 'avatars/2/by-admin.png',
      image: picture(),
    })
    const entry = await db('activities').where({ resource: 'core.users', record_id: 2 }).first()
    assert.equal(entry.action, 'avatar_updated')
    assert.equal(entry.actor_id, 1)

    await avatars.replace({
      userId: 2,
      actorId: 2,
      impersonatorId: 1,
      disk: 'local',
      path: 'avatars/2/acting.png',
      image: picture(),
    })
    const acting = await db('activities')
      .where({ resource: 'users', record_id: 2, action: 'avatar_updated' })
      .first()
    assert.equal(acting.changes.impersonatedBy, 1)
  })

  test('a picture is a bound file: never pruned, never served as an attachment', async ({
    assert,
  }) => {
    const avatars = new UserAvatars(db)
    const { avatar } = await avatars.replace({
      userId: 2,
      actorId: 2,
      disk: 'local',
      path: 'avatars/2/kept.png',
      image: picture(),
    })
    const row = await findAttachment(db, avatar.version)
    assert.equal(row?.resource, 'core_users')
    assert.equal(row?.field, 'avatar')
    assert.equal(row?.recordId, 2)
    assert.equal(row?.originalName, 'avatar.png')
    await db('attachments')
      .where('id', avatar.version)
      .update({ created_at: new Date(0) })
    assert.deepEqual(await staleUploads(db, new Date()), [])
  })

  test('people payloads carry the picture from the same query, and null without one', async ({
    assert,
  }) => {
    // The host owns the users table; the administration list reads these columns.
    await db.raw(
      'ALTER TABLE users ADD COLUMN full_name varchar, ADD COLUMN disabled_at timestamptz'
    )
    const { avatar } = await new UserAvatars(db).replace({
      userId: 2,
      actorId: 2,
      disk: 'local',
      path: 'avatars/2/listed.png',
      image: picture(),
    })
    const users = new UsersAdmin(db)
    const urls = async () => {
      const page = await users.list()
      return new Map(page.data.map((user) => [user.id, user.avatarUrl]))
    }
    const first = await urls()
    // No picture: null, so the page shows initials and never requests one (no 404).
    assert.isNull(first.get(1))
    assert.equal(first.get(2), `/users/2/avatar?v=${avatar.version}`)

    // The picture comes from the query that reads the names: more people, no more queries.
    const count = async () => {
      let queries = 0
      const listener = () => queries++
      db.on('query', listener)
      try {
        await users.list()
      } finally {
        db.off('query', listener)
      }
      return queries
    }
    const few = await count()
    await db('users').insert(
      Array.from({ length: 6 }, (_, index) => ({
        id: index + 3,
        email: `listed-${index}@example.test`,
      }))
    )
    assert.equal(await count(), few)
    const many = await urls()
    assert.equal(many.size, 8)
    assert.equal([...many.values()].filter(Boolean).length, 1)
  })

  test('URLs and headers', ({ assert }) => {
    assert.equal(avatarUrl(7), '/users/7/avatar')
    assert.equal(avatarUrl(7, 42), '/users/7/avatar?v=42')
    assert.equal(avatarUrlFor(7, 42), '/users/7/avatar?v=42')
    for (const missing of [null, undefined, 0, 'x'])
      assert.isNull(avatarUrlFor(7, missing), String(missing))
    assert.isNull(avatarUrlFor(null, 42))
    const avatar = {
      userId: 7,
      version: 42,
      disk: 'local',
      path: 'avatars/7/a.webp',
      size: 900,
      mimeType: 'image/webp',
      width: 64,
      height: 64,
    }
    const headers = avatarHeaders(avatar)
    assert.equal(headers['Content-Type'], 'image/webp')
    assert.equal(headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(headers['Content-Security-Policy'], "default-src 'none'; sandbox")
    assert.equal(headers['Cache-Control'], 'private, max-age=300')
    assert.equal(headers.ETag, '"avatar-42"')
    assert.equal(
      avatarHeaders(avatar, { immutable: true })['Cache-Control'],
      'private, max-age=31536000, immutable'
    )
    // Only the two allow-listed types are ever sent.
    assert.equal(avatarHeaders({ ...avatar, mimeType: 'text/html' })['Content-Type'], 'image/png')
    assert.equal(AVATAR_LIMITS.maxSide, 512)
  })
})
