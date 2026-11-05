import { test } from '@japa/runner'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import {
  installSampleResources,
  removeSampleResources,
  screenshotDir,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

/**
 * File fields speak the interface language: the browser's own control, with its English
 * "Choose File / No file chosen", never shows. Runs in light mode and, in the dark suite
 * (pnpm test:browser:dark), in dark mode.
 */
test.group('Translated file fields', (group) => {
  let clerk: UiActor
  group.setup(async () => {
    clerk = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'رافع الملفات' })
    await installSampleResources()
    return () => removeSampleResources()
  })

  const theme = (page: Page) =>
    page.evaluate<string>('document.documentElement.classList.contains("dark") ? "dark" : "light"')

  /** Checks one file field from the label a user reads to the file name they chose. */
  async function checkField(
    page: Page,
    scope: Locator,
    field: {
      label: string
      hint?: string
      file: { name: string; mimeType: string; buffer: Buffer }
    },
    assert: { equal: Function; isTrue: Function; include: Function }
  ) {
    // No native file control is visible, only the translated button and its empty state.
    const native = scope.locator('input[type="file"]')
    assert.equal(await native.count(), 1)
    assert.isTrue(await native.isHidden())
    assert.equal(await scope.locator('input[type="file"]:visible').count(), 0)
    const choose = scope.getByRole('button', { name: 'اختيار ملف', exact: true })
    await choose.waitFor()
    // The button uses the sm size of the button scale (h-8), not a height of its own. Its
    // computed height is read, exactly, not the bounding box, which the dialog's opening zoom
    // scales while it runs.
    const height = await choose.evaluate((button) => {
      const view = globalThis as unknown as {
        getComputedStyle: (node: unknown) => { height: string }
      }
      return view.getComputedStyle(button).height
    })
    assert.equal(height, '32px')
    await scope.getByText('لم يُختر أي ملف').waitFor()

    // Keyboard users reach the button, hear the field label with it and open the picker.
    await choose.focus()
    const described: string[] = []
    for (const id of ((await choose.getAttribute('aria-describedby')) ?? '').split(' '))
      described.push(((await page.locator(`[id="${id}"]`).textContent()) ?? '').trim())
    assert.include(described, field.label)
    // A hint the page gives the field, such as the accepted types, is read with the button.
    if (field.hint) assert.include(described, field.hint)
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')
    const picker = await chooser
    await picker.setFiles(field.file)

    // The chosen file's name replaces the empty state; the button offers a change.
    await scope.getByText(field.file.name, { exact: true }).waitFor()
    assert.equal(await scope.getByText('لم يُختر أي ملف').count(), 0)
    await scope.getByRole('button', { name: 'تغيير الملف' }).waitFor()
    assert.equal(await scope.locator('input[type="file"]:visible').count(), 0)

    // The label still names the hidden input, so forms and tests can set files through it.
    await scope.getByLabel(field.label).setInputFiles(field.file)
  }

  test('the import dialog chooses a file with an Arabic button and shows its name', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(clerk.user)
    const page = await visit('/resources/ui_samples')
    await page.getByRole('button', { name: 'استيراد من ملف' }).click()
    const dialog = page.getByRole('dialog', { name: 'استيراد إلى عينات الواجهة' })
    await checkField(
      page,
      dialog,
      {
        label: 'الملف',
        file: {
          name: 'عينات.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(`البيان,الوحدة\nمن المتصفح,${clerk.orgUnitId}\n`),
        },
      },
      assert
    )
    await page.screenshot({
      path: join(await screenshotDir(), `file-input-import-${await theme(page)}.png`),
    })
  })

  test('the profile picture dialog uses the same translated file field', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(clerk.user)
    const page = await visit('/account/profile')
    await page.getByRole('button', { name: 'اختيار صورة' }).click()
    const dialog = page.getByRole('dialog', { name: 'الصورة الشخصية' })
    // A file the dialog refuses is enough: the field shows its name before the type check.
    await checkField(
      page,
      dialog,
      {
        label: 'ملف الصورة',
        hint: 'الأنواع المقبولة: PNG وJPEG وWebP.',
        file: { name: 'ملاحظات.txt', mimeType: 'text/plain', buffer: Buffer.from('نص') },
      },
      assert
    )
    await page.screenshot({
      path: join(await screenshotDir(), `file-input-avatar-${await theme(page)}.png`),
    })
  })
})
