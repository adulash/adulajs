import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import knex, { type Knex } from 'knex'
import { ActorStore, RecordCollaboration, ResourceService } from '../index.js'
import { withdrawDeletedCommentNotifications } from '../src/database/schema.js'
import { admin, db, reader, registry, setup, testConnection } from './helpers.js'
import { failure } from './helpers/failure.js'
import {
  addUserProfileColumns,
  outsider as anOutsider,
  powerless,
  seedActor,
  viewer as aViewer,
} from './helpers/actors.js'

/**
 * A pool of two connections that gives up after three seconds: code that holds a
 * transaction and asks the pool for another connection deadlocks against its siblings
 * once enough of them run at the same time, and fails here instead of hanging.
 */
function smallPool(): Knex {
  return knex({
    client: 'pg',
    connection: testConnection,
    pool: { min: 0, max: 2 },
    acquireConnectionTimeout: 3000,
    searchPath: ['adula_test', 'public'],
  })
}

/**
 * Grants users 2 and 4 an orders view role and membership of unit 1.2 (orders are scoped:
 * a reader must belong to the record's unit or an ancestor), so ActorStore loads real rules.
 */
async function seedOrderReaders() {
  const members = await db('user_org_units')
    .insert([
      { user_id: 2, org_unit_id: 2 },
      { user_id: 4, org_unit_id: 2 },
    ])
    .onConflict()
    .ignore()
    .returning(['user_id', 'org_unit_id'])
  const [role] = await db('roles')
    .insert({ name: `orders-readers-${randomUUID()}` })
    .returning('id')
  await db('role_rules').insert({ role_id: role.id, subject: 'orders', action: 'view' })
  await db('user_roles').insert([
    { user_id: 2, role_id: role.id },
    { user_id: 4, role_id: role.id },
  ])
  return async () => {
    await db('user_roles').where('role_id', role.id).del()
    await db('role_rules').where('role_id', role.id).del()
    await db('roles').where('id', role.id).del()
    // Only the memberships this seed added; existing ones stay.
    for (const member of members) await db('user_org_units').where(member).del()
  }
}

/** A user in a sibling organization: can use orders, but not records of unit 1.2. */
const outsider = anOutsider()
/** Can read orders in 1.2 but not update them, and never the total field. */
const viewer = aViewer()
const actors = new Map([admin, reader, outsider, viewer].map((actor) => [actor.id, actor]))

test.group('Record collaboration', (group) => {
  let orderId: number
  const service = () => new ResourceService(db, registry)
  const collaboration = () =>
    new RecordCollaboration(db, service(), { load: async (id) => actors.get(id)! })

  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    await seedActor(admin, { fullName: 'مدير النظام' })
    await seedActor(reader, { fullName: 'سارة القارئة' })
    await seedActor(outsider, { email: 'outsider@example.test', fullName: 'خالد الخارجي' })
    await seedActor(viewer, { email: 'viewer@example.test', fullName: 'منى المشاهدة' })
    await seedActor(
      { id: 5 },
      {
        email: 'disabled@example.test',
        fullName: 'معطل',
        disabled: true,
      }
    )
    const saved = await service().save('orders', admin, {
      notes: 'طلب للتعاون',
      total: 1500,
      orgUnitId: 2,
    })
    orderId = Number(saved.id)
  })
  group.each.setup(async () => {
    await db('comment_mentions').del()
    await db('notification_deliveries').del()
    await db('notifications').del()
    await db('comments').del()
    await db('followers').del()
    await db('taggables').del()
    await db('user_notification_channels').del()
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

  test('simultaneous comments never wait for a second connection while in a transaction', async ({
    assert,
  }) => {
    const small = smallPool()
    const cleanup = await seedOrderReaders()
    try {
      // Everything runs on the two-connection pool, including the real actor store.
      const store = new ActorStore(small, registry)
      const shared = new RecordCollaboration(small, new ResourceService(small, registry), store)
      // One author who already follows, so who follows never depends on timing.
      await db('followers').insert(
        [1, 2, 4, 3].map((userId) => ({ resource: 'orders', record_id: orderId, user_id: userId }))
      )
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, index) =>
          shared.comment('orders', orderId, admin, { body: `تعليق متزامن ${index}`, mentions: [2] })
        )
      )
      assert.deepEqual(
        results.map((result) => (result.status === 'rejected' ? String(result.reason) : 'ok')),
        Array(6).fill('ok')
      )
      const notified = await db('notifications')
        .groupBy('user_id', 'template_key')
        .orderBy('user_id')
        .select('user_id', 'template_key', db.raw('count(*)::int as count'))
      // The outsider (3) follows but cannot read the record; nobody else is left out.
      assert.deepEqual(
        notified.map((row) => [row.user_id, row.template_key, row.count]),
        [
          [2, 'comment.mentioned', 6],
          [4, 'comment.created', 6],
        ]
      )
      const [{ count: unlinked }] = await db('notifications')
        .whereNull('comment_id')
        .count<{ count: string }[]>('* as count')
      assert.equal(Number(unlinked), 0)
    } finally {
      await cleanup()
      await small.destroy()
    }
  })

  test('follower listener checks access on its own transaction under pool pressure', async ({
    assert,
  }) => {
    const small = smallPool()
    const cleanup = await seedOrderReaders()
    try {
      const shared = new RecordCollaboration(
        small,
        new ResourceService(small, registry),
        new ActorStore(small, registry)
      )
      await db('followers').insert(
        [2, 3, 4].map((userId) => ({ resource: 'orders', record_id: orderId, user_id: userId }))
      )
      const listener = shared.followerListener('orders', 'orders', 'updated')
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          small.transaction((trx) =>
            listener.handle(
              { id: randomUUID(), event: listener.event, payload: { id: orderId, actorId: 1 } },
              trx
            )
          )
        )
      )
      assert.deepEqual(
        results.map((result) => (result.status === 'rejected' ? String(result.reason) : 'ok')),
        Array(6).fill('ok')
      )
      const notified = await db('notifications')
        .groupBy('user_id')
        .orderBy('user_id')
        .select('user_id', db.raw('count(*)::int as count'))
      assert.deepEqual(
        notified.map((row) => [row.user_id, row.count]),
        [
          [2, 6],
          [4, 6],
        ]
      )
    } finally {
      await cleanup()
      await small.destroy()
    }
  })

  test('deleting a comment withdraws its text from notifications and their deliveries', async ({
    assert,
  }) => {
    await db('user_notification_channels').insert({
      user_id: 2,
      channel: 'sms',
      enabled: true,
      address: '+966500000000',
      confirmed_at: db.fn.now(),
    })
    await collaboration().follow('orders', orderId, viewer, true)
    const comment = await collaboration().comment('orders', orderId, admin, {
      body: 'الرقم السري 7731',
      mentions: [2],
    })
    const before = await db('notifications').orderBy('user_id').select('*')
    assert.deepEqual(
      before.map((row) => [row.user_id, row.mail_state, Number(row.comment_id)]),
      [
        [2, 'pending', comment.id],
        [4, null, comment.id],
      ]
    )
    for (const row of before) assert.include(`${row.title} ${row.body}`, '7731')
    await collaboration().deleteComment('orders', orderId, comment.id, admin)
    const after = await db('notifications').orderBy('user_id').select('*')
    for (const row of after) {
      assert.notInclude(`${row.title} ${row.body}`, '7731')
      assert.include(row.body, 'حُذف هذا التعليق.')
      assert.isNull(row.read_at)
    }
    // The pending e-mail of the mention is skipped and its SMS delivery withdrawn.
    assert.equal(after[0].mail_state, 'skipped')
    const deliveries = await db('notification_deliveries').select('state', 'error_category')
    assert.deepEqual(deliveries, [{ state: 'skipped', error_category: 'withdrawn' }])
  })

  test('editing a comment replaces the quoted text with a neutral note', async ({ assert }) => {
    await collaboration().follow('orders', orderId, viewer, true)
    const comment = await collaboration().comment('orders', orderId, admin, {
      body: 'نص أول 4410',
      mentions: [2],
    })
    await collaboration().editComment('orders', orderId, comment.id, admin, 'نص ثانٍ 5520')
    const rows = await db('notifications').orderBy('user_id').select('*')
    assert.lengthOf(rows, 2)
    for (const row of rows) {
      assert.notInclude(`${row.title} ${row.body}`, '4410')
      assert.notInclude(`${row.title} ${row.body}`, '5520')
      assert.include(row.body, 'عُدّل هذا التعليق')
    }
    // Editing is not a withdrawal: the mention's e-mail still goes out, with the note.
    assert.equal(rows[0].mail_state, 'pending')
  })

  test('notifications written before they named their comment are withdrawn too', async ({
    assert,
  }) => {
    // Before 2.2.1 a comment and its notifications were written in one transaction
    // without a link: the same created_at and the quoted text identify them.
    const legacy = async (body: string, deleted: boolean) =>
      db.transaction(async (trx) => {
        const [row] = await trx('comments')
          .insert({
            resource: 'orders',
            record_id: orderId,
            author_id: 1,
            body,
            deleted_at: deleted ? trx.fn.now() : null,
          })
          .returning('id')
        await trx('notifications').insert({
          user_id: 4,
          title: 'تعليق جديد على الطلبات',
          body: `مدير النظام: ${body}`,
          template_key: 'comment.created',
          resource: 'orders',
          record_id: orderId,
        })
        return Number(row.id)
      })
    await legacy('حذف قبل الترقية 1111', true)
    const live = await legacy('يحذف بعد الترقية 2222', false)
    await legacy('يبقى كما هو 3333', false)
    // The same text written at another time is a different message and stays.
    await db('notifications').insert({
      user_id: 4,
      title: 'رسالة أخرى',
      body: 'حذف قبل الترقية 1111',
      template_key: 'comment.created',
      resource: 'orders',
      record_id: orderId,
      created_at: db.raw("now() - interval '1 day'"),
    })
    // The migration's pass over comments deleted before it ran.
    await withdrawDeletedCommentNotifications(db)
    // A comment deleted afterwards finds its unlinked notifications the same way.
    await collaboration().deleteComment('orders', orderId, live, admin)
    const bodies = await db('notifications').orderBy('id').pluck('body')
    assert.deepEqual(bodies, [
      'حُذف هذا التعليق.',
      'مدير النظام: حُذف هذا التعليق.',
      'مدير النظام: يبقى كما هو 3333',
      'حذف قبل الترقية 1111',
    ])
  })

  test('tag suggestions only name tags of records the user may view', async ({ assert }) => {
    await collaboration().setTags('orders', orderId, reader, ['سري'])
    const sibling = await service().save('orders', admin, { notes: 'وحدة أخرى', orgUnitId: 3 })
    await collaboration().setTags('orders', Number(sibling.id), anOutsider(), ['عام'])
    const removed = await service().save('orders', admin, { notes: 'سيحذف', orgUnitId: 2 })
    await collaboration().setTags('orders', Number(removed.id), admin, ['محذوف'])
    const shown = await service().show('orders', Number(removed.id), admin)
    await service().transition('orders', Number(removed.id), admin, 'delete', shown.data.version)
    assert.deepEqual(await collaboration().tagOptions('orders', admin), ['سري', 'عام'])
    // Organization scope: each unit sees only its own records' tags.
    assert.deepEqual(await collaboration().tagOptions('orders', viewer), ['سري'])
    assert.deepEqual(await collaboration().tagOptions('orders', outsider), ['عام'])
    // A conditional rule narrows the suggestions as it narrows the list.
    const conditional = aViewer({
      orgPaths: ['1'],
      rules: [{ subject: 'orders', action: 'view', conditions: { notes: 'وحدة أخرى' } }],
    })
    assert.deepEqual(await collaboration().tagOptions('orders', conditional), ['عام'])
    const denied = await failure(() => collaboration().tagOptions('orders', powerless()))
    assert.equal(denied.status, 403)
  })

  test('simultaneous tag saves on one record never fail and the last save wins', async ({
    assert,
  }) => {
    const inputs = Array.from({ length: 12 }, (_, index) => [`وسم${index}`, 'مشترك'])
    const results = await Promise.allSettled(
      inputs.map((tags) => collaboration().setTags('orders', orderId, reader, tags))
    )
    assert.deepEqual(
      results.map((result) => (result.status === 'rejected' ? String(result.reason) : 'ok')),
      Array(12).fill('ok')
    )
    const final = await collaboration().tags('orders', orderId)
    assert.isTrue(inputs.some((tags) => JSON.stringify([...tags].sort()) === JSON.stringify(final)))
    const [{ count }] = await db('taggables')
      .where({ resource: 'orders', record_id: orderId })
      .count<{ count: string }[]>('* as count')
    assert.equal(Number(count), 2)
  })
})
