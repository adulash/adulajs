import { useState } from 'react'
import axios from 'axios'
import { Printer } from 'lucide-react'
import type { PrintTemplateOption } from 'adula'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { useMessages } from '~/components/ui/messages'

type Options = { templates: PrintTemplateOption[]; pdf: boolean }

/**
 * «طباعة» on the record page (ADR 048): a Dialog to pick the generic layout, a code
 * template or an administrator template, and HTML or PDF when PDF is configured. The
 * print page authorizes the record and every field again on the server.
 */
export function RecordPrint({ resource, id }: { resource: string; id: number | string }) {
  const { t, label } = useMessages()
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<Options | null>(null)
  const [failed, setFailed] = useState(false)
  const [template, setTemplate] = useState('default')
  const [format, setFormat] = useState<'html' | 'pdf'>('html')
  const load = () => {
    setFailed(false)
    axios
      .get<{ data: Options }>(`/resources/${resource}/print-templates`, {
        headers: { Accept: 'application/json' },
      })
      .then((response) => setOptions(response.data.data))
      .catch(() => setFailed(true))
  }
  const query = new URLSearchParams()
  if (template !== 'default') query.set('template', template)
  if (format === 'pdf') query.set('format', 'pdf')
  const href = `/resources/${resource}/${id}/print${query.size ? `?${query}` : ''}`
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true)
          if (!options) load()
        }}
      >
        <Printer size={15} />
        {t('طباعة')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('طباعة السجل')}</DialogTitle>
            <DialogDescription>{t('اختر قالب الطباعة وصيغة المستند.')}</DialogDescription>
          </DialogHeader>
          {failed ? (
            <div className="space-y-3 text-sm">
              <p className="text-destructive">{t('تعذر تحميل قوالب الطباعة.')}</p>
              <Button variant="outline" size="sm" onClick={load}>
                {t('إعادة المحاولة')}
              </Button>
            </div>
          ) : !options ? (
            <p className="text-sm text-muted-foreground">{t('جارٍ تحميل القوالب…')}</p>
          ) : (
            <div className="space-y-5">
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-medium">{t('قالب الطباعة')}</legend>
                <RadioGroup value={template} onValueChange={setTemplate} className="gap-3">
                  {options.templates.map((option) => (
                    <div key={option.key} className="flex items-center gap-2">
                      <RadioGroupItem id={`print-template-${option.key}`} value={option.key} />
                      <Label htmlFor={`print-template-${option.key}`}>{label(option.label)}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-medium">{t('صيغة المستند')}</legend>
                <RadioGroup
                  value={format}
                  onValueChange={(value) => setFormat(value as 'html' | 'pdf')}
                  className="flex flex-wrap gap-6"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="print-format-html" value="html" />
                    <Label htmlFor="print-format-html">{t('صفحة للطباعة')}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="print-format-pdf" value="pdf" disabled={!options.pdf} />
                    <Label htmlFor="print-format-pdf">PDF</Label>
                  </div>
                </RadioGroup>
                {!options.pdf && (
                  <p className="text-xs text-muted-foreground">
                    {t('تحويل PDF غير مفعّل؛ استخدم الطباعة من المتصفح.')}
                  </p>
                )}
              </fieldset>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('إلغاء')}
            </Button>
            {options ? (
              <Button asChild>
                <a href={href} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
                  <Printer size={15} />
                  {t('فتح للطباعة')}
                </a>
              </Button>
            ) : (
              // A link cannot be disabled; until the templates load the action is a button.
              <Button type="button" disabled>
                <Printer size={15} />
                {t('فتح للطباعة')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
