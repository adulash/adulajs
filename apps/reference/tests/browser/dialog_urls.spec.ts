import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import type { Locator, Page, Request } from 'playwright'
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

/** Requests for the page itself (its document or an Inertia visit), from now until `stop`. */
function watchPageRequests(page: Page, path: string) {
  const pathname = path.split('?')[0]
  const sent: string[] = []
  const listener = (request: Request) => {
    const type = request.resourceType()
    if (type !== 'document' && type !== 'xhr' && type !== 'fetch') return
    const url = new URL(request.url())
    if (url.pathname === pathname) sent.push(`${request.method()} ${url.pathname}${url.search}`)
  }
  page.on('request', listener)
  return { sent, stop: () => page.off('request', listener) }
}

/** Counts each time the Inertia progress bar becomes visible, checked every frame. */
async function watchProgress(page: Page) {
  await page.evaluate(`(() => {
    window.__progress = 0
    let shown = false
    const visible = () => {
      const bar = document.getElementById('nprogress')
      if (!bar || !bar.isConnected) return false
      if (bar.hasAttribute('popover')) return bar.matches(':popover-open')
      return getComputedStyle(bar).display !== 'none'
    }
    const frame = () => {
      const now = visible()
      if (now && !shown) window.__progress++
      shown = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })()`)
}

/** How many times the bar appeared since the last reset; resets the count. */
async function progressShown(page: Page) {
  return page.evaluate<number>(`(() => {
    const count = window.__progress
    window.__progress = 0
    return count
  })()`)
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
    await post('/admin/lookups', {
      group: `${names.lookupGroup}_other`,
      key: names.lookupKey,
      labelAr: `تسمية أخرى ${run}`,
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
      await watchProgress(page)
      const requests = watchPageRequests(page, row.path)
      await row.trigger(page).click()
      await dialog.waitFor()
      const value = await paramValue(page, row.param)
      // Past the progress bar's delay, so a bar started by the opening would be on screen.
      await page.waitForTimeout(600)
      requests.stop()
      assert.deepEqual(requests.sent, [], 'opening the dialog requested the page')
      assert.equal(await progressShown(page), 0, 'opening the dialog showed the progress bar')
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

  test('an existing item the page does not show is stripped like an unknown one', async ({
    browserContext,
    visit,
    assert,
  }) => {
    // These admin screens have no per-item permission: a user without the admin permission is
    // refused the page itself. What a page leaves out (here another list's value) is the case
    // the address must not reveal: a real id outside the page opens nothing and is removed.
    const knex = db.connection().getWriteClient()
    const elsewhere = await knex('lookups')
      .where({ group: names.lookupGroup, key: names.lookupKey })
      .first('id')
    await browserContext.loginAs(admin.user)
    const path = `/admin/lookups?group=${names.lookupGroup}_other`
    const page = await visit(withParam(path, 'edit', String(elsewhere.id)))
    await waitWithout(page, path, 'edit')
    assert.equal(address(page).query.get('group'), `${names.lookupGroup}_other`)
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.getByRole('button', { name: `تحرير تسمية أخرى ${run}`, exact: true }).waitFor()
  })

  // «إلغاء» closes through the dialog's own close, so typed changes still ask first (decision 23).
  for (const surface of [
    {
      label: 'a lookup list',
      path: `/admin/lookups?group=${names.lookupGroup}`,
      trigger: 'قائمة جديدة',
      dialog: 'قائمة جديدة',
      field: 'التسمية العربية',
      param: 'new',
    },
    {
      label: 'an organization unit',
      path: '/admin/org-units',
      trigger: 'إضافة وحدة',
      dialog: 'وحدة جديدة',
      field: 'الاسم',
      param: 'new',
    },
  ])
    test(`«إلغاء» after typing in ${surface.label} asks before discarding`, async ({
      browserContext,
      visit,
      assert,
    }) => {
      await browserContext.loginAs(admin.user)
      const page = await visit(surface.path)
      const dialog = page.getByRole('dialog', { name: surface.dialog, exact: true })
      const confirm = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
      await page.getByRole('button', { name: surface.trigger, exact: true }).click()
      await dialog.waitFor()
      await dialog.getByLabel(surface.field, { exact: true }).fill('نص لم يُحفظ')
      await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
      await confirm.waitFor()
      await page.getByRole('button', { name: 'متابعة التحرير', exact: true }).click()
      await confirm.waitFor({ state: 'hidden' })
      assert.equal(
        await dialog.getByLabel(surface.field, { exact: true }).inputValue(),
        'نص لم يُحفظ'
      )
      assert.isTrue(address(page).query.has(surface.param))
    })

  test('the print template editor is open in the first frame, its body loading inside it', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/admin/print-templates')
    const dialog = page.getByRole('dialog', { name: 'تعديل قالب الطباعة', exact: true })
    // Hold the template's fetch so the loading state can be seen.
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route(`**/admin/print-templates/orders/${names.templateKey}`, async (route) => {
      await held
      await route.continue()
    })
    await page.evaluate(`(() => {
      window.__firstFrame = null
      document.addEventListener('click', () => requestAnimationFrame(() => {
        window.__firstFrame = !!document.querySelector('[role=dialog][data-state=open]')
      }), { capture: true, once: true })
    })()`)
    await page.getByRole('button', { name: `تعديل قالب العناوين ${run}`, exact: true }).click()
    await page.waitForFunction('window.__firstFrame !== null')
    assert.isTrue(
      await page.evaluate<boolean>('window.__firstFrame'),
      'not open at the first frame'
    )
    await dialog.waitFor()
    await dialog.locator('[data-slot=record-loading]').waitFor()
    assert.isTrue(await dialog.getByRole('button', { name: 'حفظ نسخة جديدة' }).isDisabled())
    release()
    await dialog.getByLabel('متن القالب', { exact: true }).waitFor()
    assert.equal(await dialog.locator('[data-slot=record-loading]').count(), 0)
  })
})
