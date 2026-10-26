import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { consumeEvent, seedModules, type DomainEvent } from 'adula'
import { adula } from '#services/adula'
import { registry } from '#start/modules'
import { listeners } from '#start/listeners'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'
import User from '#models/user'

const knex = () => db.connection().getWriteClient()
const day = (days = 0) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

test.group('Out-of-office delegation in the browser (ADR 044)', (group) => {
  let clerk: UiActor
  let deputy: UiActor
  let manager: User
  group.setup(async () => {
    clerk = await seedActor([{ subject: 'orders', action: 'manage' }], {
      fullName: 'مقدمة الطلب',
      level: 1,
    })
    await seedModules(knex(), registry, clerk.user.id)
    manager = await User.create({
      fullName: 'مديرة القسم الغائبة',
      email: `delegating-manager-${Date.now()}@example.test`,
      password: 'delegation-browser-password-123',
    })
    const role = await knex()('roles').where('key', 'department_manager').first()
    await knex()('user_roles').insert({ user_id: manager.id, role_id: role.id })
    await knex()('user_org_units').insert({ user_id: manager.id, org_unit_id: clerk.orgUnitId })
    deputy = await seedActor([{ subject: 'orders', action: 'view' }], {
      orgUnitId: clerk.orgUnitId,
      fullName: 'نائبة المديرة',
      level: 1,
    })
  })

  test('a manager delegates through the Dialog; the delegate decides on her behalf', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(manager)
    const page = await visit('/account/delegations')
    await page.getByRole('heading', { name: 'التفويض أثناء الغياب', level: 1 }).waitFor()
    await page.getByText('لا تفويض حالي أو مجدول. موافقاتك تصلك مباشرة.').waitFor()
    await page.getByRole('button', { name: 'تفويض جديد' }).click()
    const dialog = page.getByRole('dialog', { name: 'تفويض موافقاتي' })
    // A missing delegate is reported inside the Dialog before anything is sent.
    await dialog.getByRole('button', { name: 'حفظ التفويض' }).click()
    await dialog.getByText('اختر المفوَّض إليه.').waitFor()
    await dialog.getByRole('combobox', { name: 'المفوَّض إليه' }).click()
    await page.getByPlaceholder('اكتب حرفين من الاسم أو البريد كاملًا…').fill('نائبة')
    await page.getByRole('option', { name: 'نائبة المديرة' }).click()
    await dialog.getByRole('textbox', { name: 'إلى تاريخ' }).fill(day(2))
    await dialog.getByLabel(/ملاحظة/).fill('إجازة قصيرة')
    await dialog.getByRole('button', { name: 'حفظ التفويض' }).click()
    await dialog.waitFor({ state: 'detached' })
    const table = page.getByRole('table', { name: 'تفويضاتي الحالية والقادمة' })
    await table.getByRole('cell', { name: 'نائبة المديرة', exact: true }).waitFor()
    await table.getByText('سارٍ').waitFor()
    await page.getByText('موافقاتك مفوّضة الآن إلى').waitFor()
    const stored = await knex()('workflow_delegations').where('delegator_id', manager.id).first()
    assert.equal(stored.delegate_id, deputy.user.id)
    assert.equal(stored.note, 'إجازة قصيرة')

    // An order submitted now waits for the deputy, on the manager's behalf.
    const actor = await adula().actors.load(clerk.user.id)
    const saved = await adula().resources.save('orders', actor, {
      notes: 'طلب أثناء الإجازة',
      total: '2500000',
      orgUnitId: clerk.orgUnitId,
    })
    await adula().resources.transition('orders', Number(saved.id), actor, 'submit', saved.version)
    for (const row of await knex()('outbox').whereNull('published_at').orderBy('created_at')) {
      const event: DomainEvent = { id: row.id, event: row.event, payload: row.payload }
      for (const listener of listeners) await consumeEvent(knex(), listener, event)
      await knex()('outbox').where('id', row.id).update({ published_at: knex().fn.now() })
    }

    await browserContext.clearCookies()
    await browserContext.loginAs(deputy.user)
    const tasks = await visit('/my-tasks?tab=approvals')
    const item = tasks.getByRole('listitem').filter({ hasText: 'موافقة مدير القسم' })
    await item.getByText('نيابة عن مديرة القسم الغائبة').waitFor()
    await item.getByText('في الموعد').waitFor()
    await item.getByRole('button', { name: 'موافقة', exact: true }).click()
    const confirm = tasks.getByRole('dialog', { name: 'تأكيد الموافقة' })
    await confirm.getByText('تقرر نيابة عن مديرة القسم الغائبة').waitFor()
    await confirm.getByRole('button', { name: 'موافقة', exact: true }).click()
    await confirm.waitFor({ state: 'detached' })

    const [run] = await adula().workflows.runsFor('orders', Number(saved.id), actor)
    assert.equal(run.step, 'director')
    const approved = run.history.find((entry) => entry.event === 'approved')
    assert.equal(approved?.actorName, 'نائبة المديرة')
    assert.equal(approved?.onBehalfOfName, 'مديرة القسم الغائبة')
  })
})
