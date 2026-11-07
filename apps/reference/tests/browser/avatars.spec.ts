import { test } from '@japa/runner'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { adula } from '#services/adula'
import {
  installSampleResources,
  longDialogLayout,
  removeSampleResources,
  screenshotDir,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

function chunk(type: string, data: Buffer = Buffer.alloc(0)) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}
/** A real, decodable 800×600 photo-sized PNG: larger than the saved picture on purpose. */
function photo(width = 800, height = 600) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) row.set([x % 256, y % 256, 160], 1 + x * 3)
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND'),
  ])
}

test.group('Profile picture browser acceptance (#158)', (group) => {
  let owner: UiActor
  let admin: UiActor
  let colleague: UiActor
  let recordId: number
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'منى المديرة' })
    owner = await seedActor([{ subject: 'ui_samples', action: 'manage' }], {
      fullName: 'ريم الحربي',
      orgUnitId: admin.orgUnitId,
    })
    colleague = await seedActor([{ subject: 'ui_samples', action: 'view' }], {
      fullName: 'ماجد العلي',
      orgUnitId: admin.orgUnitId,
      level: 0,
    })
    await installSampleResources()
    const actor = await adula().actors.load(owner.user.id)
    const saved = await adula().resources.save('ui_samples', actor, {
      title: 'عينة الصور الشخصية',
      orgUnitId: owner.orgUnitId,
    })
    recordId = Number(saved.id)
    await adula().collaboration.comment('ui_samples', recordId, actor, { body: 'تعليق بصورة' })
    return () => removeSampleResources()
  })

  test('upload and frame a picture, then find it in the account menu and on a comment', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(owner.user)
    const page = await visit('/account/profile')
    const menu = page.getByRole('button', { name: 'قائمة الحساب' })
    // Initials before any picture.
    assert.equal(await menu.locator('img').count(), 0)
    assert.include(await menu.innerText(), 'را')

    await page.getByRole('button', { name: 'اختيار صورة' }).click()
    const dialog = page.getByRole('dialog', { name: 'الصورة الشخصية' })
    await dialog
      .getByLabel('ملف الصورة')
      .setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: photo() })
    const frame = dialog.getByTestId('avatar-crop')
    await frame.waitFor()
    await frame.focus()
    await page.keyboard.press('ArrowRight')
    const zoom = dialog.getByRole('slider')
    await zoom.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await dialog.getByRole('button', { name: 'حفظ الصورة' }).click()
    await dialog.waitFor({ state: 'hidden' })

    const image = menu.locator('img')
    await image.waitFor()
    assert.match(
      String(await image.getAttribute('src')),
      new RegExp(`^/users/${owner.user.id}/avatar\\?v=\\d+$`)
    )
    // A function, not a string: Playwright evaluates a string as an expression.
    const size = await image.evaluate((img) => {
      const picture = img as unknown as { naturalWidth: number; naturalHeight: number }
      return [picture.naturalWidth, picture.naturalHeight]
    })
    assert.isAtMost(size[0], 512)
    assert.equal(size[0], size[1])
    await page.screenshot({ path: join(await screenshotDir(), 'avatar-profile.png') })

    // A colleague sees the same picture beside the comment.
    await browserContext.clearCookies()
    await browserContext.loginAs(colleague.user)
    const record = await visit(`/resources/ui_samples/${recordId}`)
    const panel = record.getByRole('region', { name: 'التعاون حول السجل' })
    await panel.getByText('تعليق بصورة').waitFor()
    // The comment carries the versioned URL (ADR 050), so the browser may cache it for good.
    const avatar = panel.locator(`img[src^="/users/${owner.user.id}/avatar?v="]`)
    await avatar.waitFor()
    const loaded = await avatar.evaluate(
      (img) => (img as unknown as { naturalWidth: number }).naturalWidth
    )
    assert.isAbove(loaded, 0)
  })

  test('an administrator replaces a picture; removing it brings the initials back', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit(`/admin/users/${colleague.user.id}`)
    await page.getByRole('button', { name: 'اختيار صورة' }).click()
    const dialog = page.getByRole('dialog', { name: /الصورة الشخصية لـ/ })
    await dialog
      .getByLabel('ملف الصورة')
      .setInputFiles({ name: 'team.png', mimeType: 'image/png', buffer: photo(300, 300) })
    await dialog.getByTestId('avatar-crop').waitFor()
    await dialog.getByRole('button', { name: 'حفظ الصورة' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'تغيير الصورة' }).waitFor()

    await browserContext.clearCookies()
    await browserContext.loginAs(colleague.user)
    const own = await visit('/account/profile')
    const menu = own.getByRole('button', { name: 'قائمة الحساب' })
    await menu.locator('img').waitFor()
    await own.getByRole('button', { name: 'إزالة الصورة' }).click()
    await own.getByRole('dialog').getByRole('button', { name: 'إزالة الصورة' }).click()
    await own.getByRole('button', { name: 'اختيار صورة' }).waitFor()
    assert.equal(await menu.locator('img').count(), 0)
    assert.include(await menu.innerText(), 'ما')
  })

  test('on a phone the picture dialog keeps its footer on screen while the body scrolls', async ({
    browserContext,
    visit,
    assert,
  }) => {
    // The colleague ends the previous test without a picture, so the card offers «اختيار صورة».
    await browserContext.loginAs(colleague.user)
    const page = await visit('/account/profile')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('button', { name: 'اختيار صورة' }).click()
    const dialog = page.getByRole('dialog', { name: 'الصورة الشخصية' })
    await dialog
      .getByLabel('ملف الصورة')
      .setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: photo() })
    await dialog.getByTestId('avatar-crop').waitFor()
    // Reach the end of the body, as a reader would; the header and actions must not move away.
    await dialog.getByRole('slider').focus()
    assert.deepEqual(await longDialogLayout(dialog, 812), {
      footerOnScreen: true,
      headerOnScreen: true,
      bodyScrolls: true,
    })
    const save = dialog.getByRole('button', { name: 'حفظ الصورة' })
    assert.isTrue(await save.isVisible())
    assert.isTrue(await save.isEnabled())
    await page.screenshot({ path: join(await screenshotDir(), 'avatar-dialog-mobile.png') })
    // A chosen picture is a change: «إلغاء» asks before it discards the picture.
    await dialog.getByRole('button', { name: 'إلغاء' }).click()
    const guard = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
    await guard.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  })
})
