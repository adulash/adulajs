import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import type { Locator, Page } from 'playwright'
import db from '@adonisjs/lucid/services/db'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

/**
 * Owner decision 30 (2.3.0): a dialog that creates, edits or shows a lasting item has its own
 * address. Opening it changes the address; Back closes it and stays on the page; a reload keeps
 * it open; a direct load of the address opens it; an unknown or forbidden value shows nothing
 * and is removed from the address. Every entity dialog is one row of this table, all through
 * the shared `useDialogParam` hook (packages/ui/registry/ui/dialog_param.ts).
 */

const json = { Accept: 'application/json' }
const run = Date.now().toString(36)
const names = {
  webhook: `ربط العناوين ${run}`,
  source: `مصدر العناوين ${run}`,
  sourceKey: `dlg${run}`,
  occasion: `مناسبة العناوين ${run}`,
  lookupGroup: `dlg_urls_${run}`,
  lookupKey: `value_${run}`,
  templateKey: `dlg_urls_${run}`,
}

type Row = {
  label: string
  /** The page the dialog opens over. */
  path: string
  /** The control that opens it. */
  trigger: (page: Page) => Locator
  /** The dialog's accessible name. */
  dialog: string | RegExp
  /** The query parameter it owns, and a value no item has. */
  param: string
  unknown: string
}

const rows: Row[] = [
  {
    label: 'my delegations · create',
    path: '/account/delegations',
    trigger: (page) => page.getByRole('button', { name: 'تفويض جديد', exact: true }),
    dialog: 'تفويض موافقاتي',
    param: 'new',
    unknown: 'other',
  },
  {
    label: 'approval delegations · create',
    path: '/admin/delegations',
    trigger: (page) => page.getByRole('button', { name: 'تفويض جديد', exact: true }),
    dialog: 'تفويض موافقات مستخدم',
    param: 'new',
    unknown: 'other',
  },
  {
    label: 'inbound webhook source · create',
    path: '/admin/webhooks',
    trigger: (page) => page.getByRole('button', { name: 'إضافة مصدر وارد', exact: true }),
    dialog: 'إضافة مصدر وارد',
    param: 'new-source',
    unknown: 'other',
  },
  {
    label: 'inbound webhook source · edit',
    path: '/admin/webhooks',
    trigger: (page) =>
      page
        .locator('li', { hasText: names.source })
        .getByRole('button', { name: 'تعديل', exact: true }),
    dialog: 'تعديل المصدر',
    param: 'edit-source',
    unknown: '999999999',
  },
  {
    label: 'outgoing webhook · create',
    path: '/admin/webhooks',
    trigger: (page) => page.getByRole('button', { name: 'إضافة ربط', exact: true }),
    dialog: 'إضافة ربط خارجي',
    param: 'new',
    unknown: 'other',
  },
  {
    label: 'outgoing webhook · edit',
    path: '/admin/webhooks',
    trigger: (page) =>
      page
        .locator('li', { hasText: names.webhook })
        .getByRole('button', { name: 'تعديل', exact: true }),
    dialog: 'تعديل الربط',
    param: 'edit',
    unknown: '999999999',
  },
  {
    label: 'print template · create',
    path: '/admin/print-templates',
    trigger: (page) => page.getByRole('button', { name: 'قالب جديد', exact: true }),
    dialog: 'قالب طباعة جديد',
    param: 'new',
    unknown: 'other',
  },
  {
    label: 'print template · edit (fetched)',
    path: '/admin/print-templates',
    trigger: (page) =>
      page.getByRole('button', { name: `تعديل قالب العناوين ${run}`, exact: true }),
    dialog: 'تعديل قالب الطباعة',
    param: 'edit',
    unknown: 'orders.missing',
  },
  {
    label: 'message template · edit',
    path: '/admin/templates',
    trigger: (page) => page.getByRole('button', { name: /^تعديل / }).first(),
    dialog: 'تعديل القالب',
    param: 'edit',
    unknown: 'missing.template',
  },
  {
    label: 'appearance occasion · create',
    path: '/admin/appearance',
    trigger: (page) => page.getByRole('button', { name: 'إضافة مناسبة', exact: true }),
    dialog: 'إضافة مناسبة',
    param: 'new',
    unknown: 'other',
  },
  {
    label: 'appearance occasion · edit',
    path: '/admin/appearance',
    trigger: (page) => page.getByRole('button', { name: `تعديل ${names.occasion}`, exact: true }),
    dialog: `تعديل مناسبة «${names.occasion}»`,
    param: 'edit',
    unknown: '999999999',
  },
  {
    label: 'lookups · new list',
    path: `/admin/lookups?group=${names.lookupGroup}`,
    trigger: (page) => page.getByRole('button', { name: 'قائمة جديدة', exact: true }),
    dialog: 'قائمة جديدة',
    param: 'new',
    unknown: 'other',
  },
  {
    label: 'lookups · new value',
    path: `/admin/lookups?group=${names.lookupGroup}`,
    trigger: (page) => page.getByRole('button', { name: 'إضافة قيمة', exact: true }),
    dialog: `قيمة جديدة في ${names.lookupGroup}`,
    param: 'new',
    unknown: 'other',
  },
  {
    label: 'lookups · edit value',
    path: `/admin/lookups?group=${names.lookupGroup}`,
    trigger: (page) =>
      page.getByRole('button', { name: `تحرير تسمية العناوين ${run}`, exact: true }),
    dialog: `تحرير ${names.lookupKey}`,
    param: 'edit',
    unknown: '999999999',
  },
  {
    label: 'organization unit · create',
    path: '/admin/org-units',
    trigger: (page) => page.getByRole('button', { name: 'إضافة وحدة', exact: true }),
    dialog: 'وحدة جديدة',
    param: 'new',
    unknown: 'other',
  },
]

/** The page's path and query, without the origin. */
const address = (page: Page) => {
  const url = new URL(page.url())
  return { path: url.pathname, query: url.searchParams }
}

/** The dialog's value in the address once it has the parameter. */
async function paramValue(page: Page, param: string) {
  await page.waitForURL((url) => url.searchParams.has(param))
  return address(page).query.get(param)!
}

/** Waits until the address no longer carries the parameter, on the same page. */
async function waitWithout(page: Page, path: string, param: string) {
  const pathname = path.split('?')[0]
  await page.waitForURL((url) => url.pathname === pathname && !url.searchParams.has(param))
}

/** The address of `path` with the parameter set. */
function withParam(path: string, param: string, value: string) {
  const [pathname, search = ''] = path.split('?')
  const query = new URLSearchParams(search)
  query.set(param, value)
  return `${pathname}?${query}`
}

async function seed(client: ApiClient, admin: UiActor) {
  const post = (url: string, body: Record<string, unknown>) =>
    client.post(url).json(body).loginAs(admin.user).headers(json).withCsrfToken()
  const results = [
    await post('/admin/webhooks', {
      name: names.webhook,
      url: 'http://127.0.0.1:9/dialog-urls',
      events: ['orders.orders.created'],
    }),
    await post('/admin/inbound-webhooks', { key: names.sourceKey, name: names.source }),
    await post('/admin/print-templates', {
      resource: 'orders',
      key: names.templateKey,
      label: `قالب العناوين ${run}`,
      body: '<h1>{{field.notes}}</h1>',
    }),
    await post('/admin/appearance/occasions', {
      name: names.occasion,
      startsOn: '2099-01-01',
      endsOn: '2099-01-02',
    }),
    await post('/admin/lookups', {
      group: names.lookupGroup,
      key: names.lookupKey,
      labelAr: `تسمية العناوين ${run}`,
    }),
  ]
  for (const result of results)
    if (result.status() >= 300) throw new Error(`seed failed: ${result.status()} ${result.text()}`)
}

test.group('Entity dialogs have their own address (decision 30)', (group) => {
  let admin: UiActor
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير العناوين' })
    return async () => {
      const knex = db.connection().getWriteClient()
      await knex('appearance_occasions').where('name', names.occasion).delete()
    }
  })

  test('seed one item of each kind', async ({ client }) => {
    await seed(client, admin)
  })

  for (const row of rows)
    test(`${row.label}: open, Back, reload, direct load, unknown value`, async ({
      browserContext,
      visit,
      assert,
    }) => {
      await browserContext.loginAs(admin.user)
      const page = await visit(row.path)
      const dialog = page.getByRole('dialog', { name: row.dialog, exact: true })
      const heading = await page.locator('main h1').first().innerText()

      // Opening pushes the parameter, with no request: the page behind stays mounted.
      await page.evaluate(`window.__page = document.querySelector('main h1')`)
      await row.trigger(page).click()
      await dialog.waitFor()
      const value = await paramValue(page, row.param)
      assert.isTrue(
        await page.evaluate<boolean>(
          `window.__page === document.querySelector('main h1') && window.__page.isConnected`
        ),
        'the page behind the dialog was mounted again'
      )

      // Back closes the dialog and stays on the page, still mounted.
      await page.goBack()
      await dialog.waitFor({ state: 'hidden' })
      await waitWithout(page, row.path, row.param)
      assert.include(await page.locator('main h1').first().innerText(), heading)

      // Opened again and reloaded, the dialog is still open.
      await row.trigger(page).click()
      await dialog.waitFor()
      assert.equal(await paramValue(page, row.param), value)
      await page.reload()
      await dialog.waitFor()
      assert.equal(address(page).query.get(row.param), value)

      // Closing (here after a reload, so nothing to go Back to) removes the parameter.
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      await waitWithout(page, row.path, row.param)

      // A direct load of the address opens the dialog over the page.
      await page.goto(new URL(withParam(row.path, row.param, value), page.url()).href)
      await dialog.waitFor()
      assert.include(await page.locator('main h1').first().innerText(), heading)

      // An unknown value shows nothing and leaves the address without the parameter.
      await page.goto(new URL(withParam(row.path, row.param, row.unknown), page.url()).href)
      await waitWithout(page, row.path, row.param)
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.include(await page.locator('main h1').first().innerText(), heading)
    })

  test('closing a dialog opened on the page goes Back, so Back afterwards leaves the page', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/admin/org-units')
    await page.goto(new URL('/admin/webhooks', page.url()).href)
    const dialog = page.getByRole('dialog', { name: 'إضافة ربط خارجي', exact: true })
    await page.getByRole('button', { name: 'إضافة ربط', exact: true }).click()
    await dialog.waitFor()
    await paramValue(page, 'new')
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await waitWithout(page, '/admin/webhooks', 'new')
    // No entry of the dialog is left behind: Back returns to the page before.
    await page.goBack()
    await page.waitForURL((url) => url.pathname === '/admin/org-units')
    assert.equal(await page.getByRole('dialog').count(), 0)
  })
})
