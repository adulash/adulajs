# Languages

Arabic is the base language of every AdulaJS system. Every screen, message and label
exists in Arabic; other languages are an optional layer that a system enables and each
user chooses for their own interface. English is never required.

## What a system administrator does

Languages are off by default: only Arabic is offered. To let users choose English,
enable it in `config/adula.ts`:

```ts
const adulaConfig: { languages: string[]; timeZone: string } = {
  languages: ['ar', 'en'],
  timeZone: 'Asia/Riyadh',
}
```

`timeZone` is not a language setting: it is the system's IANA time zone, in which
workflow due dates and delegation days are counted (ADR 044). Set it to the company's zone.

Arabic is always available and always first. When more than one language is enabled,
the profile page shows an «لغة الواجهة» card where each user picks a language (stored in
`users.language`, default `ar`). If a language is later removed from the list, users who
chose it see Arabic again; their stored choice is kept.

## What follows the user's language

With English chosen, a signed-in user gets:

* `<html lang="en" dir="ltr">` and the Inertia props `locale`, `dir`, `languages` and
  `messages`. Arabic stays right-to-left; a language declares its own direction.
* The framework's own strings that the bundled English catalog translates: VineJS
  validation messages, `AdulaError` messages, the error bodies of the exception handler,
  flash notices, the workspace shell and the generic resource list, form and record
  screens.
* Resource, module and field labels from `label.en` where the resource defines it.

Guests (login, password recovery, signup), requests authenticated by an API token,
errors raised before the language is chosen (an expired CSRF token, an unknown route)
see Arabic.

## Labels: `label.<lang>` falls back to `label.ar`

`label.ar` is required on resources, fields, record and create labels, module lookups and
modules. Every other language is optional:

```ts
defineResource({
  name: 'receipts',
  label: { ar: 'الإيصالات' }, // shown in every language
  fields: {
    reference: { type: 'string', label: { ar: 'رقم الإيصال', en: 'Reference' } },
  },
  // …
})
```

A label that names a language must give it text: `en: ''` is refused as a mistake. Where
`label.<lang>` is missing, the Arabic label is shown. The OpenAPI document is English
and falls back to the Arabic label the same way. Module lookups store their Arabic text
in `label_en` when they have no English label.

## The message catalog

The core catalog (`adula`: `arabicMessages`) maps stable keys to the exact Arabic text
the framework produces, in sections:

| Prefix          | Content                                              |
| --------------- | ---------------------------------------------------- |
| `validation.*`  | VineJS rules (`validation.required`, `validation.min`) |
| `errors.*`      | `AdulaError` and HTTP error bodies, by error code    |
| `flash.*`       | notices after a redirect                             |
| `ui.*`          | interface strings of the reference app and `@adula/ui` |

`translate(key, language, params)` returns the text in `language` and falls back to
Arabic for a key the language does not translate; `{name}` placeholders are replaced
from `params`. `localizeText(text, language)` translates Arabic text that matches a
catalog entry exactly, so code that still writes Arabic literals is localized at the
boundary while Arabic output stays byte-identical.

The language middleware runs each request inside `runWithLanguage(language, …)`; an
`AdulaError` created during the request, and VineJS messages
(`installCatalogMessages(vine, registry.all())` in `start/validator.ts`), use
`currentLanguage()`. Interface components keep their Arabic text and look it up in the
`messages` prop (Arabic text → translation, empty for Arabic) through `useMessages()`
from the `@adula/ui` registry.

## Adding a language

1. Write a catalog with the keys you translate; untranslated keys show Arabic.

   ```ts
   // start/languages.ts
   import { registerLanguage } from 'adula'
   import { frenchMessages } from '../languages/fr.js'

   registerLanguage('fr', frenchMessages, { name: 'Français', dir: 'ltr' })
   ```

   `registerLanguage` refuses keys the Arabic catalog does not define and empty texts.
   Registering a code again merges the catalogs, so you can override entries of the
   bundled English catalog.
2. Add the code to `languages` in `config/adula.ts`.
3. Add `label.fr` to the resources, fields and lookups you want translated.

## What stays Arabic

* Consumer data: records, lookup option labels in forms and tables, organization units,
  role names and message templates.
* E-mail subjects and bodies, stored notifications and import row errors.
* Screens not yet moved to the catalog: the administration pages, record assignments,
  workflows and collaboration, CSV import and the Hijri calendar. Some shared controls
  (select, dropdown menu, tabs, toasts, calendars) still lay out right to left in a
  left-to-right language.
* Messages built with interpolated values that are not yet catalog templates (for example
  the login lockout with its minutes); they render their Arabic text until they do.
