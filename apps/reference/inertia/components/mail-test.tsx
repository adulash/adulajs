import { useEffect, useState } from 'react'
import { router } from '@inertiajs/react'
import type { MailTestState } from 'adula'
import { MailReadinessNotice, MailSetupDialog, type MailSetupProps } from '~/components/mail-setup'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '~/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '~/components/ui/dialog'

export type MailTestProps = MailSetupProps & {
  mailTest: Omit<MailTestState, 'fingerprint'> | null
  mailRecipient: string
}
const labels = {
  sending: 'جارٍ الإرسال',
  pending: 'بانتظار تأكيد الاستلام',
  confirmed: 'أكد المدير وصول الرسالة',
  not_received: 'أفاد المدير بعدم وصول الرسالة',
  failed: 'تعذّر الإرسال',
}
export function MailTest({
  mailTest,
  mailRecipient,
  mailReadiness,
  mailPresets,
  mailSettings,
  mailSettingsApply,
  returnTo = 'settings',
}: MailTestProps & { returnTo?: 'settings' | 'setup' }) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [setup, setSetup] = useState(false)
  const pending =
    mailTest?.status === 'pending' && Date.now() - Date.parse(mailTest.requestedAt) < 86_400_000
  useEffect(() => {
    setOpen(pending)
  }, [mailTest?.id, pending])
  const post = (path: string, data: Record<string, string | boolean> = {}) => {
    setBusy(true)
    router.post(
      path,
      { ...data, returnTo },
      { preserveScroll: true, onFinish: () => setBusy(false) }
    )
  }
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>اختبار البريد الإلكتروني</CardTitle>
        <CardDescription>
          قبول الإرسال لا يثبت الوصول. نحتاج تأكيدك بعد مراجعة صندوق بريدك والبريد غير المرغوب.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MailReadinessNotice readiness={mailReadiness} />
        <p>
          المستلم: <span dir="ltr">{mailRecipient}</span>
        </p>
        <p role="status">
          {mailTest?.status === 'pending' && !pending
            ? 'انتهت مهلة التأكيد؛ أرسل تجربة جديدة'
            : mailTest
              ? labels[mailTest.status]
              : 'لم يُختبر البريد بهذه الإعدادات'}
        </p>
        {mailTest && (
          <p className="text-xs text-muted-foreground">
            وقت التجربة: <time dir="ltr">{mailTest.requestedAt}</time> · المرجع:{' '}
            <span dir="ltr">{mailTest.id}</span>
          </p>
        )}
        {mailTest?.status === 'not_received' && (
          <p className="text-sm">
            راجع عنوان المرسل وإعدادات SMTP والبريد غير المرغوب، ثم أرسل تجربة جديدة.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy || !mailReadiness.configured}
            onClick={() => post('/admin/settings/mail/test')}
          >
            {busy ? 'جارٍ التنفيذ…' : 'إرسال بريد تجريبي'}
          </Button>
          <Button variant="outline" onClick={() => setSetup(true)}>
            إعداد البريد
          </Button>
          {pending && (
            <Button variant="outline" disabled={busy} onClick={() => setOpen(true)}>
              تأكيد استلام البريد
            </Button>
          )}
        </div>
        {pending && (
          <p className="text-sm">
            هل وصلت الرسالة؟ افتح تأكيد الاستلام لتسجيل النتيجة. ينتهي التأكيد بعد 24 ساعة.
          </p>
        )}
      </CardContent>
      <MailSetupDialog
        open={setup}
        onOpenChange={setSetup}
        mailReadiness={mailReadiness}
        mailPresets={mailPresets}
        mailSettings={mailSettings}
        mailSettingsApply={mailSettingsApply}
      />
      <Dialog mode="confirm" open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>هل وصل البريد التجريبي؟</DialogTitle>
            <DialogDescription>
              تحقق من رسالة «تجربة البريد — تأكيد الاستلام» المرسلة إلى {mailRecipient}، وأن مرجعها{' '}
              {mailTest?.id}. تأكيدك يخص هذه التجربة فقط.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() =>
                post('/admin/settings/mail/confirm', { id: mailTest!.id, received: true })
              }
            >
              وصلت الرسالة
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                post('/admin/settings/mail/confirm', { id: mailTest!.id, received: false })
              }
            >
              لم تصل الرسالة
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              سأتحقق لاحقًا
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
