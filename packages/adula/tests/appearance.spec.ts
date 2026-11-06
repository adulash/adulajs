import { test } from '@japa/runner'
import sharp from 'sharp'
import {
  AdulaError,
  Appearance,
  APPEARANCE_SETTING_KEY,
  BASE_LOGO_RECORD,
  SettingsAdmin,
  checkPrimaryColor,
  contrast,
  detectLogoType,
  logoHeaders,
  prepareLogoImage,
} from '../index.js'
import { db, setup } from './helpers.js'

const admin = { id: 1 }
const TZ = 'Asia/Riyadh'
/** A clock the test moves; the service reads it on every resolve. */
function service(at: string) {
  const appearance = new Appearance(db, { timeZone: TZ, cacheMs: 0 })
  appearance.clock = () => new Date(at)
  return appearance
}

async function failure(run: Promise<unknown>) {
  try {
    await run
  } catch (error) {
    if (error instanceof AdulaError) return error
    throw error
  }
  throw new Error('expected an AdulaError')
}

/** The AdulaError code a call fails with. */
const code = (run: Promise<unknown>) => failure(run).then((error) => error.code)
const image = (format: 'png' | 'jpeg' | 'webp', width = 64, height = 32) =>
  sharp({ create: { width, height, channels: 3, background: '#006c35' } })
    .toFormat(format)
    .withMetadata({ exif: { IFD0: { ImageDescription: 'secret-metadata' } } })
    .toBuffer()

async function storedLogo(appearance: Appearance, format: 'png' | 'jpeg' | 'webp' = 'png') {
  const prepared = await prepareLogoImage(await image(format))
  return appearance.registerLogo(admin, {
    disk: 'fs',
    path: `appearance/${Math.random().toString(16).slice(2)}.${prepared.extname}`,
    image: prepared,
  })
}

test.group('Appearance colours (ADR 053)', () => {
  test('a colour passes only when both themes reach WCAG AA', ({ assert }) => {
    const green = checkPrimaryColor('#006C35')
    assert.isTrue(green.ok)
    if (!green.ok) return
    assert.equal(green.theme.light['--primary'], '#006c35')
    assert.equal(green.theme.light['--primary-foreground'], '#ffffff')
    // The dark theme lightens the colour until it reads on the dark background.
    assert.notEqual(green.theme.dark['--primary'], '#006c35')
    assert.isAtLeast(contrast(green.theme.dark['--primary'], '#0a0a0a'), 4.5)
    assert.isAtLeast(
      contrast(green.theme.dark['--primary'], green.theme.dark['--primary-foreground']),
      4.5
    )

    const yellow = checkPrimaryColor('#ffd400')
    assert.isFalse(yellow.ok)
    if (!yellow.ok) assert.match(yellow.reason, /التباين .*4\.5:1/)
    for (const value of ['red', '#fff', 'url(x)', '#006c35; color: red', null])
      assert.isFalse(checkPrimaryColor(value).ok)
  })
})

test.group('Appearance logos (ADR 053)', (group) => {
  group.each.setup(async () => {
    await setup()
  })

  test('PNG, JPEG and WebP are re-encoded without metadata; SVG and others are refused', async ({
    assert,
  }) => {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const original = await image(format, 2000, 600)
      const logo = await prepareLogoImage(original)
      assert.equal(logo.type, format)
      assert.isAtMost(logo.width, 1024)
      assert.isAtMost(logo.height, 512)
      assert.notInclude(logo.bytes.toString('latin1'), 'secret-metadata')
      assert.equal(detectLogoType(logo.bytes), format)
    }
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    )
    assert.equal(await code(prepareLogoImage(svg)), 'E_LOGO_TYPE')
    const html = Buffer.from('<html><script>alert(1)</script></html>')
    assert.equal(await code(prepareLogoImage(html)), 'E_LOGO_TYPE')
    const gif = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#000000' },
    })
      .gif()
      .toBuffer()
    assert.equal(await code(prepareLogoImage(gif)), 'E_LOGO_TYPE')
    // PNG bytes followed by a script still decode as a PNG; the script does not survive.
    const smuggled = Buffer.concat([await image('png'), Buffer.from('<script>alert(1)</script>')])
    const cleaned = await prepareLogoImage(smuggled)
    assert.notInclude(cleaned.bytes.toString('latin1'), '<script>')
    const big = Buffer.alloc(1024 * 1024 + 1)
    assert.equal(await code(prepareLogoImage(big)), 'E_LOGO_SIZE')
    const headers = logoHeaders({ id: 7, mimeType: 'image/svg+xml', size: 10 })
    assert.equal(headers['Content-Type'], 'application/octet-stream')
    assert.equal(headers['X-Content-Type-Options'], 'nosniff')
  })
})

test.group('Appearance identity and occasions (ADR 053)', (group) => {
  group.each.setup(async () => {
    await setup()
  })

  test('the identity validates its texts and colour and logs each change', async ({ assert }) => {
    const appearance = service('2026-11-06T09:00:00Z')
    const logo = await storedLogo(appearance)
    const { identity } = await appearance.saveIdentity(admin, {
      company: '  شركة عدولة  ',
      logoId: logo.id,
      loginTitle: 'مرحبًا بك',
      primaryColor: '#006C35',
    })
    assert.equal(identity.company, 'شركة عدولة')
    assert.equal(identity.primaryColor, '#006c35')
    const bound = await appearance.logo(logo.id)
    assert.equal(bound!.recordId, BASE_LOGO_RECORD)

    const contrastRefused = await failure(
      appearance.saveIdentity(admin, { primaryColor: '#ffd400' })
    )
    assert.equal(contrastRefused.code, 'E_APPEARANCE_CONTRAST')
    assert.equal(
      await code(appearance.saveIdentity(admin, { company: 'سطر\nآخر' })),
      'E_APPEARANCE_INPUT'
    )
    assert.equal(
      await code(appearance.saveIdentity(admin, { css: 'body{}' })),
      'E_APPEARANCE_INPUT'
    )
    assert.equal(
      await code(appearance.saveIdentity(admin, { company: 'x'.repeat(121) })),
      'E_APPEARANCE_INPUT'
    )
    // The generic settings screen cannot write around these checks.
    const settings = new SettingsAdmin(db)
    const refused = await failure(
      settings.upsert(1, { key: APPEARANCE_SETTING_KEY, scope: 'system', value: {} })
    )
    assert.equal(refused.status, 403)

    // A new logo retires the previous one; the host deletes the returned file.
    const second = await storedLogo(appearance, 'webp')
    const { removed } = await appearance.saveIdentity(admin, { logoId: second.id })
    assert.lengthOf(removed, 1)
    assert.isNull(await appearance.logo(logo.id))

    const actions = await db('activities')
      .where('resource', 'core.appearance')
      .orderBy('id')
      .pluck('action')
    assert.includeMembers(actions, ['logo.upload', 'identity.update'])

    const reset = await appearance.resetIdentity(admin)
    assert.lengthOf(reset, 1)
    const cleared = await appearance.identity()
    assert.isNull(cleared.company)
    const resolved = await appearance.resolve()
    assert.isNull(resolved.theme)
  })

  test('one occasion at a time: overlapping ranges are refused, edges included', async ({
    assert,
  }) => {
    const appearance = service('2026-09-01T09:00:00Z')
    const { occasion } = await appearance.saveOccasion(admin, {
      name: 'اليوم الوطني',
      startsOn: '2026-09-20',
      endsOn: '2026-09-24',
      primaryColor: '#006c35',
      banner: 'كل عام والوطن بخير',
    })
    const overlap = await failure(
      appearance.saveOccasion(admin, {
        name: 'أخرى',
        startsOn: '2026-09-24',
        endsOn: '2026-09-30',
        banner: 'x',
      })
    )
    assert.equal(overlap.code, 'E_APPEARANCE_OVERLAP')
    assert.include(overlap.message, 'اليوم الوطني')
    // The day after the end is free; editing an occasion does not collide with itself.
    await appearance.saveOccasion(admin, {
      name: 'بعدها',
      startsOn: '2026-09-25',
      endsOn: '2026-09-26',
      banner: 'x',
    })
    await appearance.saveOccasion(
      admin,
      { name: 'اليوم الوطني ٩٦', startsOn: '2026-09-21', endsOn: '2026-09-24', banner: 'y' },
      occasion.id
    )
    assert.equal(
      await code(
        appearance.saveOccasion(admin, {
          name: 'مقلوبة',
          startsOn: '2026-10-05',
          endsOn: '2026-10-01',
          banner: 'x',
        })
      ),
      'E_APPEARANCE_INPUT'
    )
    assert.equal(
      await code(
        appearance.saveOccasion(admin, {
          name: 'فارغة',
          startsOn: '2026-10-05',
          endsOn: '2026-10-06',
        })
      ),
      'E_APPEARANCE_INPUT'
    )
    assert.equal(
      await code(
        appearance.saveOccasion(admin, {
          name: 'تاريخ غير حقيقي',
          startsOn: '2026-02-30',
          endsOn: '2026-03-01',
          banner: 'x',
        })
      ),
      'E_APPEARANCE_INPUT'
    )
  })

  test('an occasion applies on its dates in the system time zone and expires by itself', async ({
    assert,
  }) => {
    const appearance = service('2026-09-19T12:00:00Z')
    await appearance.saveIdentity(admin, {
      company: 'عدولة',
      primaryColor: '#1d4ed8',
      loginTitle: 'الدخول',
    })
    const logo = await storedLogo(appearance)
    await appearance.saveOccasion(admin, {
      name: 'اليوم الوطني',
      startsOn: '2026-09-20',
      endsOn: '2026-09-23',
      primaryColor: '#006c35',
      logoId: logo.id,
      banner: 'كل عام والوطن بخير',
      loginTitle: 'أهلًا في يومنا الوطني',
    })
    const before = await appearance.resolve()
    assert.isNull(before.occasion)
    assert.equal(before.theme!.light['--primary'], '#1d4ed8')

    // 2026-09-19 21:30 UTC is already 2026-09-20 00:30 in Riyadh.
    appearance.clock = () => new Date('2026-09-19T21:30:00Z')
    const during = await appearance.resolve()
    assert.equal(during.occasion!.name, 'اليوم الوطني')
    assert.equal(during.theme!.light['--primary'], '#006c35')
    assert.equal(during.logoId, logo.id)
    assert.equal(during.banner, 'كل عام والوطن بخير')
    assert.equal(during.login.title, 'أهلًا في يومنا الوطني')
    assert.equal(during.company, 'عدولة')

    appearance.clock = () => new Date('2026-09-23T20:59:00Z')
    const lastEvening = await appearance.resolve()
    assert.equal(lastEvening.occasion!.name, 'اليوم الوطني')
    // Midnight in Riyadh on the 24th: the base identity is back, with no job.
    appearance.clock = () => new Date('2026-09-23T21:00:00Z')
    const after = await appearance.resolve()
    assert.isNull(after.occasion)
    assert.isNull(after.banner)
    assert.equal(after.theme!.light['--primary'], '#1d4ed8')
    assert.equal(after.login.title, 'الدخول')
  })

  test('a logo is bound to one owner and cannot be taken by another', async ({ assert }) => {
    const appearance = service('2026-01-01T00:00:00Z')
    const logo = await storedLogo(appearance)
    await appearance.saveIdentity(admin, { logoId: logo.id })
    const taken = await failure(
      appearance.saveOccasion(admin, {
        name: 'x',
        startsOn: '2026-02-01',
        endsOn: '2026-02-02',
        logoId: logo.id,
      })
    )
    assert.equal(taken.code, 'E_APPEARANCE_INPUT')
    // A profile picture or any other attachment is not an appearance logo.
    const [other] = await db('attachments')
      .insert({
        disk: 'fs',
        path: 'x/other.png',
        name: 'other.png',
        original_name: 'other.png',
        size: 1,
        mime_type: 'image/png',
        extname: 'png',
        data: '{}',
        uploaded_by: 1,
        resource: 'core_users',
        field: 'avatar',
      })
      .returning('id')
    assert.isNull(await appearance.logo(Number(other.id ?? other)))
    assert.equal(
      await code(appearance.saveIdentity(admin, { logoId: Number(other.id ?? other) })),
      'E_APPEARANCE_INPUT'
    )
  })
})
