import { test } from '@japa/runner'
import { Assignments, ResourceService } from '../index.js'
import { admin, db, reader, registry, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import {
  addUserProfileColumns,
  outsider as anOutsider,
  seedActor,
  viewer as aViewer,
} from './helpers/actors.js'

const outsider = anOutsider()
const viewer = aViewer()
const actors = new Map([admin, reader, outsider, viewer].map((actor) => [actor.id, actor]))

test.group('Assignments', (group) => {
  let orderId: number
  const service = () => new ResourceService(db, registry)
  const assignments = () => new Assignments(db, service(), { load: async (id) => actors.get(id)! })

  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    await seedActor(admin, { fullName: 'مدير النظام' })
    await seedActor(outsider, { email: 'outsider@example.test', fullName: 'خارجي' })
    await seedActor(viewer, { email: 'viewer@example.test', fullName: 'مشاهدة' })
    const saved = await service().save('orders', admin, { notes: 'طلب للإسناد', orgUnitId: 2 })
    orderId = Number(saved.id)
  })
  group.each.setup(async () => {
    await db('assignments').del()
    await db('notifications').del()
  })

  test('an updater assigns a reader, who sees it in my tasks and completes it', async ({
    assert,
  }) => {
    const created = await assignments().assign('orders', orderId, reader, {
      assigneeId: 4,
      title: 'تدقيق الأسعار',
      dueOn: '2026-10-01',
      note: 'قبل نهاية الأسبوع',
    })
    assert.equal(created.status, 'open')
    assert.equal(created.dueOn, '2026-10-01')
    assert.isTrue(created.canCancel)
    assert.isFalse(created.canComplete)
    const inbox = await db('notifications').where('user_id', 4)
    assert.lengthOf(inbox, 1)
    assert.equal(inbox[0].title, 'مهمة جديدة مسندة إليك')
    assert.deepEqual([inbox[0].resource, inbox[0].record_id], ['orders', orderId])

    const mine = await assignments().mine(viewer)
    assert.equal(mine.open, 1)
    assert.lengthOf(mine.data, 1)
    assert.isTrue(mine.data[0].canComplete)
    assert.equal(mine.data[0].resourceLabel, 'الطلبات')

    await assignments().complete(created.id, viewer)
    const done = await assignments().mine(viewer, { status: 'done' })
    assert.equal(done.data[0].status, 'done')
    const reopened = await assignments().mine(viewer)
    assert.equal(reopened.open, 0)
    const back = await db('notifications').where('user_id', 2)
    assert.equal(back[0].title, 'أُنجزت مهمة أسندتها')
    assert.deepEqual([back[0].resource, back[0].record_id], ['orders', orderId])
    const again = await failure(() => assignments().complete(created.id, viewer))
    assert.equal(again.code, 'E_ASSIGNMENT_CLOSED')
  })

  test('assigning requires update access and an assignee who can read the record', async ({
    assert,
  }) => {
    const readOnly = await failure(() =>
      assignments().assign('orders', orderId, viewer, { assigneeId: 2, title: 'x' })
    )
    assert.equal(readOnly.status, 403)
    const foreign = await failure(() =>
      assignments().assign('orders', orderId, reader, { assigneeId: 3, title: 'x' })
    )
    assert.equal(foreign.code, 'E_ASSIGNEE')
    const badDate = await failure(() =>
      assignments().assign('orders', orderId, reader, {
        assigneeId: 4,
        title: 'x',
        dueOn: '2026-13-45',
      })
    )
    assert.equal(badDate.code, 'E_ASSIGNMENT_DUE')
    const outside = await failure(() =>
      assignments().assign('orders', orderId, outsider, { assigneeId: 2, title: 'x' })
    )
    assert.equal(outside.status, 404)
  })

  test('only the assignee completes and only the assigner cancels', async ({ assert }) => {
    const created = await assignments().assign('orders', orderId, reader, {
      assigneeId: 4,
      title: 'مهمة',
    })
    const wrongCompleter = await failure(() => assignments().complete(created.id, reader))
    assert.equal(wrongCompleter.status, 403)
    const wrongCanceller = await failure(() =>
      assignments().complete(created.id, viewer, 'cancelled')
    )
    assert.equal(wrongCanceller.status, 403)
    const stranger = await failure(() => assignments().complete(created.id, admin))
    assert.equal(stranger.status, 404)
    await assignments().complete(created.id, reader, 'cancelled')
    const [row] = await db('assignments').where('id', created.id)
    assert.equal(row.status, 'cancelled')
  })

  test('tasks on records the assignee can no longer read are hidden', async ({ assert }) => {
    await assignments().assign('orders', orderId, reader, { assigneeId: 4, title: 'مرئية' })
    const other = await service().save('orders', admin, { notes: 'منقول', orgUnitId: 2 })
    await assignments().assign('orders', Number(other.id), reader, {
      assigneeId: 4,
      title: 'ستختفي',
    })
    await db('orders').where('id', Number(other.id)).update({ org_unit_id: 3 })
    const mine = await assignments().mine(viewer)
    assert.deepEqual(
      mine.data.map((entry) => entry.title),
      ['مرئية']
    )
    const recordList = await assignments().forRecord('orders', orderId, admin)
    assert.lengthOf(recordList, 1)
  })

  test('workflow approval assignments cannot be completed as plain tasks', async ({ assert }) => {
    const created = await assignments().create(db, {
      resource: 'orders',
      recordId: orderId,
      assigneeId: 4,
      assignedBy: null,
      title: 'موافقة المدير',
      kind: 'approval',
      workflowRunId: '00000000-0000-4000-8000-000000000001',
      workflowStep: 'manager',
    })
    const error = await failure(() => assignments().complete(created.id, viewer))
    assert.equal(error.code, 'E_ASSIGNMENT_WORKFLOW')
    const inbox = await db('notifications').where('user_id', 4)
    assert.equal(inbox[0].title, 'موافقة مطلوبة منك')
  })

  test('managed tasks close with the record, or by hand only with a note (#51)', async ({
    assert,
  }) => {
    const created = await assignments().create(db, {
      resource: 'orders',
      recordId: orderId,
      assigneeId: 4,
      assignedBy: 2,
      title: 'حل المخالفة',
      managed: true,
    })
    const open = await assignments().mine(viewer)
    const [task] = open.data
    assert.isTrue(task.managed)
    assert.equal(task.closeNote, 'required')
    // A second, manual task on the same record stays under the user's control.
    const manual = await assignments().create(db, {
      resource: 'orders',
      recordId: orderId,
      assigneeId: 4,
      assignedBy: 2,
      title: 'متابعة يدوية',
    })
    // Pressing the button alone never closes managed work: a note is required.
    for (const note of [undefined, '', '   ']) {
      const refused = await failure(() =>
        assignments().complete(created.id, viewer, 'done', { note })
      )
      assert.equal(refused.code, 'E_ASSIGNMENT_NOTE')
      assert.equal(refused.status, 422)
    }

    await db('notifications').del()
    const closed = await db.transaction((trx) =>
      assignments().close('orders', orderId, { actorId: 1, reason: 'قُبل الحل', trx })
    )
    assert.equal(closed, 1)
    const stored = await db('assignments').where('id', created.id).first()
    assert.equal(stored.status, 'done')
    assert.equal(stored.completed_by, 1)
    assert.equal(stored.close_reason, 'قُبل الحل')
    const untouched = await db('assignments').where('id', manual.id).first()
    assert.equal(untouched.status, 'open')
    const activity = await db('activities')
      .where({ resource: 'orders', record_id: orderId, action: 'assignment_closed' })
      .first()
    assert.deepInclude(activity.changes, {
      assignmentId: Number(created.id),
      outcome: 'done',
      reason: 'قُبل الحل',
    })
    const notified = await db('notifications').where('user_id', 2)
    assert.lengthOf(notified, 1, 'the assigner learns that the task closed')
    assert.equal(notified[0].resource, 'orders')
    assert.equal(Number(notified[0].record_id), orderId)
    const closedPage = await assignments().mine(viewer, { status: 'done' })
    const [done] = closedPage.data
    assert.equal(done.closeReason, 'قُبل الحل')
    assert.equal(await assignments().close('orders', orderId, { actorId: 1 }), 0)
    const invalid = await failure(() =>
      assignments().close('orders', orderId, { actorId: 1, outcome: 'lost' as 'done' })
    )
    assert.equal(invalid.code, 'E_ASSIGNMENT_OUTCOME')
  })

  test('each application chooses whether a closing note is optional or required', async ({
    assert,
  }) => {
    const task = () =>
      assignments().create(db, {
        resource: 'orders',
        recordId: orderId,
        assigneeId: 4,
        assignedBy: 2,
        title: 'مراجعة',
      })
    // Default policy: the note is optional and stored when given.
    const first = await task()
    await assignments().complete(first.id, viewer)
    const plain = await db('assignments').where('id', first.id).first()
    assert.isNull(plain.close_reason)
    const second = await task()
    await assignments().complete(second.id, viewer, 'done', { note: ' تمت المراجعة ' })
    const noted = await db('assignments').where('id', second.id).first()
    assert.equal(noted.close_reason, 'تمت المراجعة')
    const tooLong = await failure(() =>
      assignments().complete(second.id, viewer, 'done', { note: 'x'.repeat(501) })
    )
    assert.equal(tooLong.code, 'E_ASSIGNMENT_NOTE')

    const strict = new Assignments(
      db,
      service(),
      { load: async (id) => actors.get(id)! },
      { closeNote: 'required' }
    )
    const third = await task()
    const page = await strict.mine(viewer)
    assert.equal(page.data.find((row) => row.id === Number(third.id))?.closeNote, 'required')
    const refused = await failure(() => strict.complete(third.id, viewer))
    assert.equal(refused.code, 'E_ASSIGNMENT_NOTE')
    const cancel = await failure(() => strict.complete(third.id, reader, 'cancelled'))
    assert.equal(cancel.code, 'E_ASSIGNMENT_NOTE')
    await strict.complete(third.id, reader, 'cancelled', { note: 'لم تعد مطلوبة' })
    const cancelled = await db('assignments').where('id', third.id).first()
    assert.deepEqual([cancelled.status, cancelled.close_reason], ['cancelled', 'لم تعد مطلوبة'])
  })
})
