import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import adonisjs from '@adonisjs/vite/client'
import tailwindcss from '@tailwindcss/vite'

/**
 * Development server only. A page links its stylesheet (`<link href="/inertia/css/adula.css">`,
 * added by @adonisjs/vite against a flash of unstyled content) and app.tsx imports the same
 * address as a module. Vite answers that one URL with CSS or with JavaScript by the request's
 * Accept header, without `Vary: Accept`, so the browser's HTTP cache keeps a single response for
 * both. Back and Forward reuse cached responses without asking the server, and when the
 * stylesheet's response was stored last the module import got CSS: the entry failed with a
 * strict MIME type error and the page stayed empty at the right address. `Vary: Accept` keeps
 * the two answers apart.
 */
function varyStylesByAccept(): Plugin {
  return {
    name: 'adula:vary-styles-by-accept',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (/\.css(?:$|\?)/.test(request.url ?? '')) response.setHeader('Vary', 'Accept')
        next()
      })
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [
    varyStylesByAccept(),
    react(),
    adonisjs({ entryPoints: ['inertia/app.tsx'], reload: ['resources/views/**/*.edge'] }),
    tailwindcss(),
  ],

  /**
   * Define aliases for importing modules from
   * your frontend code
   */
  resolve: {
    alias: {
      '~/fixture_pages': `${import.meta.dirname}/${command === 'serve' && process.env.NODE_ENV === 'test' ? 'tests/fixtures/frontend/entry.ts' : 'inertia/fixture_pages.ts'}`,
      '~/': `${import.meta.dirname}/inertia/`,
      '@generated': `${import.meta.dirname}/.adonisjs/client/`,
    },
  },

  server: {
    watch: {
      ignored: ['**/storage/**', '**/tmp/**'],
    },
  },
}))
