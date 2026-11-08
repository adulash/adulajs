import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright'
import { adula } from '#services/adula'
import {
  installSampleResources,
  removeSampleResources,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

/**
 * Decision 6 (owner, 2.3.0): a dialog asks before closing only when there are unsaved changes.
 * This sweep finds the dialogs by itself, so a new dialog is covered without its own test: on
 * every page it clicks each control that may open one, and closes every modal that appears by
 * Escape, by the X button and by the footer button, without typing anything. No closing may
 * ever show the unsaved-changes question.
 */

/** Modal content only: popovers and menus also carry role=dialog but are not modals. */
const MODAL =
  '[data-slot="dialog-content"]:visible, [data-slot="alert-dialog-content"]:visible, [data-slot="sheet-content"]:visible'

/**
 * The only controls skipped by name: one click ends the sweep's own session for good, with no
 * dialog first (signing out, ending this session or the impersonation, ending a session from
 * the administrators' list, which may be this one). Everything else is clicked, and skipped
 * only by what it did: no dialog opened, a confirmation opened (mode="confirm", which never
 * asks about unsaved changes by construction) or the click went to another page. Every skip
 * is logged with its reason, and a sign-out the list missed is logged and the user signed in
 * again.
 */
const ENDS_SESSION = /^(تسجيل الخروج|إنهاء الانتحال|إنهاء هذه الجلسة)$|^إنهاء جلسة /

/** The question a dirty dialog asks, under every name it has had. */
const ASKED = /إغلاق النموذج؟|تجاهل التغييرات/

type Candidate = { id: string; name: string; kind: 'button' | 'link' | 'menu'; ends?: boolean }

/** Watches for the question from the first script on, so a flash of it is caught too. */
const WATCH = `(() => {
  window.__asked = []
  const asked = /إغلاق النموذج؟|تجاهل التغييرات/
  const check = (node) => {
    if (!(node instanceof Element)) return
    const found = node.matches('[role=alertdialog]') || node.querySelector('[role=alertdialog]')
    if (found || asked.test(node.textContent || '')) window.__asked.push((node.textContent || '').slice(0, 80))
  }
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) check(node)
  }).observe(document.documentElement, { childList: true, subtree: true })
})()`

/**
 * Tags the controls that may open a dialog with data-sweep (a stable key) and returns them,
 * one per key, so the same control is found again after a reload.
 */
const tag = (scope = 'main') => `(() => {
  const ends = ${ENDS_SESSION}
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const nameOf = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim()
  const here = location.pathname
  const seen = new Set()
  const out = []
  const scopes = [...document.querySelectorAll('${scope}')]
  for (const scope of scopes) {
    for (const el of scope.querySelectorAll('button, [role=button], a[href]')) {
      el.removeAttribute('data-sweep')
      // Inside a page that is itself a dialog (a record's details), its own controls count.
      if (!visible(el) || (el.closest('[role=dialog]') && !scope.matches('[role=dialog]'))) continue
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue
      const role = el.getAttribute('role')
      if (['tab', 'switch', 'checkbox', 'radio', 'combobox', 'menuitem', 'option'].includes(role)) continue
      const popup = el.getAttribute('aria-haspopup')
      if (popup === 'listbox') continue
      if (el.tagName === 'BUTTON' && el.type === 'submit' && el.form) continue
      const name = nameOf(el)
      let kind = popup === 'menu' || popup === 'true' ? 'menu' : el.tagName === 'A' ? 'link' : 'button'
      if (kind === 'link') {
        const url = new URL(el.href, location.href)
        if (url.origin !== location.origin) continue
        // Only links that stay on this page (a query) or open a record under it may open a dialog.
        const same = url.pathname === here || url.pathname.startsWith(here.replace(/\\/$/, '') + '/')
        if (!same || el.target === '_blank' || el.hasAttribute('download')) continue
        if (/\\/(print|export|imports\\/template)/.test(url.pathname)) continue
      }
      const key = kind + ':' + (kind === 'link' ? new URL(el.href, location.href).pathname.replace(/\\d+/g, 'N') + new URL(el.href, location.href).search.replace(/\\d+/g, 'N') : name)
      if (!name && kind !== 'menu') continue
      if (seen.has(key)) continue
      seen.add(key)
      // The key, not the position: opening a sidebar group adds controls before later ones.
      el.setAttribute('data-sweep', key)
      out.push({ id: key, name: name || '(بلا اسم)', kind, ends: kind !== 'menu' && ends.test(name) })
    }
  }
  return out
})()`

type Way = 'Escape' | 'X' | 'footer'
type Outcome = { page: string; control: string; dialog: string; way: Way; problem: string }
/** Why a control was not swept as a dialog; every control ends in a dialog or one of these. */
type SkipReason =
  | 'ends the session (named)'
  | 'signed out'
  | 'no dialog'
  | 'confirmation'
  | 'went to another page'
  | 'not found again'
type Skip = { page: string; control: string; reason: SkipReason }

class Sweep {
  problems: Outcome[] = []
  covered = new Map<string, Set<Way>>()
  skips: Skip[] = []
  /** Controls and menu items considered, and how many ended in a dialog or a logged skip. */
  considered = 0
  settled = 0
  private before = ''
  constructor(
    private page: Page,
    private label: string,
    private prepare: () => Promise<void>,
    private relogin: () => Promise<void>,
    private scope = 'main'
  ) {}

  private skip(control: string, reason: SkipReason) {
    this.skips.push({ page: this.label, control, reason })
    this.settled++
  }

  private async modal() {
    return this.page.locator(MODAL).last()
  }

  /** The modal the click opened: the first one beyond those already open before it. */
  private async openModal(already: number, timeout = 1500) {
    const modal = this.page.locator(MODAL).nth(already)
    try {
      await modal.waitFor({ state: 'visible', timeout })
      return modal
    } catch {
      return null
    }
  }

  private async titleOf() {
    const modal = await this.modal()
    const title = modal.locator(
      '[data-slot="dialog-title"], [data-slot="alert-dialog-title"], [data-slot="sheet-title"]'
    )
    return (await title.count())
      ? ((await title.first().textContent()) ?? '').trim()
      : '(بلا عنوان)'
  }

  /**
   * Clicks the control again from a fresh page; menus open first, then the item. Returns how
   * many modals were open before the click (the page itself may be one), or false.
   */
  private async trigger(candidate: Candidate, item?: string): Promise<number | false> {
    await this.prepare()
    const already = await this.page.locator(MODAL).count()
    this.before = this.page.url()
    // A page may render once more after loading and replace the tagged control: tag again.
    let clicked = false
    for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
      await this.page.evaluate(tag(this.scope))
      const control = this.page.locator(`[data-sweep=${JSON.stringify(candidate.id)}]`).first()
      if (!(await control.count())) return false
      clicked = await control
        .click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    }
    if (!clicked) return false
    if (item !== undefined) {
      const entry = this.page.getByRole('menuitem', { name: item, exact: true }).first()
      if (
        !(await entry.waitFor({ timeout: 2000 }).then(
          () => true,
          () => false
        ))
      )
        return false
      await entry.click()
    }
    return already
  }

  private async closeBy(way: Way) {
    const modal = await this.modal()
    if (way === 'Escape') {
      await this.page.keyboard.press('Escape')
      return true
    }
    if (way === 'X') {
      const x = modal.locator(
        ':scope > [data-slot="dialog-close"], :scope > [data-slot="sheet-close"]'
      )
      if (!(await x.count())) return false
      await x.first().click()
      return true
    }
    const footer = modal.locator(
      '[data-slot="dialog-footer"], [data-slot="long-dialog-footer"], [data-slot="alert-dialog-footer"], [data-slot="sheet-footer"]'
    )
    for (const name of ['إلغاء', 'إغلاق']) {
      const button = footer.getByRole('button', { name, exact: true })
      if (await button.count()) {
        await button.first().click()
        return true
      }
    }
    return false
  }

  /** Opens the dialog three times and closes it each way; records what went wrong. */
  async check(candidate: Candidate, item?: string) {
    const control = item ? `${candidate.name} ← ${item}` : candidate.name
    const already = await this.trigger(candidate, item)
    if (already === false) return this.skip(control, 'not found again')
    const first = await this.openModal(already)
    if (!first) {
      const now = new URL(this.page.url())
      if (now.pathname === '/login' || now.pathname.startsWith('/login/')) {
        this.skip(control, 'signed out')
        return this.relogin()
      }
      if (this.page.url() !== this.before) return this.skip(control, 'went to another page')
      // A popover or menu left open would hide the next control.
      await this.page.keyboard.press('Escape')
      return this.skip(control, 'no dialog')
    }
    if ((await first.getAttribute('data-dialog-mode')) === 'confirm') {
      await this.page.keyboard.press('Escape')
      return this.skip(control, 'confirmation')
    }
    const dialog = await this.titleOf()
    this.settled++
    // The same dialog behind many controls (one confirmation per permission) is checked once.
    if (this.covered.has(`${this.label} · ${dialog}`)) {
      await this.page.keyboard.press('Escape')
      return
    }
    const ways = this.covered.get(`${this.label} · ${dialog}`) ?? new Set<Way>()
    this.covered.set(`${this.label} · ${dialog}`, ways)
    for (const way of ['Escape', 'X', 'footer'] as Way[]) {
      if (way !== 'Escape') {
        const again = await this.trigger(candidate, item)
        if (again === false || !(await this.openModal(again))) {
          this.problems.push({ page: this.label, control, dialog, way, problem: 'did not reopen' })
          continue
        }
      }
      await this.page.evaluate('window.__asked = []')
      // This very element must go: hidden or removed. (A string waitForFunction would be
      // blocked by the application's Content Security Policy.)
      const opened = await this.page
        .locator(MODAL)
        .last()
        .elementHandle({ timeout: 2000 })
        .catch(() => null)
      if (!opened) continue
      if (!(await this.closeBy(way))) continue
      try {
        await opened.waitForElementState('hidden', { timeout: 3000 })
      } catch {
        // «إلغاء» in a record form returns to the record's details in the same dialog: the
        // form is gone when the title changed. The question itself is caught below.
        const now = (await this.page.locator(MODAL).count()) ? await this.titleOf() : ''
        if (now === dialog)
          this.problems.push({ page: this.label, control, dialog, way, problem: 'stayed open' })
      }
      await this.page.waitForTimeout(150)
      const asked = (await this.page.evaluate('window.__asked')) as string[]
      if (asked.length || (await this.page.getByText(ASKED).count()))
        this.problems.push({ page: this.label, control, dialog, way, problem: 'asked to confirm' })
      ways.add(way)
      // Leave nothing open for the next round (a dialog that stayed open, or the question).
      for (let i = 0; i < 3 && (await this.page.locator(MODAL).count()); i++)
        await this.page.keyboard.press('Escape')
    }
  }

  /** Every control on the page as the prepare step leaves it. */
  async run() {
    await this.prepare()
    const candidates = (await this.page.evaluate(tag(this.scope))) as Candidate[]
    for (const candidate of candidates) {
      if (candidate.kind !== 'menu') {
        this.considered++
        if (candidate.ends) this.skip(candidate.name, 'ends the session (named)')
        else await this.check(candidate)
        continue
      }
      // A menu: every item it offers may open a dialog.
      if ((await this.trigger(candidate)) === false) continue
      await this.page
        .getByRole('menuitem')
        .first()
        .waitFor({ timeout: 2000 })
        .catch(() => {})
      const texts = (await this.page.evaluate(
        `[...document.querySelectorAll('[role=menuitem]')].map((n) => n.textContent)`
      )) as string[]
      const items = texts.map((text) => text.replace(/\s+/g, ' ').trim())
      await this.page.keyboard.press('Escape')
      for (const item of items.filter(Boolean)) {
        this.considered++
        if (ENDS_SESSION.test(item))
          this.skip(`${candidate.name} ← ${item}`, 'ends the session (named)')
        else await this.check(candidate, item)
      }
    }
    return candidates
  }
}

/** The pages that open dialogs; tabs inside a page are swept one by one. */
type Target = { label: string; url: () => string; tabs?: boolean; scope?: string }

test.group('Clean close sweep: every dialog closes at once while untouched', (group) => {
  let admin: UiActor
  let memberId: number
  let recordId: number
  const report: Outcome[] = []
  const covered: string[] = []
  const skipped: Skip[] = []

  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير المسح' })
    await installSampleResources()
    const runtime = adula()
    const loaded = await runtime.actors.load(admin.user.id)
    const saved = await runtime.resources.save('ui_samples', loaded, {
      orgUnitId: admin.orgUnitId,
      title: `عينة المسح ${randomUUID().slice(0, 8)}`,
    })
    recordId = Number(saved.id)
    // A task of the administrator's own, so «مهامي» offers its close dialog.
    await runtime.assignments.assign('ui_samples', recordId, loaded, {
      assigneeId: admin.user.id,
      title: 'مهمة المسح',
    })
    const member = await seedActor([{ subject: 'ui_samples', action: 'read' }], {
      fullName: 'عضو المسح',
      orgUnitId: admin.orgUnitId,
    })
    memberId = member.user.id
    return () => removeSampleResources()
  })

  const targets: Target[] = [
    { label: 'المستخدمون', url: () => '/admin/users' },
    { label: 'مستخدم', url: () => `/admin/users/${memberId}` },
    { label: 'الأدوار', url: () => '/admin/roles' },
    { label: 'دور', url: () => `/admin/roles/${admin.roleId}` },
    { label: 'الهيكل التنظيمي', url: () => '/admin/org-units' },
    { label: 'الجلسات', url: () => '/admin/sessions' },
    { label: 'تفويضات الموافقات', url: () => '/admin/delegations' },
    { label: 'الإعدادات العامة', url: () => '/admin/settings', tabs: true },
    { label: 'القوائم المرجعية', url: () => '/admin/lookups' },
    { label: 'الترقيم التسلسلي', url: () => '/admin/sequences' },
    { label: 'قوالب الرسائل', url: () => '/admin/templates' },
    { label: 'قوالب الطباعة', url: () => '/admin/print-templates' },
    { label: 'الربط الخارجي', url: () => '/admin/webhooks' },
    { label: 'المساعد الذكي', url: () => '/admin/assistant' },
    { label: 'المظهر والهوية', url: () => '/admin/appearance' },
    { label: 'تشغيل النظام', url: () => '/admin/jobs' },
    { label: 'النسخ الاحتياطي', url: () => '/admin/backups' },
    { label: 'تدفقات فاشلة', url: () => '/admin/workflows' },
    { label: 'سجل النشاط', url: () => '/admin/activity' },
    { label: 'الملف الشخصي', url: () => '/account/profile' },
    { label: 'رموز API', url: () => '/account/tokens' },
    { label: 'جلساتي', url: () => '/account/sessions' },
    { label: 'تفويضاتي', url: () => '/account/delegations' },
    { label: 'النظرة العامة', url: () => '/' },
    // The header and sidebar once: the account menu (menu order), search and notifications.
    { label: 'الشريط العلوي والقائمة', url: () => '/', scope: 'header, aside' },
    { label: 'مهامي', url: () => '/my-tasks' },
    { label: 'الاستيرادات', url: () => '/imports' },
    { label: 'التنبيهات', url: () => '/notifications' },
    { label: 'قائمة السجلات', url: () => '/resources/ui_samples' },
    // The details are a dialog: the dialogs it opens (assignments, workflows, print) are nested.
    {
      label: 'تفاصيل السجل',
      url: () => `/resources/ui_samples/${recordId}`,
      scope: '[data-slot="dialog-content"]',
    },
  ]

  for (const target of targets) {
    test(`sweep: ${target.label}`, async ({ browserContext, visit, assert }) => {
      await browserContext.addInitScript(WATCH)
      await browserContext.loginAs(admin.user)
      const page = await visit(target.url())
      await page.setViewportSize({ width: 1440, height: 900 })
      // In-page tabs only (the administration tabs are links to other pages), once rendered.
      if (target.tabs)
        await page
          .locator('main [role=tab]:not(a)')
          .first()
          .waitFor({ timeout: 10_000 })
          .catch(() => {})
      const tabs = target.tabs
        ? ((await page.evaluate(
            `[...document.querySelectorAll('main [role=tab]:not(a)')].map((n) => n.textContent.trim())`
          )) as string[])
        : []
      for (const tab of [null, ...tabs]) {
        const label = tab ? `${target.label} / ${tab}` : target.label
        const sweep = new Sweep(
          page,
          label,
          async () => {
            await page.goto(target.url())
            await page.locator('main').first().waitFor()
            // Live updates may keep a connection open: settle briefly instead of waiting forever.
            await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
            if (tab)
              await page.locator('main [role=tab]:not(a)').filter({ hasText: tab }).first().click()
          },
          () => browserContext.loginAs(admin.user),
          target.scope
        )
        const candidates = await sweep.run()
        // Every control ended in a dialog or a logged skip: none was dropped silently.
        assert.equal(sweep.settled, sweep.considered, `${label}: every control is accounted for`)
        skipped.push(...sweep.skips)
        console.log(`[sweep] ${label}: ${candidates.map((c) => `${c.kind}:${c.name}`).join(' | ')}`)
        for (const [dialog, ways] of sweep.covered)
          covered.push(`${dialog} [${[...ways].join(', ')}]`)
        console.log(`[sweep] ${label} dialogs: ${[...sweep.covered.keys()].join(' | ')}`)
        report.push(...sweep.problems)
      }
    }).timeout(900_000)
  }

  test('one form of each kind asks only while a value differs from the opening one', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 1440, height: 900 })
    const confirm = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
    /** Change asks; the original value back closes at once, by Escape. */
    const asksOnlyWhileChanged = async (
      url: string,
      open: () => Promise<void>,
      title: string,
      change: () => Promise<void>,
      restore: () => Promise<void>
    ) => {
      await page.goto(url)
      await open()
      const dialog = page.getByRole('dialog', { name: title })
      await dialog.waitFor()
      await change()
      await page.keyboard.press('Escape')
      await confirm.waitFor()
      await page.getByRole('button', { name: 'متابعة التحرير', exact: true }).click()
      await confirm.waitFor({ state: 'hidden' })
      await restore()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await confirm.count(), 0, title)
    }
    const field = (title: string, label: string) =>
      page.getByRole('dialog', { name: title }).getByLabel(label, { exact: true })

    // A record form (the resource form declares its state with useDialogValue).
    await asksOnlyWhileChanged(
      '/resources/ui_samples',
      () => page.getByRole('link', { name: 'إضافة عينة', exact: true }).click(),
      'إضافة عينة',
      () => field('إضافة عينة', 'العنوان').fill('عنوان مؤقت'),
      () => field('إضافة عينة', 'العنوان').fill('')
    )
    // A form whose state is declared on the Dialog (`value`, the invitation).
    await asksOnlyWhileChanged(
      '/admin/users',
      () => page.getByRole('link', { name: 'دعوة مستخدم', exact: true }).first().click(),
      'دعوة مستخدم',
      () => field('دعوة مستخدم', 'الاسم الكامل').fill('اسم مؤقت'),
      () => field('دعوة مستخدم', 'الاسم الكامل').fill('')
    )
    // A plain form that declares nothing: the shared Dialog compares its controls.
    await asksOnlyWhileChanged(
      '/admin/settings',
      () => page.getByRole('button', { name: 'إضافة إعداد', exact: true }).click(),
      'إعداد جديد',
      () => field('إعداد جديد', 'المفتاح').fill('sweep.temporary'),
      () => field('إعداد جديد', 'المفتاح').fill('')
    )
    // Switches instead of text (the overview layout).
    const toggle = () =>
      page.getByRole('dialog', { name: 'تخصيص النظرة العامة' }).getByRole('switch').first().click()
    await asksOnlyWhileChanged(
      '/',
      () => page.getByRole('button', { name: /تخصيص/ }).first().click(),
      'تخصيص النظرة العامة',
      toggle,
      toggle
    )
    // A declared draft object with a set inside (the webhook's events): text and a checkbox.
    const event = () =>
      page.getByRole('dialog', { name: 'إضافة ربط خارجي' }).getByRole('checkbox').first().click()
    await asksOnlyWhileChanged(
      '/admin/webhooks',
      () => page.getByRole('button', { name: 'إضافة ربط', exact: true }).click(),
      'إضافة ربط خارجي',
      async () => {
        await field('إضافة ربط خارجي', 'الاسم').fill('ربط مؤقت')
        await event()
      },
      async () => {
        await field('إضافة ربط خارجي', 'الاسم').fill('')
        await event()
      }
    )
    // Declared drafts loaded from saved values: the identity and a message template.
    let company = ''
    await asksOnlyWhileChanged(
      '/admin/appearance',
      () => page.getByRole('button', { name: 'تعديل الهوية', exact: true }).click(),
      'تعديل الهوية',
      async () => {
        company = await field('تعديل الهوية', 'اسم الشركة').inputValue()
        await field('تعديل الهوية', 'اسم الشركة').fill(`${company} مؤقت`)
      },
      () => field('تعديل الهوية', 'اسم الشركة').fill(company)
    )
    let subject = ''
    await asksOnlyWhileChanged(
      '/admin/templates',
      () =>
        page
          .getByRole('button', { name: /^تعديل / })
          .first()
          .click(),
      'تعديل القالب',
      async () => {
        subject = await field('تعديل القالب', 'العنوان').inputValue()
        await field('تعديل القالب', 'العنوان').fill(`${subject} مؤقت`)
      },
      () => field('تعديل القالب', 'العنوان').fill(subject)
    )
  }).timeout(300_000)

  test('no dialog asked or stayed open', async ({ assert }) => {
    console.log(`[sweep] covered ${covered.length} dialogs:\n${covered.join('\n')}`)
    const reasons = Object.entries(
      Object.groupBy(skipped, (skip) => skip.reason) as Record<string, Skip[]>
    ).map(([reason, list]) => `${reason}: ${list.length}`)
    console.log(`[sweep] skipped ${skipped.length} controls (${reasons.join(', ')}):`)
    console.log(skipped.map((skip) => `${skip.page} · ${skip.control}: ${skip.reason}`).join('\n'))
    // Only the named session-ending controls are skipped without clicking them.
    for (const skip of skipped.filter((item) => item.reason === 'ends the session (named)'))
      assert.match(skip.control.split(' ← ').pop() ?? '', ENDS_SESSION)
    if (report.length)
      console.log(
        `[sweep] problems:\n${report.map((p) => `${p.page} · ${p.control} · ${p.dialog} · ${p.way}: ${p.problem}`).join('\n')}`
      )
    assert.deepEqual(report, [])
  })
})
