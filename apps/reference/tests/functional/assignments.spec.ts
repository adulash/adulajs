import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import {
  installSampleResources,
  removeSampleResources,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }
const knex = () => db.connection().getWriteClient()

test.group('Assignments and my tasks over HTTP', (group) => {
  let manager: UiActor
  let clerk: UiActor
  let outsider: UiActor
  let id: number
  let base: string
  group.setup(async () => {
    manager = await seedActor([{ subject: 'ui_samples', action: 'manage' }], {
      fullName: 'مدير القسم',
      level: 0,
    })
    clerk = await seedActor([{ subject: 'ui_samples', action: 'view' }], {
      orgUnitId: manager.orgUnitId,
      fullName: 'موظف الإدخال',
      level: 0,
    })
    outsider = await seedActor([{ subject: 'ui_samples', action: 'manage' }], {
      fullName: 'موظف خارجي',
      level: 0,
    })
    await installSampleResources()
    const saved = await adula().resources.save(
      'ui_samples',
      await adula().actors.load(manager.user.id),
      { title: 'عينة الإسناد', orgUnitId: manager.orgUnitId }
    )
    id = Number(saved.id)
    base = `/resources/ui_samples/${id}`
    return () => removeSampleResources()
  })
  group.each.setup(async () => {
    await knex()('assignments').del()
  })

  test('manager assigns, the clerk completes from my tasks', async ({ client, assert }) => {
    const created = await client
      .post(`${base}/assignments`)
      .loginAs(manager.user)
      .withCsrfToken()
      .headers(json)
      .json({ assigneeId: clerk.user.id, title: 'مراجعة البيانات', dueOn: '2026-10-05' })
    created.assertStatus(201)
    const assignmentId = created.body().data.id

    const page = await client
      .get('/my-tasks')
      .loginAs(clerk.user)
      .header('Accept', 'text/html')
      .withInertia()
    page.assertStatus(200)
    assert.equal(page.body().component, 'work/my_tasks')
    assert.equal(page.body().props.assignments.open, 1)
    assert.equal(page.body().props.assignments.data[0].title, 'مراجعة البيانات')

    const cancelByClerk = await client
      .post(`/my-tasks/${assignmentId}/cancel`)
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
    cancelByClerk.assertStatus(403)
    const done = await client
      .post(`/my-tasks/${assignmentId}/complete`)
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
      .json({ note: 'تمت المراجعة دون ملاحظات' })
    done.assertStatus(200)
    const listed = await client.get(`${base}/assignments`).loginAs(manager.user).headers(json)
    assert.equal(listed.body().data[0].status, 'done')
    // The closing note from the dialog is kept with the task.
    assert.equal(listed.body().data[0].closeReason, 'تمت المراجعة دون ملاحظات')
    // Tabs of the merged My tasks page (#35).
    const closed = await client
      .get('/my-tasks')
      .qs({ tab: 'closed' })
      .loginAs(clerk.user)
      .headers(json)
    assert.equal(closed.body().data[0].id, assignmentId)
    const assigned = await client
      .get('/my-tasks')
      .qs({ tab: 'assigned' })
      .loginAs(clerk.user)
      .headers(json)
    assert.lengthOf(assigned.body().data, 0)
    assert.equal(assigned.body().open, 0)
  })

  test('the my tasks badge counts only tasks on records the user may still open', async ({
    client,
    assert,
  }) => {
    const created = await client
      .post(`${base}/assignments`)
      .loginAs(manager.user)
      .withCsrfToken()
      .headers(json)
      .json({ assigneeId: clerk.user.id, title: 'مهمة على سجل سينتقل' })
    created.assertStatus(201)
    const badge = async () => {
      const page = await client
        .get('/my-tasks')
        .loginAs(clerk.user)
        .header('Accept', 'text/html')
        .withInertia()
      page.assertStatus(200)
      // The badge is a deferred shell prop (#156): the page renders without it, and the
      // client then asks for it alone.
      assert.notProperty(page.body().props, 'openTasks')
      const deferred = await client
        .get('/my-tasks')
        .loginAs(clerk.user)
        .withInertia()
        .header('X-Inertia-Partial-Component', page.body().component)
        .header('X-Inertia-Partial-Data', 'openTasks')
      deferred.assertStatus(200)
      return [deferred.body().props.openTasks, page.body().props.assignments.open]
    }
    assert.deepEqual(await badge(), [1, 1])
    // The record moves to another unit: the clerk can no longer open it or its task.
    await knex()('ui_samples').where('id', id).update({ org_unit_id: outsider.orgUnitId })
    try {
      assert.deepEqual(await badge(), [0, 0])
    } finally {
      await knex()('ui_samples').where('id', id).update({ org_unit_id: manager.orgUnitId })
    }
  })

  test('a read-only user cannot assign and outsiders never see the record tasks', async ({
    client,
  }) => {
    const denied = await client
      .post(`${base}/assignments`)
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
      .json({ assigneeId: manager.user.id, title: 'x' })
    denied.assertStatus(403)
    const hidden = await client.get(`${base}/assignments`).loginAs(outsider.user).headers(json)
    hidden.assertStatus(404)
    const refused = await client
      .post(`${base}/assignments`)
      .loginAs(manager.user)
      .withCsrfToken()
      .headers(json)
      .json({ assigneeId: outsider.user.id, title: 'x' })
    refused.assertStatus(422)
  })
})
