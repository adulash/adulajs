import env from '#start/env'
import { defineConfig } from '@adonisjs/ally'
import { GithubDriver } from '@adonisjs/ally/drivers/github'
import { GoogleDriver } from '@adonisjs/ally/drivers/google'
import { MicrosoftDriver } from '../app/auth/microsoft_driver.js'

const callbackUrl = (provider: string) => `${env.get('APP_URL')}/oauth/${provider}/callback`

/**
 * Providers are always declared so their types exist; a provider is offered
 * only when its credentials are configured and an administrator has not
 * disabled it (app/services/social_accounts.ts). Each factory reads its
 * credentials per request, so a changed environment needs no new config.
 */
const allyConfig = defineConfig({
  github: (ctx) =>
    new GithubDriver(ctx, {
      clientId: env.get('GITHUB_CLIENT_ID') ?? '',
      clientSecret: env.get('GITHUB_CLIENT_SECRET') ?? '',
      callbackUrl: callbackUrl('github'),
    }),
  google: (ctx) =>
    new GoogleDriver(ctx, {
      clientId: env.get('GOOGLE_CLIENT_ID') ?? '',
      clientSecret: env.get('GOOGLE_CLIENT_SECRET') ?? '',
      callbackUrl: callbackUrl('google'),
    }),
  microsoft: (ctx) =>
    new MicrosoftDriver(ctx, {
      clientId: env.get('MICROSOFT_CLIENT_ID') ?? '',
      clientSecret: env.get('MICROSOFT_CLIENT_SECRET') ?? '',
      tenantId: env.get('MICROSOFT_TENANT_ID') ?? 'organizations',
      callbackUrl: callbackUrl('microsoft'),
    }),
})

export default allyConfig

declare module '@adonisjs/ally/types' {
  interface SocialProviders extends InferSocialProviders<typeof allyConfig> {}
}
