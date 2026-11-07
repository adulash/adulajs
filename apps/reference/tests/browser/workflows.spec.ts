import { test } from '@japa/runner'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import { consumeEvent, seedModules, type DomainEvent } from 'adula'
import { registry } from '#start/modules'
import User from '#models/user'
import { adula } from '#services/adula'
import { listeners } from '#start/listeners'
import { isDecorative, screenshotDir, seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const knex = () => db.connection().getWriteClient()

test.group('Workflow approvals browser acceptance', (group) => {
  let clerk: UiActor
  let manager: User
  let id: number
  group.setup(async () => {
    clerk = await seedActor([{ subject: 'orders', action: 'manage' }], { fullName: 'مقدمة الطلب' })
    await seedModules(knex(), registry, clerk.user.id)
    const member = async (key: string, fullName: string) => {
      const user = await User.create({
        fullName,
        email: `browser-${key}-${Date.now()}@example.test`,
        password: 'browser-workflow-password-123',
      })
      const role = await knex()('roles').where('key', key).first()
      await knex()('user_roles').insert({ user_id: user.id, role_id: role.id })
      await knex()('user_org_units').insert({ user_id: user.id, org_unit_id: clerk.orgUnitId })
      return user
    }
    manager = await member('department_manager', 'مدير القسم للمتصفح')
    await member('general_manager', 'المدير العام للمتصفح')
    const actor = await adula().actors.load(clerk.user.id)
    const order = await adula().resources.save('orders', actor, {
      notes: 'طلب يحتاج موافقة',
      total: '5000000',
      orgUnitId: clerk.orgUnitId,
    })
    id = Number(order.id)
    await adula().resources.transition('orders', id, actor, 'submit', order.version)
    const rows = await knex()('outbox').whereNull('published_at')
    for (const row of rows) {
      const event: DomainEvent = { id: row.id, event: row.event, payload: row.payload }
      for (const listener of listeners) await consumeEvent(knex(), listener, event)
      await knex()('outbox').where('id', row.id).update({ published_at: knex().fn.now() })
    }
  })

  test('the manager approves from the inbox and the record shows the history', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(manager)
    // The old inbox link lands on the approvals tab of My tasks (#35).
    const inbox = await visit('/approvals')
    await inbox.getByRole('heading', { name: 'مهامي' }).waitFor()
    await inbox.waitForURL(/\/my-tasks\?tab=approvals$/)
    await inbox.getByRole('tab', { name: /بانتظار قراري/, selected: true }).waitFor()
    await inbox.getByText('موافقة مدير القسم').waitFor()
    await inbox.screenshot({ path: join(await screenshotDir(), 'approvals-inbox.png') })
    await inbox.getByRole('button', { name: 'موافقة', exact: true }).click()
    const dialog = inbox.getByRole('dialog', { name: 'تأكيد الموافقة' })
    await dialog.getByLabel('ملاحظة (اختيارية)').fill('مطابق للميزانية')
    await dialog.getByRole('button', { name: 'موافقة', exact: true }).click()
    await inbox.getByText('لا موافقات بانتظار قرارك.').waitFor()

    const record = await visit(`/resources/orders/${id}`)
    const panel = record.getByRole('region', { name: 'سير العمل' })
    await panel.getByText('بانتظار موافقة').waitFor()
    await panel.getByText('«مطابق للميزانية»').waitFor()
    // The history names who decided, with their picture beside the name (ADR 050).
    const decided = panel.getByRole('listitem').filter({ hasText: manager.fullName! }).first()
    assert.isTrue(await isDecorative(decided))
    await record.screenshot({ path: join(await screenshotDir(), 'record-workflow.png') })
  })
})
