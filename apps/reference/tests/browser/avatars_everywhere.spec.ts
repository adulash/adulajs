import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import { UserAvatars } from 'adula'
import { adula } from '#services/adula'
import {
  decorativeAvatar,
  installSampleResources,
  isDecorative,
  removeSampleResources,
  seedActor,
  seedPicture,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

const knex = () => db.connection().getWriteClient()

/**
 * Every place a person appears shows their picture beside the name (ADR 050): decorative, with
 * a versioned URL for a user who has one, and initials without any request for one who has not.
 */
test.group('Profile pictures wherever a person appears (#158)', (group) => {
  let admin: UiActor
  let pictured: UiActor
  let plain: UiActor
  let version: number
  let recordId: number
  const unique = randomUUID().slice(0, 8)
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], {
      fullName: `منيرة المشرفة ${unique}`,
    })
    pictured = await seedActor([{ subject: 'ui_samples', action: 'view' }], {
      fullName: `سلمان المصوّر ${unique}`,
      orgUnitId: admin.orgUnitId,
    })
    plain = await seedActor([{ subject: 'ui_samples', action: 'view' }], {
      fullName: `هالة بلا صورة ${unique}`,
      orgUnitId: admin.orgUnitId,
    })
    version = await seedPicture(pictured.user.id)
    await installSampleResources()
    const actor = await adula().actors.load(admin.user.id)
    const saved = await adula().resources.save('ui_samples', actor, {
      title: `عينة الصور ${unique}`,
      orgUnitId: admin.orgUnitId,
      reviewer: pictured.user.id,
    })
    recordId = Number(saved.id)
    // A change made by the pictured user, for the activity log and the record's change log.
    const [entry] = await knex()('activities')
      .insert({
        resource: 'ui_samples',
        record_id: recordId,
        actor_id: pictured.user.id,
        action: 'update',
        changes: JSON.stringify({ fields: ['title'] }),
      })
      .returning('id')
    await knex()('field_changes').insert({
      activity_id: entry.id,
      resource: 'ui_samples',
      record_id: recordId,
      field: 'title',
      before: JSON.stringify('عنوان قديم'),
      after: JSON.stringify(`عينة الصور ${unique}`),
    })
    await knex()('assignments').insert({
      resource: 'ui_samples',
      record_id: recordId,
      assignee_id: admin.user.id,
      assigned_by: pictured.user.id,
      title: `مهمة من سلمان ${unique}`,
    })
    await knex()('user_sessions').insert({
      id: `avatars-${unique}`,
      user_id: pictured.user.id,
      user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36',
    })
    const today = new Date().toISOString().slice(0, 10)
    await knex()('workflow_delegations').insert({
      delegator_id: admin.user.id,
      delegate_id: pictured.user.id,
      starts_on: today,
      ends_on: today,
      created_by: admin.user.id,
    })
    return async () => {
      await knex()('workflow_delegations').where('delegator_id', admin.user.id).delete()
      await knex()('user_sessions').where('id', `avatars-${unique}`).delete()
      const removed = await new UserAvatars(knex()).remove({
        userId: pictured.user.id,
        actorId: pictured.user.id,
      })
      for (const file of removed) await drive.use(file.disk as never).delete(file.path)
      await removeSampleResources()
    }
  })

  const versioned = () => `/users/${pictured.user.id}/avatar?v=${version}`

  test('administration lists: users, sessions and the activity log', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const requested: string[] = []
    const users = await visit(`/admin/users?q=${unique}`)
    users.on('request', (request: { url(): string }) => requested.push(request.url()))
    const row = users.getByRole('row').filter({ hasText: pictured.user.fullName! })
    assert.isTrue(await isDecorative(row))
    // The main identity column uses the larger list size.
    assert.include(
      String(await row.locator('[data-slot="user-avatar"]').getAttribute('class')),
      'size-7'
    )
    await row.locator('[data-slot="user-avatar-image"]').waitFor()
    assert.equal(await row.locator('img').getAttribute('src'), versioned())
    assert.equal(await row.locator('img').getAttribute('alt'), '')
    // A user without a picture shows initials and costs no request at all.
    const other = users.getByRole('row').filter({ hasText: plain.user.fullName! })
    const initials = await decorativeAvatar(other)
    assert.equal(initials.image, null)
    assert.notInclude(requested.join(' '), `/users/${plain.user.id}/avatar`)

    const sessions = await visit('/admin/sessions')
    const session = sessions.getByRole('row').filter({ hasText: pictured.user.fullName! })
    assert.isTrue(await isDecorative(session))

    const activity = await visit(`/admin/activity?actorId=${pictured.user.id}`)
    const actor = activity.getByRole('row').filter({ hasText: pictured.user.fullName! }).first()
    assert.isTrue(await isDecorative(actor))
  })

  test('records: the user field in the list and the details, the change log and my tasks', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const list = await visit('/resources/ui_samples')
    const cell = list.getByRole('cell', { name: pictured.user.fullName! }).first()
    assert.isTrue(await isDecorative(cell))

    const record = await visit(`/resources/ui_samples/${recordId}`)
    const reviewer = record.getByRole('definition').filter({ hasText: pictured.user.fullName! })
    assert.isTrue(await isDecorative(reviewer.first()))
    await record.getByRole('tab', { name: /سجل التغييرات/ }).click()
    const change = record.getByRole('row').filter({ hasText: 'عنوان قديم' })
    assert.isTrue(await isDecorative(change))

    const tasks = await visit('/my-tasks')
    const task = tasks.getByRole('listitem').filter({ hasText: `مهمة من سلمان ${unique}` })
    const by = task.getByText(/أسندها/).first()
    assert.isTrue(await isDecorative(by))
  })

  test('delegations: the table, the picker choices and the chosen person', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/account/delegations')
    const row = page.getByRole('row').filter({ hasText: pictured.user.fullName! }).first()
    assert.isTrue(await isDecorative(row))

    await page.getByRole('button', { name: 'تفويض جديد' }).click()
    const dialog = page.getByRole('dialog', { name: 'تفويض موافقاتي' })
    await dialog.getByRole('combobox', { name: 'المفوَّض إليه' }).click()
    await page.getByPlaceholder('اكتب حرفين من الاسم أو البريد كاملًا…').fill('هالة')
    const option = page.getByRole('option', { name: plain.user.fullName! })
    assert.isTrue(await isDecorative(option))
    await option.click()
    const trigger = dialog.getByRole('combobox', { name: 'المفوَّض إليه' })
    assert.include(
      String(await trigger.locator('[data-slot="user-avatar"]').getAttribute('class')),
      'size-7'
    )
    await page.keyboard.press('Escape')
  })
})
