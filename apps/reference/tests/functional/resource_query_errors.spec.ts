import { test } from '@japa/runner'
import User from '#models/user'
import { adula } from '#services/adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }
const cursorOf = (value: unknown) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')

/**
 * Malformed list queries are client errors over HTTP: a filter value that does not fit
 * the field's column type is 422 E_FILTER and a forged cursor is 422 E_CURSOR, never a
 * PostgreSQL error surfacing as 500. Both the session UI route and the bearer API share it.
 */
test.group('Resource list queries reject mistyped filters and forged cursors', (group) => {
  let admin: UiActor
  let secret: string
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الاستعلام' })
    const actor = await adula().actors.load(admin.user.id)
    for (const findings of ['الأولى', 'الثانية'])
      await adula().resources.save('order_inspections', actor, {
        inspector: admin.user.id,
        findings,
        orgUnitId: admin.orgUnitId,
      })
    const token = await User.accessTokens.create(admin.user, ['read'], {
      name: 'استعلام',
      expiresIn: '30 days',
    })
    secret = token.value!.release()
  })

  const routes = [
    { label: 'session', base: '/resources/order_inspections', bearer: false },
    { label: 'bearer', base: '/api/v1/resources/order_inspections', bearer: true },
  ]

  for (const route of routes) {
    test(`${route.label}: a non-integer value for an integer filter is 422 E_FILTER`, async ({
      client,
      assert,
    }) => {
      const get = (qs: Record<string, unknown>) => {
        const request = client.get(route.base).qs(qs).headers(json)
        return route.bearer
          ? request.header('Authorization', `Bearer ${secret}`)
          : request.loginAs(admin.user)
      }
      const valid = await get({ filters: { inspector: String(admin.user.id) } })
      valid.assertStatus(200)
      assert.isAtLeast(valid.body().data.length, 2)
      for (const value of ['abc', '1.5', '99999999999', "1' OR '1'='1"]) {
        const response = await get({ filters: { inspector: value } })
        response.assertStatus(422)
        assert.equal(response.body().error.code, 'E_FILTER', value)
      }
    })

    test(`${route.label}: a forged cursor is 422 E_CURSOR; the issued cursor pages`, async ({
      client,
      assert,
    }) => {
      const get = (qs: Record<string, unknown>) => {
        const request = client.get(route.base).qs(qs).headers(json)
        return route.bearer
          ? request.header('Authorization', `Bearer ${secret}`)
          : request.loginAs(admin.user)
      }
      const first = await get({ limit: 1, sort: 'id', direction: 'desc' })
      first.assertStatus(200)
      const issued = first.body().meta.nextCursor as string
      assert.isString(issued)
      const second = await get({ limit: 1, sort: 'id', direction: 'desc', cursor: issued })
      second.assertStatus(200)
      assert.notEqual(second.body().data[0].id, first.body().data[0].id)

      const decoded = JSON.parse(Buffer.from(issued, 'base64url').toString())
      for (const cursor of [
        'not base64 at all!',
        cursorOf('{"broken"'),
        cursorOf('[]'),
        cursorOf({ ...decoded, id: 'x' }),
        cursorOf({ ...decoded, value: "1' OR '1'='1" }),
        cursorOf({ ...decoded, sort: 'findings' }),
        cursorOf({ ...decoded, id: 99999999999, value: 99999999999 }),
      ]) {
        const response = await get({ limit: 1, sort: 'id', direction: 'desc', cursor })
        response.assertStatus(422)
        assert.equal(response.body().error.code, 'E_CURSOR', cursor)
      }
    })
  }
})
