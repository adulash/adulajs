import { type ReactElement } from 'react'
import { client } from './client'
import Layout from '~/layouts/default'
import { type Data } from '@generated/data'
import { createRoot } from 'react-dom/client'
import { createInertiaApp, router, type ResolvedComponent } from '@inertiajs/react'
import { TuyauProvider } from '@adonisjs/inertia/react'
import { resolvePageComponent } from '@adonisjs/inertia/helpers'
import fixturePages from '~/fixture_pages'
import './css/adula.css'

const appName = import.meta.env.VITE_APP_NAME || 'AdulaJS'

/**
 * The server renders `lang` and `dir` into the HTML; client navigations can switch the
 * interface language (for example after saving it), so keep them in sync with the page.
 */
function syncDocumentLanguage(props: { [key: string]: unknown; locale?: unknown; dir?: unknown }) {
  const root = document.documentElement
  root.lang = typeof props.locale === 'string' ? props.locale : 'ar'
  root.dir = props.dir === 'ltr' ? 'ltr' : 'rtl'
}

createInertiaApp({
  title: (title) => (title ? `${title} - ${appName}` : appName),
  resolve: (name) => {
    return resolvePageComponent<ResolvedComponent>(
      `./pages/${name}.tsx`,
      { ...import.meta.glob<ResolvedComponent>('./pages/**/*.tsx'), ...fixturePages },
      (page: ReactElement<Data.SharedProps>) => <Layout children={page} />
    )
  },
  setup({ el, App, props }) {
    syncDocumentLanguage(props.initialPage.props)
    router.on('navigate', (event) => syncDocumentLanguage(event.detail.page.props))
    createRoot(el).render(
      <TuyauProvider client={client}>
        <App {...props} />
      </TuyauProvider>
    )
  },
  progress: {
    color: '#4B5563',
  },
})
