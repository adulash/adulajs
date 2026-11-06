import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { MailPreset, MailReadiness } from '#services/mail_setup'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { CopyButton } from '~/components/ui/copy-button'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Dialog, DialogClose } from '~/components/ui/dialog'
import { LongDialogContent } from '~/components/ui/long-dialog'

export type MailSetupProps = {
  mailReadiness: MailReadiness
  mailPresets: (MailPreset & { env: string })[]
}

const warnings: Record<MailReadiness['warnings'][number], string> = {
  development_default:
    'لم يُضبط SMTP_HOST، لذلك يرسل النظام إلى خادم التطوير المحلي 127.0.0.1:1025.',
  loopback_in_production: 'يشير SMTP_HOST إلى الخادم نفسه؛ تأكد من تشغيل خادم بريد محلي عليه.',
  port_security_mismatch: 'قيمة SMTP_SECURE لا تناسب المنفذ: استخدم true مع 465، وfalse مع 587.',
}

function Names({ names }: { names: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {names.map((name) => (
        <code key={name} dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {name}
        </code>
      ))}
    </span>
  )
}

/** Readiness by variable name: what is missing or invalid, and what deserves a second look. */
export function MailReadinessNotice({ readiness }: { readiness: MailReadiness }) {
  if (readiness.configured && readiness.warnings.length === 0) return null
  return (
    <Alert variant={readiness.configured ? 'default' : 'destructive'}>
      <TriangleAlert />
      <AlertTitle>
        {readiness.configured ? 'راجع إعداد البريد' : 'إعداد البريد غير مكتمل'}
      </AlertTitle>
      <AlertDescription className="space-y-1.5">
        {readiness.missing.length > 0 && (
          <p>
            متغيرات ناقصة: <Names names={readiness.missing} />
          </p>
        )}
        {readiness.invalid.length > 0 && (
          <p>
            قيم غير صالحة: <Names names={readiness.invalid} />
          </p>
        )}
        {readiness.warnings.map((warning) => (
          <p key={warning}>{warnings[warning]}</p>
        ))}
      </AlertDescription>
    </Alert>
  )
}

/**
 * Guided SMTP setup: pick a provider, copy the environment lines it needs, restart, then send
 * a test. Nothing is saved here; credentials stay in the system environment (ADR 020).
 */
export function MailSetupDialog({
  open,
  onOpenChange,
  mailReadiness,
  mailPresets,
}: MailSetupProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const initial = mailPresets[0]?.id ?? ''
  const [presetId, setPresetId] = useState(initial)
  const preset = mailPresets.find((item) => item.id === presetId) ?? mailPresets[0]
  return (
    <Dialog
      mode="edit"
      open={open}
      onOpenChange={(next) => {
        // The next opening starts again from the first provider.
        if (!next) setPresetId(initial)
        onOpenChange(next)
      }}
    >
      <LongDialogContent
        title="إعداد البريد"
        description="يرسل النظام البريد عبر خادم SMTP لدى مزودك. تبقى بيانات الدخول في بيئة النظام، ولا يحفظها النظام هنا."
        footer={
          <DialogClose asChild>
            <Button type="button" variant="outline">
              إغلاق
            </Button>
          </DialogClose>
        }
      >
        {/* Choosing another provider is the only edit; returning to the first one is clean. */}
        <form
          className="space-y-4 text-sm"
          data-dirty={String(presetId !== initial)}
          onSubmit={(event) => event.preventDefault()}
        >
          <MailReadinessNotice readiness={mailReadiness} />
          <ol className="list-[arabic-indic] space-y-4 ps-5" data-testid="mail-setup-steps">
            <li className="space-y-2 ps-1">
              <Label htmlFor="mail-preset">اختر مزود البريد:</Label>
              <Select value={presetId} onValueChange={setPresetId}>
                <SelectTrigger id="mail-preset" className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {mailPresets.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {preset && <p className="text-muted-foreground">{preset.note}</p>}
            </li>
            {preset && (
              <li className="space-y-2 ps-1">
                <p>انسخ هذه الأسطر إلى بيئة النظام، ثم أكمل كلمة المرور وبيانات المرسل:</p>
                <pre
                  dir="ltr"
                  data-testid="mail-env-lines"
                  className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs"
                >
                  {preset.env}
                </pre>
                <CopyButton value={preset.env} label="نسخ الأسطر" />
              </li>
            )}
            <li className="ps-1">أعد تشغيل الخادم والعامل.</li>
            <li className="ps-1">أغلق هذه النافذة واضغط «إرسال بريد تجريبي»، ثم أكّد استلامه.</li>
          </ol>
          <Alert>
            <TriangleAlert />
            <AlertDescription>
              لا تضع كلمة المرور في الإعدادات العامة أو في مستودع المشروع، واستخدم عنوان مرسل
              موثّقًا لدى مزودك.
            </AlertDescription>
          </Alert>
        </form>
      </LongDialogContent>
    </Dialog>
  )
}
