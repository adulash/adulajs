import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { parse } from 'node:querystring'
import testUtils from '@adonisjs/core/services/test_utils'
import type { AllyManagerDriverFactory } from '@adonisjs/ally/types'
import { GithubDriver } from '@adonisjs/ally/drivers/github'
import env from '#start/env'
import { MicrosoftDriver } from '../../app/auth/microsoft_driver.js'

/**
 * A local OAuth provider for tests: GitHub-shaped endpoints under /github and
 * Entra-shaped endpoints under /ms/<tenant>/oauth2/v2.0. Each authorization
 * code is scripted by the test; nothing is mocked inside the application.
 */
export type GithubScript = {
  user: Record<string, unknown>
  emails?: { email: string; verified: boolean; primary: boolean }[]
}
export type CodeScript = { github?: GithubScript; idToken?: string; tokenStatus?: number }

export class FakeOauthProvider {
  base = ''
  tokenRequests: { path: string; form: Record<string, string> }[] = []
  #scripts = new Map<string, CodeScript>()
  #server?: Server

  script(code: string, script: CodeScript) {
    this.#scripts.set(code, script)
  }

  async start() {
    this.#server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const json = (status: number, body: unknown) => {
          response.writeHead(status, { 'content-type': 'application/json' })
          response.end(JSON.stringify(body))
        }
        const bearer = String(request.headers.authorization ?? '').replace(/^(Bearer|token) /i, '')
        const byToken = this.#scripts.get(bearer.replace(/^at-/, ''))
        if (request.method === 'POST' && url.pathname.endsWith('/token')) {
          const form = parse(Buffer.concat(chunks).toString('utf8')) as Record<string, string>
          this.tokenRequests.push({ path: url.pathname, form })
          const script = this.#scripts.get(form.code)
          if (!script) return json(400, { error: 'invalid_grant' })
          if (script.tokenStatus) return json(script.tokenStatus, { error: 'invalid_client' })
          return json(200, {
            access_token: `at-${form.code}`,
            token_type: 'Bearer',
            expires_in: 3600,
            ...(script.idToken ? { id_token: script.idToken } : {}),
          })
        }
        if (url.pathname === '/github/user' && byToken?.github)
          return json(200, byToken.github.user)
        if (url.pathname === '/github/emails' && byToken?.github)
          return json(200, byToken.github.emails ?? [])
        return json(404, { error: 'not_found' })
      })
    })
    await new Promise<void>((resolve) => this.#server!.listen(0, '127.0.0.1', resolve))
    this.base = `http://127.0.0.1:${(this.#server!.address() as AddressInfo).port}`
  }

  async stop() {
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()))
  }
}

type EnvKey = Parameters<typeof env.set>[0]

/** Sets string variables for one test; returns the restore function. */
export function setEnv(values: Partial<Record<EnvKey, string | undefined>>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, env.get(key as EnvKey) as string | undefined])
  )
  const apply = (next: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(next)) {
      env.set(key as EnvKey, value as never)
      // Env.set mirrors into process.env as a string; an unset value must stay absent.
      if (value === undefined) delete process.env[key]
    }
  }
  apply(values)
  return () => apply(previous)
}

export const MICROSOFT_TEST_CLIENT = '6f1c1c1e-0000-4000-8000-00000000c11e'
export const MICROSOFT_TEST_TENANT = '11111111-2222-4333-8444-555555555555'

/**
 * Points the application's `github` and `microsoft` ally factories at the fake
 * provider and configures their credentials. `ctx.ally` is built per request
 * from one shared provider map (`AllyManager.config`), so replacing an entry
 * reaches the real routes and controller. Returns the restore function.
 */
export async function installFakeProviders(
  provider: FakeOauthProvider,
  { microsoftTenant = MICROSOFT_TEST_TENANT }: { microsoftTenant?: string } = {}
) {
  const ctx = await testUtils.createHttpContext()
  const config = ctx.ally.config as unknown as Record<string, AllyManagerDriverFactory>
  const previous = { github: config.github, microsoft: config.microsoft }
  const restoreEnv = setEnv({
    GITHUB_CLIENT_ID: 'gh-test-client',
    GITHUB_CLIENT_SECRET: 'gh-test-secret',
    MICROSOFT_CLIENT_ID: MICROSOFT_TEST_CLIENT,
    MICROSOFT_CLIENT_SECRET: 'ms-test-secret',
    MICROSOFT_TENANT_ID: microsoftTenant,
  })
  const callbackUrl = (name: string) => `${env.get('APP_URL')}/oauth/${name}/callback`
  config.github = (httpContext) =>
    new GithubDriver(httpContext, {
      clientId: env.get('GITHUB_CLIENT_ID') ?? '',
      clientSecret: env.get('GITHUB_CLIENT_SECRET') ?? '',
      callbackUrl: callbackUrl('github'),
      authorizeUrl: `${provider.base}/github/authorize`,
      accessTokenUrl: `${provider.base}/github/token`,
      userInfoUrl: `${provider.base}/github/user`,
      userEmailUrl: `${provider.base}/github/emails`,
    })
  config.microsoft = (httpContext) =>
    new MicrosoftDriver(httpContext, {
      clientId: env.get('MICROSOFT_CLIENT_ID') ?? '',
      clientSecret: env.get('MICROSOFT_CLIENT_SECRET') ?? '',
      tenantId: env.get('MICROSOFT_TENANT_ID') ?? 'organizations',
      callbackUrl: callbackUrl('microsoft'),
      authority: `${provider.base}/ms`,
    })
  return () => {
    config.github = previous.github
    config.microsoft = previous.microsoft
    restoreEnv()
  }
}

/** An unsigned JWT (the driver validates claims; see MicrosoftDriver.validateIdToken). */
export function unsignedJwt(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'RS256', typ: 'JWT', kid: 'test' })}.${part(claims)}.${Buffer.from('sig').toString('base64url')}`
}
