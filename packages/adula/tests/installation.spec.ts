import { test } from '@japa/runner'
import { mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { syncAgentAssets, managedRules, agentAssets, digest } from '../src/commands/agent_assets.js'
import { diagnoseAgentSkills } from '../src/commands/doctor.js'
import { withAdulaDatabase } from '../src/database/configure.js'
import {
  ActorStore,
  Settings,
  administratorExists,
  buildAbility,
  grantInstallAdministrator,
  resolveInstallAdministrator,
} from '../index.js'
import { db, registry, setup } from './helpers.js'
import { seedActor } from './helpers/actors.js'

test.group('Independent installation contracts', () => {
  test('agent updates preserve project rules and detect malformed boundaries before writing', async ({
    assert,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'adula-install-'))
    const rules = '## Project rules\nKeep our own deployment and custom pages.\n'
    await writeFile(join(root, 'AGENTS.md'), rules)
    await syncAgentAssets(root)
    const installed = await readFile(join(root, 'AGENTS.md'), 'utf8')
    assert.include(installed, rules)
    assert.isNotEmpty(managedRules(installed))
    await syncAgentAssets(root)
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), installed)
    const lock = JSON.parse(await readFile(join(root, 'adula.lock.json'), 'utf8'))
    assert.match(lock.skills['.agents/skills/adula-idea-review/SKILL.md'], /^[a-f0-9]{64}$/)
    // The five on-demand reviewers ship with the managed skills (plan section 11).
    for (const reviewer of ['module', 'security', 'schema', 'ui', 'perf']) {
      const path = `.agents/skills/adula-${reviewer}-review/SKILL.md`
      assert.match(lock.skills[path], /^[a-f0-9]{64}$/)
      assert.match(await readFile(join(root, path), 'utf8'), new RegExp(`name: ${reviewer}-review`))
    }
    const malformed = '<!-- adula:start -->\nUser content without an end marker'
    await writeFile(join(root, 'AGENTS.md'), malformed)
    await assert.rejects(() => syncAgentAssets(root), /Malformed/)
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), malformed)
  })
  test('ships every managed skill, repairs missing or modified skills and preserves company identity', async ({
    assert,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'adula-design-'))
    const identity = '# Company identity\nUser-supplied logo: public/brand/company.svg\n'
    const customSkill = '# Project-owned workflow\n'
    await mkdir(join(root, 'docs'), { recursive: true })
    await mkdir(join(root, '.agents/skills/project-workflow'), { recursive: true })
    await writeFile(join(root, 'docs/design-identity.md'), identity)
    await writeFile(join(root, '.agents/skills/project-workflow/SKILL.md'), customSkill)
    await syncAgentAssets(root)
    const assets = await agentAssets()
    const designPath = '.agents/skills/adula-frontend-design/SKILL.md'
    assert.include(Object.keys(assets.skills), designPath)
    const lock = JSON.parse(await readFile(join(root, 'adula.lock.json'), 'utf8'))
    for (const [path, content] of Object.entries(assets.skills)) {
      assert.equal(await readFile(join(root, path), 'utf8'), content)
      assert.equal(lock.skills[path], digest(content))
    }
    const expectStatus = async (status: 'pass' | 'fail') => {
      const finding = await diagnoseAgentSkills(root)
      assert.equal(finding.status, status)
    }
    await expectStatus('pass')
    await writeFile(join(root, designPath), 'Modified design instructions')
    await expectStatus('fail')
    await syncAgentAssets(root)
    await expectStatus('pass')
    await unlink(join(root, designPath))
    await expectStatus('fail')
    await syncAgentAssets(root)
    await expectStatus('pass')
    assert.equal(await readFile(join(root, 'docs/design-identity.md'), 'utf8'), identity)
    assert.equal(
      await readFile(join(root, '.agents/skills/project-workflow/SKILL.md'), 'utf8'),
      customSkill
    )
  })
  test('migration discovery preserves connection settings and stable relative paths', async ({
    assert,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'adula-migrations-'))
    await mkdir(join(root, 'app/modules/orders/migrations'), { recursive: true })
    const config = {
      connection: 'postgres',
      connections: {
        postgres: {
          client: 'pg' as const,
          connection: { database: 'sample' },
          migrations: { paths: ['database/migrations', 'project/migrations'] },
        },
      },
    }
    const configured = withAdulaDatabase(config, root)
    assert.deepEqual(
      configured.connections.postgres.connection,
      config.connections.postgres.connection
    )
    assert.deepEqual(configured.connections.postgres.migrations.paths, [
      'database/migrations',
      'project/migrations',
      'node_modules/adula/build/database/migrations',
      'app/modules/orders/migrations',
    ])
    assert.deepEqual(withAdulaDatabase(configured, root), configured)
    assert.lengthOf(config.connections.postgres.migrations.paths, 2)
    assert.throws(
      () => withAdulaDatabase({ connection: 'sqlite', connections: {} }, root),
      /PostgreSQL/
    )
  })
})

test.group('First administrator installation', (group) => {
  group.each.setup(setup)

  test('install creates the first administrator, reuses it, and refuses a second unknown address', async ({
    assert,
  }) => {
    // The helper schema seeds two users without roles: no administrator exists yet.
    assert.isFalse(await administratorExists(db))
    let creations = 0
    const create = (email: string) => async () => {
      creations++
      // The helper seeds ids 1 and 2 explicitly, so the sequence has not advanced.
      const user = await seedActor({ id: 10 + creations }, { email })
      return user.id
    }
    const first = await resolveInstallAdministrator(
      db,
      'Owner@Example.Test',
      create('owner@example.test')
    )
    assert.isTrue(first.created)
    await grantInstallAdministrator(db, first.id, '9.9.9')
    assert.isTrue(await administratorExists(db))
    const actor = await new ActorStore(db, registry).load(first.id)
    assert.isTrue(buildAbility(actor.rules, registry.all()).can('manage', 'all'))
    assert.equal(await new Settings(db).get('adula.version'), '9.9.9')

    // Re-running is idempotent and never creates the user again.
    const again = await resolveInstallAdministrator(
      db,
      'owner@example.test',
      create('owner@example.test')
    )
    assert.deepEqual(again, { id: first.id, created: false })
    await grantInstallAdministrator(db, again.id, '9.9.9')
    assert.lengthOf(await db('user_roles').where({ user_id: first.id }), 1)
    assert.equal(creations, 1)

    // Once an administrator exists, a mistyped address cannot mint another privileged user.
    await assert.rejects(
      () => resolveInstallAdministrator(db, 'typo@example.test', create('typo@example.test')),
      /already exists/
    )
    assert.equal(creations, 1)
    assert.lengthOf(await db('users').where({ email: 'typo@example.test' }), 0)
  })

  test('promoting a pre-registered account rotates its password and ends every way in', async ({
    assert,
  }) => {
    // Application-owned tables, reduced to the columns installation touches.
    await db.raw('ALTER TABLE users ADD COLUMN password varchar')
    await db.schema.createTable('sessions', (t) => t.string('id').primary())
    await db.schema.createTable('user_sessions', (t) => {
      t.string('id').primary()
      t.integer('user_id')
    })
    await db.schema.createTable('auth_access_tokens', (t) => {
      t.increments('id')
      t.integer('tokenable_id')
    })
    await db.schema.createTable('password_reset_tokens', (t) => {
      t.increments('id')
      t.integer('user_id')
      t.timestamp('used_at', { useTz: true })
    })
    if (!(await db.schema.hasTable('user_invitations')))
      await db.schema.createTable('user_invitations', (t) => {
        t.increments('id')
        t.string('email')
        t.timestamp('accepted_at', { useTz: true })
      })
    const plant = async (userId: number, email: string) => {
      await db('users').where({ id: userId }).update({ password: 'attacker-chosen' })
      await db('sessions').insert({ id: `s-${userId}` })
      await db('user_sessions').insert({ id: `s-${userId}`, user_id: userId })
      await db('auth_access_tokens').insert({ tokenable_id: userId })
      await db('password_reset_tokens').insert({ user_id: userId })
      const invitation: Record<string, unknown> = { email: email.toUpperCase() }
      for (const [column, value] of Object.entries({
        full_name: 'مدعو',
        token_hash: `hash-${userId}`,
        expires_at: new Date(Date.now() + 3600_000),
      }))
        if (await db.schema.hasColumn('user_invitations', column)) invitation[column] = value
      await db('user_invitations').insert(invitation)
    }
    const count = async (rows: Promise<unknown[]>) => {
      const found = await rows
      return found.length
    }
    const passwordOf = async (id: number) => {
      const row = await db('users').where({ id }).first('password')
      return row.password
    }
    const remaining = async (userId: number, email: string) => ({
      sessions: await count(db('user_sessions').where({ user_id: userId })),
      store: await count(db('sessions').where({ id: `s-${userId}` })),
      tokens: await count(db('auth_access_tokens').where({ tokenable_id: userId })),
      resets: await count(db('password_reset_tokens').where({ user_id: userId })),
      invitations: await count(
        db('user_invitations').whereRaw('lower(email) = lower(?)', [email]).whereNull('accepted_at')
      ),
    })
    const refuseCreate = async () => {
      throw new Error('must not create')
    }

    // --keep-password (no rotation hook): an account the operator created stays as it is.
    await plant(2, 'reader@example.test')
    const kept = await resolveInstallAdministrator(db, 'reader@example.test', refuseCreate)
    assert.deepEqual(kept, { id: 2, created: false })
    assert.equal(await passwordOf(2), 'attacker-chosen')
    assert.deepEqual(await remaining(2, 'reader@example.test'), {
      sessions: 1,
      store: 1,
      tokens: 1,
      resets: 1,
      invitations: 1,
    })

    // Default: the self-registered account is secured before it becomes the administrator.
    await plant(1, 'admin@example.test')
    const rotated = await resolveInstallAdministrator(db, 'ADMIN@example.test', refuseCreate, {
      rotatePassword: async (id) => {
        await db('users').where({ id }).update({ password: 'operator-only' })
      },
    })
    assert.deepEqual(rotated, {
      id: 1,
      created: false,
      rotated: { sessions: 1, tokens: 1, resetTokens: 1, invitations: 1 },
    })
    assert.equal(await passwordOf(1), 'operator-only')
    assert.deepEqual(await remaining(1, 'admin@example.test'), {
      sessions: 0,
      store: 0,
      tokens: 0,
      resets: 0,
      invitations: 0,
    })
    const [activity] = await db('activities').where({ action: 'install_rotate_credentials' })
    assert.equal(activity.record_id, 1)
    // The other account was not touched.
    const other = await remaining(2, 'reader@example.test')
    assert.equal(other.tokens, 1)

    // Once an administrator exists, later installs never rotate it again.
    await grantInstallAdministrator(db, 1, '9.9.9')
    let calls = 0
    const again = await resolveInstallAdministrator(db, 'admin@example.test', refuseCreate, {
      rotatePassword: async () => {
        calls++
      },
    })
    assert.deepEqual(again, { id: 1, created: false })
    assert.equal(calls, 0)
  })

  test('only an unconditional manage-all grant counts as an administrator', async ({ assert }) => {
    const [role] = await db('roles').insert({ name: 'limited' }).returning('id')
    await db('user_roles').insert({ user_id: 2, role_id: role.id })
    await db('role_rules').insert([
      { role_id: role.id, subject: 'all', action: 'manage', conditions: JSON.stringify({}) },
      { role_id: role.id, subject: 'orders', action: 'manage' },
      { role_id: role.id, subject: 'all', action: 'manage', inverted: true },
    ])
    assert.isFalse(await administratorExists(db))
    await db('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
    assert.isTrue(await administratorExists(db))
  })
})
