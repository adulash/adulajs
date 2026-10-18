import { test } from '@japa/runner'
import { AdulaError, RecordCollaboration, ResourceService } from '../index.js'
import type { Actor } from '../index.js'
import { admin, db, reader, registry, setup } from './helpers.js'

async function failure(run: () => Promise<unknown>): Promise<AdulaError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof AdulaError) return error
    throw error
  }
  throw new Error('Expected an AdulaError')
}

/** A user in a sibling organization: can use orders, but not records of unit 1.2. */
const outsider: Actor = {
  id: 3,
  orgPaths: ['1.3'],
  permissionLevel: 0,
  rules: [{ subject: 'orders', action: ['view', 'update'] }],
}
/** Can read orders in 1.2 but not update them, and never the total field. */
const viewer: Actor = {
  id: 4,
  orgPaths: ['1.2'],
  permissionLevel: 0,
  rules: [{ subject: 'orders', action: 'view' }],
}
const actors = new Map([admin, reader, outsider, viewer].map((actor) => [actor.id, actor]))

test.group('Record collaboration', (group) => {
  let orderId: number
  const service = () => new ResourceService(db, registry)
  const collaboration = () =>
    new RecordCollaboration(db, service(), { load: async (id) => actors.get(id)! })

  group.setup(async () => {
    await setup()
    await db.raw(
      'ALTER TABLE users ADD COLUMN full_name varchar, ADD COLUMN disabled_at timestamptz'
    )
    await db('users').where('id', 1).update({ full_name: 'مدير النظام' })
    await db('users').where('id', 2).update({ full_name: 'سارة القارئة' })
    await db('users').insert([
      { id: 3, email: 'outsider@example.test', full_name: 'خالد الخارجي' },
      { id: 4, email: 'viewer@example.test', full_name: 'منى المشاهدة' },
      { id: 5, email: 'disabled@example.test', full_name: 'معطل', disabled_at: db.fn.now() },
    ])
    const saved = await service().save('orders', admin, {
      notes: 'طلب للتعاون',
      total: 1500,
      orgUnitId: 2,
    })
    orderId = Number(saved.id)
  })
  group.each.setup(async () => {
    await db('comment_mentions').del()
    await db('comments').del()
    await db('followers').del()
    await db('notifications').del()
    await db('taggables').del()
  })

  test('comments notify mentions and followers who can read the record', async ({ assert }) => {
    await collaboration().follow('orders', orderId, viewer, true)
    const comment = await collaboration().comment('orders', orderId, admin, {
      body: 'يرجى مراجعة الطلب',
      mentions: [2],
    })
    assert.deepEqual(comment.mentions, [{ id: 2, name: 'سارة القارئة' }])
    const notified = await db('notifications')
      .orderBy('user_id')
      .select('user_id', 'title', 'resource', 'record_id')
    assert.deepEqual(
      notified.map((row) => row.user_id),
      [2, 4]
    )
    // Both notifications open the commented record.
    for (const row of notified) assert.deepEqual([row.resource, row.record_id], ['orders', orderId])
    assert.include(notified[0].title, 'أشار إليك مدير النظام')
    assert.include(notified[1].title, 'تعليق جديد')
    // The author follows automatically.
    const state = await collaboration().state('orders', orderId, admin)
    assert.isTrue(state.following)
    assert.equal(state.followers, 2)
    assert.lengthOf(state.comments, 1)
    assert.isTrue(state.comments[0].own)
  })

  test('mentioning a user outside the record scope is refused', async ({ assert }) => {
    const error = await failure(() =>
      collaboration().comment('orders', orderId, admin, { body: 'مرحباً', mentions: [3] })
    )
    assert.equal(error.code, 'E_MENTION')
    const disabled = await failure(() =>
      collaboration().comment('orders', orderId, admin, { body: 'مرحباً', mentions: [5] })
    )
    assert.equal(disabled.code, 'E_MENTION')
    const [{ c: count }] = await db('comments').count('* as c')
    assert.equal(Number(count), 0)
  })

  test('mention candidates are limited to active users who can read the record', async ({
    assert,
  }) => {
    const candidates = await collaboration().mentionCandidates('orders', orderId, admin)
    assert.deepEqual(candidates.map((user) => user.id).sort(), [2, 4])
    const searched = await collaboration().mentionCandidates('orders', orderId, admin, 'منى')
    assert.deepEqual(
      searched.map((user) => user.id),
      [4]
    )
  })

  test('mention search cannot enumerate e-mail addresses or use LIKE wildcards', async ({
    assert,
  }) => {
    const ids = async (term: string) => {
      const candidates = await collaboration().mentionCandidates('orders', orderId, admin, term)
      return candidates.map((user) => user.id)
    }
    // A prefix of the viewer's address no longer reveals that the address exists.
    assert.deepEqual(await ids('viewer'), [])
    assert.deepEqual(await ids('viewer@example'), [])
    // The full address, in any case, finds the user it names.
    assert.deepEqual(await ids('Viewer@Example.TEST'), [4])
    // Wildcards match literally instead of every name or address.
    assert.deepEqual(await ids('%'), [])
    assert.deepEqual(await ids('_'), [])
    assert.deepEqual(await ids('%@example.test'), [])
    assert.deepEqual(await ids('\\'), [])
    // Names still match by substring.
    assert.deepEqual(await ids('المشاهدة'), [4])
  })

  test('mention candidates are found beyond the first page of a large directory', async ({
    assert,
  }) => {
    // 150 active users who cannot read the record sort before every reader.
    const ids = Array.from({ length: 150 }, (_, index) => 1000 + index)
    await db('users').insert(
      ids.map((id) => ({ id, email: `crowd-${id}@example.test`, full_name: `أ ${id}` }))
    )
    for (const id of ids) actors.set(id, { ...outsider, id })
    try {
      const candidates = await collaboration().mentionCandidates('orders', orderId, admin)
      assert.deepEqual(candidates.map((user) => user.id).sort(), [2, 4])
    } finally {
      await db('users').whereIn('id', ids).del()
      for (const id of ids) actors.delete(id)
    }
  })

  test('out-of-scope users cannot read, comment on or follow the record', async ({ assert }) => {
    for (const run of [
      () => collaboration().state('orders', orderId, outsider),
      () => collaboration().comment('orders', orderId, outsider, { body: 'x' }),
      () => collaboration().follow('orders', orderId, outsider, true),
      () => collaboration().setTags('orders', orderId, outsider, ['عاجل']),
    ]) {
      const error = await failure(run)
      assert.equal(error.status, 404)
    }
  })

  test('authors alone edit or delete their comments', async ({ assert }) => {
    const comment = await collaboration().comment('orders', orderId, reader, { body: 'أول' })
    const error = await failure(() =>
      collaboration().editComment('orders', orderId, comment.id, admin, 'تغيير')
    )
    assert.equal(error.status, 404)
    await collaboration().editComment('orders', orderId, comment.id, reader, 'معدّل')
    let state = await collaboration().state('orders', orderId, reader)
    assert.equal(state.comments[0].body, 'معدّل')
    assert.isNotNull(state.comments[0].editedAt)
    await collaboration().deleteComment('orders', orderId, comment.id, reader)
    state = await collaboration().state('orders', orderId, reader)
    assert.lengthOf(state.comments, 0)
  })

  test('tags need update permission and are validated', async ({ assert }) => {
    const denied = await failure(() => collaboration().setTags('orders', orderId, viewer, ['عاجل']))
    assert.equal(denied.status, 403)
    const invalid = await failure(() =>
      collaboration().setTags('orders', orderId, reader, ['<script>'])
    )
    assert.equal(invalid.code, 'E_TAGS')
    const tags = await collaboration().setTags('orders', orderId, reader, ['عاجل', 'VIP', 'عاجل'])
    assert.deepEqual(tags, ['VIP', 'عاجل'])
    const other = await service().save('orders', admin, { notes: 'بلا وسم', orgUnitId: 2 })
    const tagged = await service().list('orders', admin, { tag: 'عاجل' })
    assert.deepEqual(
      tagged.data.map((row) => row.id),
      [orderId]
    )
    assert.notInclude(
      tagged.data.map((row) => Number(row.id)),
      Number(other.id)
    )
    assert.deepEqual(await collaboration().tagOptions('orders', viewer), ['VIP', 'عاجل'])
    assert.deepEqual(await collaboration().setTags('orders', orderId, reader, []), [])
    const viewed = await collaboration().state('orders', orderId, viewer)
    assert.isFalse(viewed.canTag)
  })

  test('field changes are recorded in the save transaction and filtered per viewer', async ({
    assert,
  }) => {
    const before = await service().show('orders', orderId, admin)
    await service().save(
      'orders',
      admin,
      { notes: 'ملاحظة جديدة', total: 2500, internalNote: 'سري', version: before.data.version },
      orderId
    )
    const full = await collaboration().state('orders', orderId, admin)
    const fields = full.changes.map((change) => change.field).sort()
    assert.includeMembers(fields, ['notes', 'total', 'internalNote'])
    const notes = full.changes.find((change) => change.field === 'notes')!
    assert.equal(notes.before, before.data.notes)
    assert.equal(notes.after, 'ملاحظة جديدة')
    assert.equal(notes.actorName, 'مدير النظام')
    // total needs permission level 1 and internalNote is hidden: neither leaks.
    const limited = await collaboration().state('orders', orderId, viewer)
    assert.deepEqual(
      limited.changes.map((change) => change.field),
      ['notes']
    )
  })

  test('follower listener notifies readers of the change, never the actor', async ({ assert }) => {
    await collaboration().follow('orders', orderId, viewer, true)
    await collaboration().follow('orders', orderId, admin, true)
    await db('followers').insert({ resource: 'orders', record_id: orderId, user_id: 3 })
    const listener = collaboration().followerListener('orders', 'orders', 'updated')
    assert.equal(listener.event, 'orders.orders.updated')
    await db.transaction((trx) =>
      listener.handle(
        { id: 'e1', event: listener.event, payload: { id: orderId, actorId: 1 } },
        trx
      )
    )
    const rows = await db('notifications').pluck('user_id')
    // The outsider follows a record it can no longer read: no notification.
    assert.deepEqual(rows, [4])
  })
})
