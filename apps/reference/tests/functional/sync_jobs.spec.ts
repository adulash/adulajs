import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { adula } from '#services/adula'

test.group('Background sync jobs', (group) => {
  let admin: User
  let member: User
  const unique = randomUUID().replaceAll('-', '').slice(0, 10)
  const knex = () => db.connection().getWriteClient()
  const asJson = (request: ApiRequest) =>
    request.withCsrfToken().header('Accept', 'application/json')
  const runPath = (name: string) => `/admin/jobs/sync/${encodeURIComponent(name)}/run`

  group.setup(async () => {
    admin = await User.create({
      fullName: 'مدير المزامنة',
      email: `sync-admin-${unique}@example.test`,
      password: 'test-only-password-123',
    })
    member = await User.create({
      fullName: 'عضو المزامنة',
      email: `sync-member-${unique}@example.test`,
      password: 'test-only-password-123',
    })
    const [org] = await knex()('org_units')
      .insert({ name: 'وحدة المزامنة', type: 'root', path: `sync${unique}` })
      .returning('id')
    const [role] = await knex()('roles')
      .insert({ name: `sync-admin-${unique}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
    await knex()('user_roles').insert({ user_id: admin.id, role_id: role.id })
    await knex()('user_org_units').insert([
      { user_id: admin.id, org_unit_id: org.id },
      { user_id: member.id, org_unit_id: org.id },
    ])
    await knex()('sync_job_runs')
      .whereIn('job', ['sync:fixture-customers', 'sync:fixture-failing'])
      .del()
  })

  test('an administrator runs the fixture job now and the worker writes the record', async ({
    client,
    assert,
  }) => {
    const refused = await asJson(client.post(runPath('sync:fixture-customers')).loginAs(member))
    refused.assertStatus(403)
    assert.isUndefined(await knex()('sync_job_runs').where('job', 'sync:fixture-customers').first())

    const queued = await asJson(client.post(runPath('sync:fixture-customers')).loginAs(admin))
    queued.assertStatus(200)
    assert.equal(queued.body().data.status, 'queued')
    assert.equal(queued.body().data.trigger, 'manual')
    assert.equal(queued.body().data.requestedBy, admin.id)
    // A second click while the run waits is refused.
    const again = await asJson(client.post(runPath('sync:fixture-customers')).loginAs(admin))
    again.assertStatus(409)
    assert.equal(again.body().error.code, 'E_SYNC_JOB_BUSY')
    const activity = await knex()('activities')
      .where({ resource: 'core.jobs', action: 'sync.run', actor_id: admin.id })
      .first()
    assert.equal(activity.changes.job, 'sync:fixture-customers')

    const listed = await client
      .get('/admin/jobs')
      .loginAs(admin)
      .header('Accept', 'application/json')
    listed.assertStatus(200)
    const before = listed
      .body()
      .syncJobs.find((job: { name: string }) => job.name === 'sync:fixture-customers')
    assert.isTrue(before.busy)
    assert.equal(before.label.ar, 'مزامنة العملاء التجريبية')
    assert.equal(before.cron, '0 3 * * *')
    assert.exists(before.nextRunAt)

    // The worker tick drains queued runs one at a time.
    let run = await adula().syncJobs.runNext()
    while (run && run.id !== queued.body().data.id) run = await adula().syncJobs.runNext()
    assert.equal(run?.status, 'succeeded')
    assert.deepEqual(run?.stats, { created: 1 })
    const customer = await knex()('customers').where('name', `عميل مزامنة ${run!.id}`).first()
    assert.exists(customer)
    assert.equal(customer.created_by, admin.id)

    const page = await client.get('/admin/jobs').loginAs(admin).header('Accept', 'application/json')
    const after = page
      .body()
      .syncJobs.find((job: { name: string }) => job.name === 'sync:fixture-customers')
    assert.isFalse(after.busy)
    assert.equal(after.lastRun.status, 'succeeded')
    assert.exists(after.lastSuccessAt)
    const history = await client
      .get('/admin/jobs/sync/sync:fixture-customers/runs')
      .loginAs(admin)
      .header('Accept', 'application/json')
    history.assertStatus(200)
    assert.equal(history.body().data[0].id, run!.id)
    assert.equal(history.body().data[0].status, 'succeeded')
    const hidden = await client
      .get('/admin/jobs/sync/sync:fixture-customers/runs')
      .loginAs(member)
      .header('Accept', 'application/json')
    hidden.assertStatus(403)
  })

  test('the failing fixture records its error category on the jobs page', async ({
    client,
    assert,
  }) => {
    const queued = await asJson(client.post(runPath('sync:fixture-failing')).loginAs(admin))
    queued.assertStatus(200)
    let run = await adula().syncJobs.runNext()
    while (run && run.id !== queued.body().data.id) run = await adula().syncJobs.runNext()
    assert.equal(run?.status, 'failed')
    assert.equal(run?.errorCategory, 'validation')
    assert.include(run!.errorMessage!, 'name')
    const page = await client.get('/admin/jobs').loginAs(admin).header('Accept', 'application/json')
    const failing = page
      .body()
      .syncJobs.find((job: { name: string }) => job.name === 'sync:fixture-failing')
    assert.equal(failing.lastErrorCategory, 'validation')
    assert.equal(failing.lastRun.status, 'failed')
    assert.isNull(failing.lastSuccessAt)
    const unknown = await asJson(client.post(runPath('sync:missing')).loginAs(admin))
    unknown.assertStatus(404)
    const malformed = await asJson(client.post('/admin/jobs/sync/backup/run').loginAs(admin))
    malformed.assertStatus(404)
  })
})
