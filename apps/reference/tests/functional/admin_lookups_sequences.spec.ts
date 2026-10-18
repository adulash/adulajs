import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { adula } from '#services/adula'

test.group('Lookup and sequence administration screens', (group) => {
  let admin: User
  let member: User
  let rootId: number
  const unique = randomUUID().replaceAll('-', '').slice(0, 10)
  const lookupGroup = `wave_${unique}`
  const sequenceKey = `W${unique.toUpperCase()}`
  const knex = () => db.connection().getWriteClient()
  const password = 'test-only-password-123'
  const asJson = (request: ApiRequest) =>
    request.withCsrfToken().header('Accept', 'application/json')
  const asForm = (request: ApiRequest, referer: string) =>
    request
      .withCsrfToken()
      .header('Accept', 'text/html')
      .header('Referer', referer)
      .withInertia()
      .redirects(0)

  group.setup(async () => {
    admin = await User.create({
      fullName: 'مدير القوائم',
      email: `lookups-admin-${unique}@example.test`,
      password,
    })
    member = await User.create({
      fullName: 'عضو عادي',
      email: `lookups-member-${unique}@example.test`,
      password,
    })
    const [root] = await knex()('org_units')
      .insert({ name: 'جذر القوائم', type: 'root', path: `lk${unique}` })
      .returning('id')
    rootId = root.id
    const [role] = await knex()('roles')
      .insert({ name: `lookups-admin-${unique}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
    await knex()('user_roles').insert({ user_id: admin.id, role_id: role.id })
    await knex()('user_org_units').insert([
      { user_id: admin.id, org_unit_id: rootId },
      { user_id: member.id, org_unit_id: rootId },
    ])
    await knex()('sequences').insert({ key: sequenceKey, value: 41 })
  })

  test('a user without administration rights is refused on every new route', async ({
    client,
    assert,
  }) => {
    const [value] = await knex()('lookups')
      .insert({
        group: lookupGroup,
        key: 'guarded',
        label_ar: 'محمية',
        label_en: 'Guarded',
      })
      .returning('id')
    const requests: [string, (path: string) => ApiRequest, string][] = [
      ['get', (path) => client.get(path), '/admin/lookups'],
      ['post', (path) => client.post(path), '/admin/lookups'],
      ['patch', (path) => client.patch(path), `/admin/lookups/${value.id}`],
      ['post', (path) => client.post(path), `/admin/lookups/${value.id}/disable`],
      ['post', (path) => client.post(path), `/admin/lookups/${value.id}/enable`],
      ['put', (path) => client.put(path), `/admin/lookups/groups/${lookupGroup}/order`],
      ['delete', (path) => client.delete(path), `/admin/lookups/${value.id}`],
      ['get', (path) => client.get(path), '/admin/sequences'],
      ['patch', (path) => client.patch(path), `/admin/sequences/${sequenceKey}`],
    ]
    for (const [verb, request, path] of requests) {
      const response = await asJson(request(path).loginAs(member)).json({
        group: lookupGroup,
        key: 'intruder',
        labelAr: 'دخيل',
        labelEn: 'x',
        ids: [value.id],
        next: 999,
      })
      assert.equal(response.status(), 403, `${verb.toUpperCase()} ${path}`)
    }
    const page = await client
      .get('/admin/lookups')
      .loginAs(member)
      .header('Accept', 'text/html')
      .withInertia()
    page.assertStatus(403)
    assert.equal(page.body().component, 'admin/forbidden')
    const row = await knex()('lookups').where('id', value.id).first()
    assert.deepInclude(row, { label_ar: 'محمية', active: true })
    assert.notExists(await knex()('lookups').where({ group: lookupGroup, key: 'intruder' }).first())
    const sequence = await knex()('sequences').where('key', sequenceKey).first()
    assert.equal(String(sequence.value), '41')
    await knex()('lookups').where('id', value.id).delete()
  })

  test('administrators create, edit, reorder, disable, enable and delete lookup values', async ({
    client,
    assert,
  }) => {
    const created = await asJson(client.post('/admin/lookups').loginAs(admin)).json({
      group: lookupGroup,
      key: 'low',
      labelAr: 'منخفضة',
    })
    created.assertStatus(200)
    assert.deepInclude(created.body().data, { key: 'low', labelEn: 'low', sort: 0, usage: 0 })
    const invalid = await asJson(client.post('/admin/lookups').loginAs(admin)).json({
      group: lookupGroup,
      key: 'Not A Slug',
      labelAr: 'خطأ',
    })
    invalid.assertStatus(422)
    // The Inertia form gets a flash and lands on the new value's group.
    const form = await asForm(client.post('/admin/lookups').loginAs(admin), '/admin/lookups').json({
      group: lookupGroup,
      key: 'high',
      labelAr: 'عالية',
      labelEn: 'High',
    })
    assert.oneOf(form.status(), [302, 303])
    assert.equal(form.header('location'), `/admin/lookups?group=${lookupGroup}`)
    assert.equal(form.flashMessage('success'), 'تمت إضافة القيمة')
    const duplicate = await asForm(
      client.post('/admin/lookups').loginAs(admin),
      '/admin/lookups'
    ).json({ group: lookupGroup, key: 'high', labelAr: 'مكررة' })
    assert.include(String(duplicate.flashMessage('error')), 'موجود')

    const listed = await asJson(client.get(`/admin/lookups?group=${lookupGroup}`).loginAs(admin))
    listed.assertStatus(200)
    const values = listed.body().data as { id: number; key: string }[]
    assert.deepEqual(
      values.map((value) => value.key),
      ['low', 'high']
    )
    const page = await client
      .get(`/admin/lookups?group=${lookupGroup}`)
      .loginAs(admin)
      .header('Accept', 'text/html')
      .withInertia()
    page.assertStatus(200)
    assert.equal(page.body().component, 'admin/lookups/index')
    assert.equal(page.body().props.group, lookupGroup)
    assert.lengthOf(page.body().props.values, 2)
    assert.exists(
      page.body().props.groups.find((entry: { group: string }) => entry.group === lookupGroup)
    )

    const [low, high] = values
    const edited = await asJson(client.patch(`/admin/lookups/${low.id}`).loginAs(admin)).json({
      labelAr: 'منخفضة جداً',
      labelEn: 'Very low',
    })
    edited.assertStatus(200)
    assert.deepInclude(edited.body().data, { labelAr: 'منخفضة جداً', labelEn: 'Very low' })
    const rekey = await asJson(client.patch(`/admin/lookups/${low.id}`).loginAs(admin)).json({
      key: 'renamed',
    })
    rekey.assertStatus(422)
    assert.equal(rekey.body().error?.code ?? rekey.body().code, 'E_LOOKUP_KEY_IMMUTABLE')

    const reordered = await asJson(
      client.put(`/admin/lookups/groups/${lookupGroup}/order`).loginAs(admin)
    ).json({ ids: [high.id, low.id] })
    reordered.assertStatus(200)
    assert.deepEqual(
      reordered.body().data.map((value: { key: string }) => value.key),
      ['high', 'low']
    )
    const partial = await asJson(
      client.put(`/admin/lookups/groups/${lookupGroup}/order`).loginAs(admin)
    ).json({ ids: [high.id] })
    partial.assertStatus(422)

    const disabled = await asForm(
      client.post(`/admin/lookups/${low.id}/disable`).loginAs(admin),
      `/admin/lookups?group=${lookupGroup}`
    )
    assert.equal(disabled.flashMessage('success'), 'تم تعطيل القيمة')
    const stored = await knex()('lookups').where('id', low.id).first()
    assert.isFalse(stored.active)
    const enabled = await asJson(client.post(`/admin/lookups/${low.id}/enable`).loginAs(admin))
    enabled.assertStatus(200)
    assert.isTrue(enabled.body().data.active)

    const removed = await asJson(client.delete(`/admin/lookups/${high.id}`).loginAs(admin))
    removed.assertStatus(200)
    assert.notExists(await knex()('lookups').where('id', high.id).first())

    const actions = await knex()('activities')
      .where({ resource: 'core.lookups', actor_id: admin.id })
      .whereIn('record_id', [low.id, high.id])
      .orderBy('id')
      .select('action', 'record_id')
    assert.includeMembers(
      actions.map((row) => `${row.action}:${row.record_id}`),
      [
        `create:${low.id}`,
        `create:${high.id}`,
        `update:${low.id}`,
        `reorder:${low.id}`,
        `reorder:${high.id}`,
        `disable:${low.id}`,
        `enable:${low.id}`,
        `delete:${high.id}`,
      ]
    )
  })

  test('a value stored by a record cannot be disabled or deleted', async ({ client, assert }) => {
    const created = await asJson(client.post('/admin/lookups').loginAs(admin)).json({
      group: 'order_status',
      key: `w${unique}`,
      labelAr: 'قيد المراجعة',
    })
    created.assertStatus(200)
    const id = created.body().data.id as number
    const runtime = adula()
    const actor = await runtime.actors.load(admin.id)
    await runtime.resources.save('orders', actor, { orgUnitId: rootId, status: `w${unique}` })

    const refused = await asJson(client.post(`/admin/lookups/${id}/disable`).loginAs(admin))
    refused.assertStatus(409)
    const form = await asForm(
      client.post(`/admin/lookups/${id}/disable`).loginAs(admin),
      '/admin/lookups?group=order_status'
    )
    assert.oneOf(form.status(), [302, 303])
    assert.include(String(form.flashMessage('error')), 'محفوظة في 1 سجل')
    const deleted = await asJson(client.delete(`/admin/lookups/${id}`).loginAs(admin))
    deleted.assertStatus(409)
    const row = await knex()('lookups').where('id', id).first()
    assert.isTrue(row.active)
    const listed = await asJson(client.get('/admin/lookups?group=order_status').loginAs(admin))
    const value = listed.body().data.find((entry: { id: number }) => entry.id === id)
    assert.equal(value.usage, 1)
  })

  test('administrators move a sequence forward only, with an audit row', async ({
    client,
    assert,
  }) => {
    const listed = await asJson(client.get('/admin/sequences').loginAs(admin))
    listed.assertStatus(200)
    const row = listed.body().data.find((entry: { key: string }) => entry.key === sequenceKey)
    assert.deepInclude(row, { value: '41', next: `${sequenceKey}-000042` })
    const ord = listed.body().data.find((entry: { key: string }) => entry.key === 'ORD')
    assert.deepInclude(ord.fields[0], { resource: 'orders', field: 'number' })

    const backward = await asJson(
      client.patch(`/admin/sequences/${sequenceKey}`).loginAs(admin)
    ).json({ next: 10 })
    backward.assertStatus(422)
    const missing = await asJson(client.patch('/admin/sequences/NOPE_MISSING').loginAs(admin)).json(
      { next: 10 }
    )
    missing.assertStatus(404)
    const backwardForm = await asForm(
      client.patch(`/admin/sequences/${sequenceKey}`).loginAs(admin),
      '/admin/sequences'
    ).json({ next: 5 })
    assert.include(String(backwardForm.flashMessage('error')), 'لا يمكن إرجاع الترقيم')

    const moved = await asJson(client.patch(`/admin/sequences/${sequenceKey}`).loginAs(admin)).json(
      { next: 500 }
    )
    moved.assertStatus(200)
    assert.deepInclude(moved.body().data, { value: '499', next: `${sequenceKey}-000500` })
    const form = await asForm(
      client.patch(`/admin/sequences/${sequenceKey}`).loginAs(admin),
      '/admin/sequences'
    ).json({ next: '700' })
    assert.equal(form.flashMessage('success'), 'تم ضبط الرقم التالي')
    const sequence = await knex()('sequences').where('key', sequenceKey).first()
    assert.equal(String(sequence.value), '699')

    const audits = await knex()('activities')
      .where({ resource: 'core.sequences', actor_id: admin.id })
      .orderBy('id')
    assert.deepEqual(
      audits.map((audit) => [audit.record_id, audit.action, audit.changes]),
      [
        [
          0,
          'adjust',
          { key: sequenceKey, from: `${sequenceKey}-000042`, to: `${sequenceKey}-000500` },
        ],
        [
          0,
          'adjust',
          { key: sequenceKey, from: `${sequenceKey}-000500`, to: `${sequenceKey}-000700` },
        ],
      ]
    )
    const page = await client
      .get('/admin/sequences')
      .loginAs(admin)
      .header('Accept', 'text/html')
      .withInertia()
    page.assertStatus(200)
    assert.equal(page.body().component, 'admin/sequences/index')
    assert.exists(
      page.body().props.sequences.find((entry: { key: string }) => entry.key === sequenceKey)
    )
  })
})
