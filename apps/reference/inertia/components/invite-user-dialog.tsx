import { useForm } from '@inertiajs/react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Dialog, DialogClose } from '~/components/ui/dialog'
import { LongDialogContent } from '~/components/ui/long-dialog'

/**
 * The invitation form as a long dialog. It posts to `/users/invite`, which returns to the page
 * it came from, so the dialog stays open over the users list with its errors; the workspace
 * shows the result as a flash message.
 * Closing asks first only while a field differs from the empty form it opened with.
 */
export function InviteUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const form = useForm({ fullName: '', email: '', form: '' })
  return (
    <Dialog
      mode="edit"
      open={open}
      value={{ fullName: form.data.fullName, email: form.data.email }}
      onOpenChange={(next) => {
        if (next || form.processing) return
        form.reset()
        form.clearErrors()
        onClose()
      }}
    >
      <LongDialogContent
        title="دعوة مستخدم"
        description="يختار المدعو كلمة مروره عبر رابط صالح لمدة 24 ساعة. يعيّن المدير الأدوار بعد قبول الدعوة."
        width="lg"
        footer={
          <>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={form.processing}>
                إلغاء
              </Button>
            </DialogClose>
            <Button type="submit" form="invite-user" disabled={form.processing}>
              {form.processing ? 'جارٍ الإرسال…' : 'إرسال الدعوة'}
            </Button>
          </>
        }
      >
        <form
          id="invite-user"
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            form.post('/users/invite', {
              preserveScroll: true,
              preserveState: true,
              onSuccess: () => form.reset(),
            })
          }}
        >
          {form.errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {form.errors.form}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="invite-full-name">الاسم الكامل</Label>
            <Input
              id="invite-full-name"
              required
              maxLength={120}
              value={form.data.fullName}
              onChange={(event) => form.setData('fullName', event.target.value)}
              aria-invalid={Boolean(form.errors.fullName)}
            />
            {form.errors.fullName && (
              <p role="alert" className="text-sm text-destructive">
                {form.errors.fullName}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-email">البريد الإلكتروني</Label>
            <Input
              id="invite-email"
              type="email"
              dir="ltr"
              required
              maxLength={254}
              value={form.data.email}
              onChange={(event) => form.setData('email', event.target.value)}
              aria-invalid={Boolean(form.errors.email)}
            />
            {form.errors.email && (
              <p role="alert" className="text-sm text-destructive">
                {form.errors.email}
              </p>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            لإعادة إرسال دعوة لم تُقبل، أدخل البريد نفسه بعد دقيقة. يصبح الرابط السابق غير صالح.
          </p>
        </form>
      </LongDialogContent>
    </Dialog>
  )
}
