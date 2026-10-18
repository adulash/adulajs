import type { FormEvent } from 'react'
import { useForm } from '@inertiajs/react'
import { Languages } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { useLanguages, useMessages } from '~/components/ui/messages'

/**
 * The user's interface language. Arabic is the base language; the card appears only when
 * the administrator enabled at least one other language.
 */
export function LanguageSetting() {
  const { t, locale, dir } = useMessages()
  const languages = useLanguages()
  const form = useForm({ language: locale })
  if (languages.length < 2) return null
  const submit = (event: FormEvent) => {
    event.preventDefault()
    // Inertia sends the XSRF token cookie with the visit, like the other account forms.
    form.put('/account/language', { preserveScroll: true })
  }
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages size={16} />
          {t('لغة الواجهة')}
        </CardTitle>
        <CardDescription>
          {t('العربية هي لغة النظام الأساسية. اختر لغة أخرى لواجهتك إن أتاحها المسؤول.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <RadioGroup
            dir={dir}
            value={form.data.language}
            onValueChange={(language) => form.setData('language', language)}
            aria-label={t('لغة الواجهة')}
            aria-invalid={form.errors.language ? true : undefined}
            aria-describedby={form.errors.language ? 'language-error' : undefined}
          >
            {languages.map((language) => (
              <div key={language.code} className="flex items-center gap-3">
                <RadioGroupItem value={language.code} id={`language-${language.code}`} />
                <Label htmlFor={`language-${language.code}`} lang={language.code} dir={language.dir}>
                  {language.name}
                </Label>
              </div>
            ))}
          </RadioGroup>
          {form.errors.language && (
            <p id="language-error" className="text-sm text-destructive" role="alert">
              {form.errors.language}
            </p>
          )}
          <Button type="submit" disabled={form.processing || form.data.language === locale}>
            {t('حفظ اللغة')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
