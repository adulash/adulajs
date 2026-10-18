import { test } from '@japa/runner'
import { BaseModel } from '@adonisjs/lucid/orm'
import {
  ACTOR_ID,
  ResourceRegistry,
  ResourceService,
  RolesAdmin,
  accessibleBy,
  buildAbility,
  canRecord,
  conditionSql,
  createResourceTable,
  defineResource,
  resolveActorConditions,
} from '../index.js'
import type { Actor, RecordData } from '../index.js'
import { db, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns, seedActor } from './helpers/actors.js'

const ticket = defineResource({
  name: 'tickets',
  label: { ar: 'التذاكر', en: 'Tickets' },
  model: BaseModel,
  scoped: true,
  fields: {
    title: { type: 'string', required: true, label: { ar: 'العنوان', en: 'Title' } },
    assignee: {
      type: 'user',
      filterable: true,
      sortable: true,
      label: { ar: 'المكلف', en: 'Assignee' },
    },
  },
  list: ['title', 'assignee'],
  form: ['title', 'assignee'],
  show: ['title', 'assignee'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
  hooks: {
    // Test hook: a record titled this way is moved to unit B.
    beforeSave: async (record) => {
      if (record.title === 'نقل بالخطاف') record.orgUnitId = 3
    },
  },
})
/** Unscoped: shared across the organization. */
const desk = defineResource({
  name: 'desks',
  label: { ar: 'المكاتب', en: 'Desks' },
  model: BaseModel,
  scoped: false,
  fields: {
    code: { type: 'string', required: true, label: { ar: 'الرمز', en: 'Code' } },
    owner: { type: 'user', label: { ar: 'المسؤول', en: 'Owner' } },
  },
  list: ['code', 'owner'],
  form: ['code', 'owner'],
  show: ['code', 'owner'],
  actions: ['view', 'create', 'update'],
  validator: { validate: async (data) => data as RecordData },
})
const registry = new ResourceRegistry().register([
  {
    name: 'support',
    label: { ar: 'الدعم', en: 'Support' },
    dependsOn: [],
    resources: [ticket, desk],
  },
])
/** Works in unit A (path 1.2). */
const agent: Actor = {
  id: 2,
  orgPaths: ['1.2'],
  permissionLevel: 0,
  rules: [{ subject: 'tickets', action: 'manage' }],
}

test.group('User fields', (group) => {
  const service = () => new ResourceService(db, registry)
  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    await seedActor({ id: 1 }, { fullName: 'مدير النظام' })
    await seedActor(agent, { fullName: 'سارة الوكيلة' })
    await seedActor({ id: 3 }, { email: 'sibling@example.test', fullName: 'خالد من الوحدة ب' })
    await seedActor({ id: 4 }, { email: 'root@example.test', fullName: 'منى من الجذر' })
    await seedActor({ id: 5 }, { email: 'disabled@example.test', fullName: 'معطل', disabled: true })
    await seedActor({ id: 6 }, { email: 'child@example.test', fullName: 'علي من الوحدة الفرعية' })
    await db('user_org_units').insert([
      { user_id: 1, org_unit_id: 1 },
      { user_id: 2, org_unit_id: 2 },
      { user_id: 3, org_unit_id: 3 },
      { user_id: 4, org_unit_id: 1 },
      { user_id: 5, org_unit_id: 2 },
      { user_id: 6, org_unit_id: 4 },
    ])
    await createResourceTable(db, ticket)
    await createResourceTable(db, desk)
  })

  test('only active members of the record unit or its ancestors can be chosen', async ({
    assert,
  }) => {
    const saved = await service().save('tickets', agent, {
      title: 'عطل الطابعة',
      assignee: 2,
      orgUnitId: 2,
    })
    assert.equal(saved.assignee, 2)
    const ancestor = await service().save('tickets', agent, {
      title: 'تحديث النظام',
      assignee: 4,
      orgUnitId: 2,
    })
    assert.equal(ancestor.assignee, 4)
    // A sibling unit, a disabled account and a child unit cannot see unit A's records.
    for (const assignee of [3, 5, 6, 999]) {
      const error = await failure(() =>
        service().save('tickets', agent, { title: 'مرفوض', assignee, orgUnitId: 2 })
      )
      assert.equal(error.code, 'E_USER_FIELD', `user ${assignee}`)
    }
    const typed = await failure(() =>
      service().save('tickets', agent, { title: 'نص', assignee: 'سارة', orgUnitId: 2 })
    )
    assert.equal(typed.code, 'E_FIELD_VALUE')
    // Keeping a value that has since become ineligible does not block other edits.
    await db('users').where('id', 4).update({ disabled_at: db.fn.now() })
    try {
      const kept = await service().save(
        'tickets',
        agent,
        { title: 'تحديث النظام (معدل)', assignee: 4, orgUnitId: 2 },
        Number(ancestor.id)
      )
      assert.equal(kept.title, 'تحديث النظام (معدل)')
    } finally {
      await db('users').where('id', 4).update({ disabled_at: null })
    }
  })

  test('lists and details carry names only; filters and conditions use the user id', async ({
    assert,
  }) => {
    const page = await service().list('tickets', agent, { filters: { assignee: 2 } })
    assert.isAbove(page.data.length, 0)
    assert.isTrue(page.data.every((row) => row.assignee === 2))
    assert.deepEqual(page.related.assignee, [{ id: 2, fullName: 'سارة الوكيلة' }])
    assert.notInclude(JSON.stringify(page), 'example.test')
    const sorted = await service().list('tickets', agent, { sort: 'assignee', direction: 'desc' })
    assert.equal(sorted.data[0].assignee, 4)
    const shown = await service().show('tickets', Number(page.data[0].id), agent)
    assert.equal(shown.related.assignee[0].fullName, 'سارة الوكيلة')
    assert.deepEqual(conditionSql({ assignee: 2 }, ticket).bindings, ['r.assignee', 2])
    assert.throws(() => conditionSql({ assignee: 'سارة' }, ticket), /expected number/)
    const described = service().describe('tickets', agent)
    assert.equal(described.fields.find((field) => field.key === 'assignee')?.type, 'user')
  })

  test('form and filter choices follow organization scope and search by name', async ({
    assert,
  }) => {
    const form = await service().relationOptions('tickets', 'assignee', agent, { orgUnitId: 2 })
    assert.deepEqual(
      form.data.map((option) => option.value),
      ['1', '2', '4']
    )
    assert.equal(form.data[1].label, 'سارة الوكيلة')
    const searched = await service().relationOptions('tickets', 'assignee', agent, {
      orgUnitId: 2,
      search: 'منى',
    })
    assert.deepEqual(
      searched.data.map((option) => option.value),
      ['4']
    )
    // A unit outside the actor's scope reveals nobody.
    const foreign = await service().relationOptions('tickets', 'assignee', agent, { orgUnitId: 3 })
    assert.lengthOf(foreign.data, 0)
    const filter = await service().relationOptions('tickets', 'assignee', agent, {
      purpose: 'filter',
    })
    assert.deepEqual(
      filter.data.map((option) => option.value),
      ['1', '2', '4', '6']
    )
    const editor = await service().editor('tickets', agent)
    assert.isTrue(editor.relationSearch.assignee)
    const [existing] = await db('tickets').where('assignee', 2).limit(1)
    const edit = await service().editor('tickets', agent, Number(existing.id))
    assert.deepEqual(edit.options.assignee, [{ value: '2', label: 'سارة الوكيلة' }])
    const outsider: Actor = { ...agent, id: 3, rules: [{ subject: 'tickets', action: 'view' }] }
    const denied = await failure(() =>
      service().relationOptions('tickets', 'assignee', outsider, { orgUnitId: 2 })
    )
    assert.equal(denied.status, 403)
  })

  test('moving a record to another unit re-checks its user; system writes keep it', async ({
    assert,
  }) => {
    const root: Actor = { ...agent, orgPaths: ['1'] }
    const saved = await service().save('tickets', root, {
      title: 'نقل بين الوحدات',
      assignee: 2,
      orgUnitId: 2,
    })
    // User 2 is a member of unit A only; unit B's records are not visible to them.
    const moved = await failure(() =>
      service().save('tickets', root, { title: 'نقل', assignee: 2, orgUnitId: 3 }, Number(saved.id))
    )
    assert.equal(moved.code, 'E_USER_FIELD')
    const kept = await service().save(
      'tickets',
      root,
      { title: 'نقل', assignee: 4, orgUnitId: 3 },
      Number(saved.id)
    )
    assert.equal(kept.assignee, 4)
    // Module code decides a system write; a new user must still belong to the unit.
    const system = await failure(() =>
      service().systemSave('tickets', { assignee: 3, orgUnitId: 2 }, Number(saved.id), {
        actorId: 1,
      })
    )
    assert.equal(system.code, 'E_USER_FIELD')
    const reassigned = await service().systemSave('tickets', { assignee: 3 }, Number(saved.id), {
      actorId: 1,
    })
    assert.equal(reassigned.assignee, 3)
  })

  test('unscoped resources: users share the actor scope; system writes take any active user', async ({
    assert,
  }) => {
    const clerk: Actor = { ...agent, rules: [{ subject: 'desks', action: 'manage' }] }
    const created = await service().save('desks', clerk, { code: 'D-1', owner: 6 })
    assert.equal(created.owner, 6)
    const sibling = await failure(() => service().save('desks', clerk, { code: 'D-2', owner: 3 }))
    assert.equal(sibling.code, 'E_USER_FIELD')
    const system = await service().systemSave('desks', { code: 'D-2', owner: 3 }, undefined, {
      actorId: 1,
    })
    assert.equal(system.owner, 3)
    const disabled = await failure(() =>
      service().systemSave('desks', { code: 'D-3', owner: 5 }, undefined, { actorId: 1 })
    )
    assert.equal(disabled.code, 'E_USER_FIELD')
  })

  test('create defaults accept an eligible user and label it by name', async ({ assert }) => {
    const editor = await service().editor('tickets', agent, undefined, {
      defaults: { assignee: '4', title: 'زيارة' },
    })
    assert.deepEqual(editor.defaults, { assignee: 4, title: 'زيارة' })
    assert.deepInclude(editor.options.assignee, { value: '4', label: 'منى من الجذر' })
    for (const assignee of ['3', '5', 'x']) {
      const refused = await service().editor('tickets', agent, undefined, {
        defaults: { assignee },
      })
      assert.notProperty(refused.defaults, 'assignee', assignee)
    }
  })

  test('"$actor.id" on a user field: CASL, SQL and inverted rules agree', async ({ assert }) => {
    const rules = [
      { subject: 'tickets', action: 'view' },
      { subject: 'tickets', action: 'update', conditions: { assignee: ACTOR_ID } },
      // Deleting is allowed, except the tickets of other users.
      { subject: 'tickets', action: 'delete' },
      {
        subject: 'tickets',
        action: 'delete',
        inverted: true,
        conditions: { assignee: { $ne: ACTOR_ID } },
      },
    ]
    // Unresolved rules never reach CASL or SQL: a text comparison would fail open.
    assert.throws(() => buildAbility(rules, registry.all()), /resolveActorConditions/)
    assert.throws(() => conditionSql({ assignee: ACTOR_ID }, ticket), /resolveActorConditions/)
    const sara: Actor = {
      ...agent,
      rules: rules.map((rule) => ({
        ...rule,
        conditions: resolveActorConditions(rule.conditions, agent.id),
      })),
    }
    const ability = buildAbility(sara.rules, registry.all())
    const rows = await db('tickets as r')
      .join('org_units as ou', 'ou.id', 'r.org_unit_id')
      .whereNull('r.deleted_at')
      .select('r.id', 'r.assignee', 'ou.path as orgPath')
    const theirs = rows.filter((row) => row.assignee === 2)
    const others = rows.filter((row) => row.assignee !== 2 && row.orgPath.startsWith('1.2'))
    assert.isAbove(theirs.length, 0)
    assert.isAbove(others.length, 0)
    const record = (row: (typeof rows)[number]) => ({ ...row, assignee: Number(row.assignee) })
    for (const action of ['update', 'delete']) {
      for (const row of theirs)
        assert.isTrue(canRecord(ability, sara, ticket, action, record(row)), `${action} own`)
      for (const row of others)
        assert.isFalse(canRecord(ability, sara, ticket, action, record(row)), `${action} other`)
      const allowed = await accessibleBy(
        db('tickets as r').whereNull('r.deleted_at'),
        ability,
        sara,
        action,
        ticket
      ).pluck('r.id')
      assert.sameMembers(
        allowed,
        theirs.map((row) => row.id),
        action
      )
    }
    const where = conditionSql(resolveActorConditions({ assignee: ACTOR_ID }, 2), ticket)
    assert.deepEqual(where, { text: '?? IS NOT DISTINCT FROM ?', bindings: ['r.assignee', 2] })
    // Any conditional rule keeps sorting, filtering and search by field closed.
    const filter = await failure(() =>
      service().list('tickets', sara, { filters: { assignee: 2 } })
    )
    assert.equal(filter.code, 'E_FILTER')
    const sort = await failure(() => service().list('tickets', sara, { sort: 'assignee' }))
    assert.equal(sort.code, 'E_FIELD_FORBIDDEN')
    // The role matrix offers the current user on user fields and the creator/updater.
    const matrix = new RolesAdmin(db, registry).matrix()
    assert.deepEqual(
      matrix.subjects
        .find((entry) => entry.name === 'tickets')!
        .conditionFields.filter((field) => field.actor)
        .map((field) => field.key),
      ['createdBy', 'updatedBy', 'assignee']
    )
    assert.isFalse(
      service()
        .describe('tickets', sara)
        .fields.find((field) => field.key === 'assignee')?.filterable
    )
  })

  test('a hook that moves the record is checked against the unit it chose', async ({ assert }) => {
    const root: Actor = { ...agent, orgPaths: ['1'] }
    // User 2 belongs to unit A only; the hook moves the record to unit B.
    const moved = await failure(() =>
      service().save('tickets', root, { title: 'نقل بالخطاف', assignee: 2, orgUnitId: 2 })
    )
    assert.equal(moved.code, 'E_USER_FIELD')
    const kept = await service().save('tickets', root, {
      title: 'نقل بالخطاف',
      assignee: 3,
      orgUnitId: 2,
    })
    assert.equal(kept.orgUnitId, 3)
  })

  test('a system write checks a chosen user against the chooser', async ({ assert }) => {
    // A person chose the value, such as a supervisor: it must be eligible for them.
    const chosen = await failure(() =>
      service().systemSave('desks', { code: 'D-9', owner: 3 }, undefined, {
        actorId: 2,
        chooser: agent,
      })
    )
    assert.equal(chosen.code, 'E_USER_FIELD')
    const eligible = await service().systemSave('desks', { code: 'D-9', owner: 6 }, undefined, {
      actorId: 2,
      chooser: agent,
    })
    assert.equal(eligible.owner, 6)
  })
})
