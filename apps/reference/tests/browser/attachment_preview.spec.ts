import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import { registerUpload } from 'adula'
import { adula } from '#services/adula'
import { screenshotDir, seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const knex = () => db.connection().getWriteClient()
// The server tsconfig omits the DOM lib; this runs inside the page through evaluate().
type Picture = { complete: boolean; naturalWidth: number }

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
const TEXT = `سطر المعاينة ${randomUUID().slice(0, 8)}\nسطر ثانٍ`

/**
 * ADR 047: a record of order_documents (multiple: true) lists its files on the details page;
 * an image and a text file open in the preview Dialog and the Dialog closes again.
 */
test.group('Attachment preview dialog', (group) => {
  let admin: UiActor
  let id: number
  const paths: string[] = []

  group.setup(async () => {
    admin = await seedActor([{ subject: 'order_documents', action: 'manage' }], {
      fullName: 'مراجع المستندات',
    })
    const files: number[] = []
    for (const [name, body, mimeType, extname] of [
      ['صورة الإيصال.png', PNG, 'image/png', 'png'],
      ['ملاحظات.txt', Buffer.from(TEXT), 'text/plain', 'txt'],
      ['رسم.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml', 'svg'],
    ] as const) {
      const stored = `${randomUUID()}.${extname}`
      const path = `resources/order_documents/files/${stored}`
      await drive.use('local').put(path, body)
      paths.push(path)
      const row = await registerUpload(knex(), {
        disk: 'local',
        path,
        name: stored,
        originalName: name,
        size: body.length,
        mimeType,
        extname,
        data: { path },
        uploadedBy: admin.user.id,
        resource: 'order_documents',
        field: 'files',
      })
      files.push(row.id)
    }
    const actor = await adula().actors.load(admin.user.id)
    const saved = await adula().resources.save('order_documents', actor, {
      title: 'مستندات المعاينة',
      orgUnitId: admin.orgUnitId,
      files,
    })
    id = Number(saved.id)
    return async () => {
      for (const path of paths)
        await drive
          .use('local')
          .delete(path)
          .catch(() => {})
    }
  })

  test('previews an image and a text file in a dialog that closes', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit(`/resources/order_documents/${id}`)
    await page.getByText('صورة الإيصال.png').first().waitFor()
    await page.getByText('ملاحظات.txt').first().waitFor()
    await page.getByText('رسم.svg').first().waitFor()
    // SVG only downloads: no preview button is offered for it.
    assert.equal(await page.getByRole('button', { name: 'معاينة رسم.svg' }).count(), 0)

    await page.getByRole('button', { name: 'معاينة صورة الإيصال.png' }).click()
    const imageDialog = page.getByRole('dialog', { name: 'صورة الإيصال.png' })
    await imageDialog.waitFor()
    const image = imageDialog.getByRole('img', { name: 'صورة الإيصال.png' })
    await image.waitFor()
    assert.match((await image.getAttribute('src')) ?? '', /^\/attachments\/\d+\?preview=1$/)
    await page.waitForFunction(
      (element) => (element as unknown as Picture).complete,
      await image.elementHandle()
    )
    assert.equal(await image.evaluate((element) => (element as unknown as Picture).naturalWidth), 1)
    assert.equal(
      await imageDialog.getByRole('link', { name: 'تنزيل' }).getAttribute('download'),
      'صورة الإيصال.png'
    )
    await page.screenshot({ path: join(await screenshotDir(), 'attachment-preview-image.png') })
    await page.keyboard.press('Escape')
    await imageDialog.waitFor({ state: 'hidden' })
    // Escape closes only the preview, not the details Dialog beneath it.
    await page.getByRole('dialog', { name: 'تفاصيل · مستندات الطلبات' }).waitFor()

    await page.getByRole('button', { name: 'معاينة ملاحظات.txt' }).click()
    const textDialog = page.getByRole('dialog', { name: 'ملاحظات.txt' })
    await textDialog.waitFor()
    const pre = textDialog.locator('pre')
    await pre.waitFor()
    const shown = await pre.innerText()
    assert.equal(shown.trim(), TEXT)
    await textDialog.getByRole('button', { name: 'إغلاق', exact: true }).first().click()
    await textDialog.waitFor({ state: 'hidden' })
    // Closing a preview leaves the record details Dialog it was opened from.
    const details = page.getByRole('dialog', { name: 'تفاصيل · مستندات الطلبات' })
    await details.waitFor()
    assert.equal(await page.getByRole('dialog').count(), 1)
  })
})
