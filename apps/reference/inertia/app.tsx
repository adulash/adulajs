import { type ReactElement } from 'react'
import { client } from './client'
import Layout from '~/layouts/default'
import { type Data } from '@generated/data'
import { createRoot } from 'react-dom/client'
import { createInertiaApp, router, type ResolvedComponent } from '@inertiajs/react'
import { TuyauProvider } from '@adonisjs/inertia/react'
import { resolvePageComponent } from '@adonisjs/inertia/helpers'
import fixturePages from '~/fixture_pages'
import { TooltipProvider } from '~/components/ui/tooltip'
import { applyTheme, isTheme } from '~/components/theme'
import { preferenceOverride } from '~/components/preferences'
import { applyAppearance, appearanceCompany, type SharedAppearance } from '~/components/appearance'
import './css/adula.css'

const appName = import.meta.env.VITE_APP_NAME || 'أدولا'

/**
 * The server renders `lang` and `dir` into the HTML; client navigations can switch the
 * interface language (for example after saving it), so keep them in sync with the page.
 */
function syncDocument(props: {
  [key: string]: unknown
  locale?: unknown
  dir?: unknown
  preferences?: unknown
  appearance?: unknown
}) {
  const root = document.documentElement
  root.lang = typeof props.locale === 'string' ? props.locale : 'ar'
  root.dir = props.dir === 'ltr' ? 'ltr' : 'rtl'
  // The theme a user picked in this page view wins until the server renders it (ADR 049).
  const picked = preferenceOverride('shell.theme')
  const stored = (props.preferences as Record<string, unknown> | undefined)?.['shell.theme']
  const theme = isTheme(picked) ? picked : stored
  if (isTheme(theme)) applyTheme(theme)
  // The saved primary colour and the active occasion's (ADR 053).
  applyAppearance(props.appearance as SharedAppearance | undefined)
}

createInertiaApp({
  // The company name from «المظهر والهوية» (ADR 053), once a page has shared it.
  title: (title) => {
    const name = appearanceCompany() ?? appName
    return title ? `${title} - ${name}` : name
  },
  resolve: (name) => {
    return resolvePageComponent<ResolvedComponent>(
      `./pages/${name}.tsx`,
      { ...import.meta.glob<ResolvedComponent>('./pages/**/*.tsx'), ...fixturePages },
      (page: ReactElement<Data.SharedProps>) => <Layout children={page} />
    )
  },
  setup({ el, App, props }) {
    syncDocument(props.initialPage.props)
    router.on('navigate', (event) => syncDocument(event.detail.page.props))
    // Partial reloads (after saving the appearance) do not navigate; apply what they return.
    router.on('success', (event) =>
      applyAppearance(event.detail.page.props.appearance as SharedAppearance | undefined)
    )
    createRoot(el).render(
      <TuyauProvider client={client}>
        {/* One provider for every tooltip, such as the collapsed sidebar's icon labels. */}
        <TooltipProvider delayDuration={300}>
          <App {...props} />
        </TooltipProvider>
      </TuyauProvider>
    )
  },
  progress: {
    // A theme token, so the progress bar follows the light and dark themes.
    color: 'var(--muted-foreground)',
  },
})
