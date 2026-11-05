import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import { pageFor } from '#controllers/resources_controller'
import {
  installSampleResources,
  removeSampleResources,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

const html = { Accept: 'text/html' }

test.group('Generic resource page integration', (group) => {
  let actor: UiActor
  let customerId: number
  group.setup(async () => {
    actor = await seedActor([
      { subject: 'customers', action: 'manage' },
      { subject: 'tasks', action: 'view' },
    ])
  })

  test('index, create, show and edit receive their complete typed view with current navigation', async ({
    client,
    assert,
  }) => {
    const created = await client
      .post('/resources/customers')
      .loginAs(actor.user)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ name: `عميل الصفحات ${randomUUID()}`, email: 'pages@example.test' })
    created.assertStatus(201)
    customerId = created.body().data.id
    for (const [path, mode] of [
      ['/resources/customers', 'index'],
      ['/resources/customers/create', 'form'],
      [`/resources/customers/${customerId}`, 'show'],
      [`/resources/customers/${customerId}/edit`, 'form'],
    ] as const) {
      const response = await client.get(path).loginAs(actor.user).headers(html).withInertia()
      response.assertStatus(200)
      const page = response.body()
      assert.equal(page.component, 'resources/page')
      assert.equal(page.props.view.mode, mode)
      assert.sameMembers(
        page.props.navigation.map((entry: { name: string }) => entry.name),
        ['customers', 'tasks']
      )
      if (mode === 'form') {
        assert.equal(page.props.view.editor.name, 'customers')
        assert.isArray(page.props.view.editor.fields)
        assert.equal(page.props.view.permissions.update, path.endsWith('/edit') ? true : undefined)
      } else {
        assert.equal(page.props.view.resource.name, 'customers')
        assert.deepEqual(page.props.view.lookups, {})
      }
      if (mode === 'index') {
        assert.isArray(page.props.result.data)
        assert.deepEqual(page.scrollProps.result, {
          pageName: 'cursor',
          currentPage: null,
          nextPage: null,
          previousPage: null,
          reset: false,
        })
      }
      if (mode === 'show') {
        assert.equal(page.props.view.result.data.id, customerId)
        assert.deepEqual(page.props.view.childResources, {})
        // Both sections arrive in one deferred request (#31); the shell's «مهامي» count is
        // deferred in its own default group (#156, ADR 049).
        assert.deepEqual(page.deferredProps, {
          default: ['openTasks'],
          details: ['childrenData', 'activity'],
        })
        assert.notProperty(page.props, 'activity')
      }
    }
  })

  test('the deferred activity prop lists the record mutations for the authorized actor', async ({
    client,
    assert,
  }) => {
    const response = await client
      .get(`/resources/customers/${customerId}`)
      .loginAs(actor.user)
      .headers(html)
      .withInertiaPartialReload('resources/page', ['activity'])
    response.assertStatus(200)
    const activity = response.body().props.activity
    assert.lengthOf(activity, 1)
    assert.equal(activity[0].action, 'create')
    assert.equal(activity[0].actorName, actor.user.fullName)
    assert.isNull(activity[0].actorEmail)
    assert.sameMembers(activity[0].fields, ['name', 'email'])
    assert.match(activity[0].createdAt, /^\d{4}-\d{2}-\d{2}T/)
  })

  test('index pages merge the next keyset page into result.data through the scroll prop', async ({
    client,
    assert,
  }) => {
    const unique = randomUUID()
    for (const index of [1, 2, 3]) {
      const created = await client
        .post('/resources/customers')
        .loginAs(actor.user)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json({ name: `عميل التمرير ${index} ${unique}` })
      created.assertStatus(201)
    }
    const first = await client
      .get('/resources/customers?limit=2')
      .loginAs(actor.user)
      .headers(html)
      .withInertia()
    first.assertStatus(200)
    const cursor = first.body().scrollProps.result.nextPage
    assert.isString(cursor)
    assert.lengthOf(first.body().props.result.data, 2)
    const next = await client
      .get(`/resources/customers?limit=2&cursor=${encodeURIComponent(cursor)}`)
      .loginAs(actor.user)
      .headers({ ...html, 'X-Inertia-Infinite-Scroll-Merge-Intent': 'append' })
      .withInertiaPartialReload('resources/page', ['result'])
    next.assertStatus(200)
    const page = next.body()
    assert.include(page.mergeProps, 'result.data')
    assert.include(page.matchPropsOn, 'result.data.id')
    assert.equal(page.scrollProps.result.currentPage, cursor)
    assert.notProperty(page.props, 'view')
    assert.isAtLeast(page.props.result.data.length, 1)
    assert.notDeepEqual(
      page.props.result.data.map((row: { id: number }) => row.id),
      first.body().props.result.data.map((row: { id: number }) => row.id)
    )
  })

  test('partial reloads refresh navigation after role revocation', async ({ client, assert }) => {
    await db
      .connection()
      .getWriteClient()('role_rules')
      .where({ role_id: actor.roleId, subject: 'customers' })
      .delete()
    const response = await client
      .get('/resources/tasks')
      .loginAs(actor.user)
      .headers(html)
      .withInertiaPartialReload('resources/page', ['view'])
    response.assertStatus(200)
    assert.deepEqual(
      response.body().props.navigation.map((entry: { name: string }) => entry.name),
      ['tasks']
    )
  })
})

test.group('Generic pages for scoped and versioned resources', (group) => {
  let admin: UiActor
  let orderId: number
  let sampleId: number
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }])
    await installSampleResources()
    const runtime = adula()
    const loaded = await runtime.actors.load(admin.user.id)
    const order = await runtime.resources.save('orders', loaded, {
      orgUnitId: admin.orgUnitId,
      notes: `طلب الصفحات ${randomUUID()}`,
      lines: [{ description: 'بند الصفحات', quantity: 4 }],
    })
    orderId = Number(order.id)
    const sample = await runtime.resources.save('ui_samples', loaded, {
      orgUnitId: admin.orgUnitId,
      title: `عينة الصفحات ${randomUUID()}`,
      lines: [{ item: 'بند العينة', count: 4 }],
    })
    sampleId = Number(sample.id)
    return () => removeSampleResources()
  })

  test('tasks and order lines render every mode through the generic page with relation options', async ({
    client,
    assert,
  }) => {
    for (const name of ['tasks', 'order_lines'] as const) {
      const input =
        name === 'tasks'
          ? { title: `مهمة الصفحات ${randomUUID()}`, orderId, done: false }
          : { orderId, description: `بند ${randomUUID()}`, quantity: 2 }
      const created = await client
        .post(`/resources/${name}`)
        .loginAs(admin.user)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json({ ...input, orgUnitId: admin.orgUnitId })
      created.assertStatus(201)
      const id = created.body().data.id
      for (const [path, mode] of [
        [`/resources/${name}`, 'index'],
        [`/resources/${name}/create`, 'form'],
        [`/resources/${name}/${id}`, 'show'],
        [`/resources/${name}/${id}/edit`, 'form'],
      ] as const) {
        const response = await client.get(path).loginAs(admin.user).headers(html).withInertia()
        response.assertStatus(200)
        const page = response.body()
        assert.equal(page.component, 'resources/page', path)
        assert.equal(page.props.view.mode, mode, path)
        if (mode === 'form') {
          const editor = page.props.view.editor
          assert.equal(editor.scoped, true)
          assert.isArray(editor.options.orderId)
          assert.isTrue(
            editor.options.orderId.some(
              (option: { value: string }) => option.value === String(orderId)
            )
          )
          assert.equal(editor.relationSearch.orderId, true)
          if (path.endsWith('/edit')) {
            assert.equal(editor.record.id, id)
            assert.equal(page.props.view.permissions.delete, true)
            if (name === 'order_lines') assert.equal(editor.record.version, 1)
          }
        }
        if (mode === 'show') {
          assert.equal(page.props.view.result.data.id, id)
          assert.isArray(page.props.view.result.related.orderId)
          assert.equal(page.props.view.result.permissions.update, true)
        }
      }
    }
  })

  test('show pages defer inline children listed in `show` together with their field descriptions', async ({
    client,
    assert,
  }) => {
    const initial = await client
      .get(`/resources/ui_samples/${sampleId}`)
      .loginAs(admin.user)
      .headers(html)
      .withInertia()
    initial.assertStatus(200)
    assert.equal(initial.body().component, 'resources/page')
    assert.equal(initial.body().props.view.childResources.lines.name, 'ui_sample_lines')
    assert.sameMembers(initial.body().props.view.childResources.lines.list, ['item', 'count'])
    assert.deepEqual(initial.body().props.view.lookups, {
      status: [
        { value: 'open', label: 'مفتوح' },
        { value: 'closed', label: 'مغلق' },
      ],
    })
    assert.notProperty(initial.body().props, 'childrenData')
    const deferred = await client
      .get(`/resources/ui_samples/${sampleId}`)
      .loginAs(admin.user)
      .headers(html)
      .withInertiaPartialReload('resources/page', ['childrenData'])
    deferred.assertStatus(200)
    const lines = deferred.body().props.childrenData.lines
    assert.equal(lines.hasMore, false)
    assert.lengthOf(lines.rows, 1)
    assert.equal(lines.rows[0].item, 'بند العينة')
    assert.equal(lines.rows[0].count, 4)
    // Orders keep `lines` out of `show`, so their deferred children stay empty by definition.
    const orders = await client
      .get(`/resources/orders/${orderId}`)
      .loginAs(admin.user)
      .headers(html)
      .withInertiaPartialReload('resources/page', ['childrenData'])
    orders.assertStatus(200)
    assert.deepEqual(orders.body().props.childrenData, {})
  })

  test('a page file per resource and mode overrides the generic page', async ({
    client,
    assert,
  }) => {
    assert.equal(pageFor('orders', 'index'), 'orders/index')
    assert.equal(pageFor('orders', 'form'), 'orders/form')
    assert.equal(pageFor('orders', 'show'), 'resources/page')
    assert.equal(pageFor('customers', 'index'), 'resources/page')
    for (const [path, component] of [
      ['/resources/orders', 'orders/index'],
      ['/resources/orders/create', 'orders/form'],
      [`/resources/orders/${orderId}/edit`, 'orders/form'],
      [`/resources/orders/${orderId}`, 'resources/page'],
    ] as const) {
      const response = await client.get(path).loginAs(admin.user).headers(html).withInertia()
      response.assertStatus(200)
      assert.equal(response.body().component, component, path)
    }
    const index = await client
      .get('/resources/orders')
      .loginAs(admin.user)
      .headers(html)
      .withInertia()
    assert.equal(index.body().props.canCreate, true)
    assert.isArray(index.body().props.result.data)
  })

  test('the record view endpoint serves list dialogs with one read and respects overrides', async ({
    client,
    assert,
  }) => {
    const json = { Accept: 'application/json' }
    const shown = await client
      .get(`/resources/ui_samples/${sampleId}/view`)
      .loginAs(admin.user)
      .headers(json)
    shown.assertStatus(200)
    assert.equal(shown.body().view.mode, 'show')
    assert.equal(shown.body().view.result.data.id, sampleId)
    assert.equal(shown.body().view.childResources.lines.name, 'ui_sample_lines')
    assert.equal(shown.body().childrenData.lines.rows[0].item, 'بند العينة')
    assert.isArray(shown.body().activity)
    const edit = await client
      .get(`/resources/ui_samples/${sampleId}/view`)
      .qs({ mode: 'edit' })
      .loginAs(admin.user)
      .headers(json)
    edit.assertStatus(200)
    assert.equal(edit.body().view.mode, 'form')
    assert.equal(edit.body().view.editor.record.id, sampleId)
    assert.isTrue(edit.body().view.permissions.update)
    // Orders have their own form page; the list navigates there instead of a dialog.
    const override = await client
      .get(`/resources/orders/${orderId}/view`)
      .qs({ mode: 'edit' })
      .loginAs(admin.user)
      .headers(json)
    override.assertStatus(409)
    const outsider = await seedActor([{ subject: 'all', action: 'manage' }])
    const hidden = await client
      .get(`/resources/orders/${orderId}/view`)
      .loginAs(outsider.user)
      .headers(json)
    hidden.assertStatus(404)
  })

  test('the deferred activity route re-authorizes the record', async ({ client }) => {
    const outsider = await seedActor([{ subject: 'all', action: 'manage' }])
    const response = await client
      .get(`/resources/orders/${orderId}`)
      .loginAs(outsider.user)
      .headers(html)
      .withInertiaPartialReload('resources/page', ['activity'])
    response.assertStatus(404)
  })
})

test.group('Navigation and pages follow view permissions', () => {
  test('a user without view on tasks has no tasks entry and receives 403 on its page', async ({
    client,
    assert,
  }) => {
    const limited = await seedActor([{ subject: 'customers', action: 'manage' }])
    const index = await client
      .get('/resources/customers')
      .loginAs(limited.user)
      .headers(html)
      .withInertia()
    index.assertStatus(200)
    assert.deepEqual(
      index.body().props.navigation.map((entry: { name: string }) => entry.name),
      ['customers']
    )
    const tasks = await client
      .get('/resources/tasks')
      .loginAs(limited.user)
      .headers(html)
      .withInertia()
    tasks.assertStatus(403)
    assert.equal(tasks.body().error.code, 'E_FORBIDDEN')
    const create = await client
      .get('/resources/tasks/create')
      .loginAs(limited.user)
      .headers(html)
      .withInertia()
    create.assertStatus(403)
  })
})
