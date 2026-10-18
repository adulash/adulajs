/*
|--------------------------------------------------------------------------
| Validator file
|--------------------------------------------------------------------------
|
| The validator file is used for configuring global transforms for VineJS.
| The transform below converts all VineJS date outputs from JavaScript
| Date objects to Luxon DateTime instances, so that validated dates are
| ready to use with Lucid models and other parts of the app that expect
| Luxon DateTime.
|
*/

import { DateTime } from 'luxon'
import vine, { VineDate } from '@vinejs/vine'
import { installCatalogMessages } from 'adula'
import { registry } from '#start/modules'

declare module '@vinejs/vine/types' {
  interface VineGlobalTransforms {
    date: DateTime
  }
}

VineDate.transform((value) => DateTime.fromJSDate(value))

/**
 * Validation messages follow the request's language (see LanguageMiddleware):
 * Arabic by default, the user's enabled language otherwise. Validators created
 * later use it; resource validators created while the configuration loaded are
 * switched to it unless they declare their own messages provider.
 */
installCatalogMessages(vine, registry.all())
