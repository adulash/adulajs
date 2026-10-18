/*
|--------------------------------------------------------------------------
| Interface languages
|--------------------------------------------------------------------------
|
| Registers the optional language catalogs this system can offer. Registering a
| catalog does not enable it: config/adula.ts lists the languages users may
| choose. Register your own catalog the same way, for example
| registerLanguage('fr', frenchMessages, { name: 'Français' }).
|
*/

import { enabledLanguages, englishMessages, registerLanguage } from 'adula'
import { configuredLanguages } from '#services/languages'

registerLanguage('en', englishMessages, { name: 'English', dir: 'ltr' })

// Fail at boot, not on every page, when config/adula.ts names an unregistered language.
enabledLanguages(configuredLanguages())
