import { useState } from 'react'
import { router } from '@inertiajs/react'
import { ImageUp, Trash2 } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { UserAvatar } from '~/components/ui/user-avatar'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { AvatarDialog } from '~/components/account/avatar-dialog'

/**
 * The profile picture of the account page or, with an administration `action`, of the user page.
 * While impersonating, the picture is shown but cannot change (it outlives the session).
 */
export function AvatarCard({
  user,
  action,
  own,
  locked = false,
}: {
  user: { id: number; name: string | null; avatarUrl?: string | null }
  action: string
  own: boolean
  locked?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { confirm, confirmation } = useConfirmAction()
  const has = user.avatarUrl !== null
  return (
    <Card>
      <CardHeader>
        <CardTitle>الصورة الشخصية</CardTitle>
        <CardDescription>
          {own
            ? 'تظهر بجانب اسمك في قائمة الحساب والتعليقات والمهام وسجل النشاط.'
            : 'تظهر بجانب اسم المستخدم في التعليقات والمهام وسجل النشاط.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <UserAvatar user={user} size="lg" labelled />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={locked} onClick={() => setOpen(true)}>
            <ImageUp size={16} />
            {has ? 'تغيير الصورة' : 'اختيار صورة'}
          </Button>
          {has && (
            <Button
              type="button"
              variant="ghost"
              disabled={locked}
              onClick={() =>
                confirm({
                  title: 'إزالة الصورة الشخصية',
                  description: 'ستظهر الأحرف الأولى من الاسم بدلًا منها.',
                  destructive: true,
                  label: 'إزالة الصورة',
                  action: () => router.delete(action, { preserveScroll: true }),
                })
              }
            >
              <Trash2 size={16} />
              إزالة الصورة
            </Button>
          )}
        </div>
        {locked && (
          <p className="w-full text-xs text-muted-foreground">
            لا يمكن تغيير الصورة الشخصية أثناء انتحال الهوية.
          </p>
        )}
      </CardContent>
      <AvatarDialog
        open={open}
        onOpenChange={setOpen}
        action={action}
        title={own ? 'الصورة الشخصية' : `الصورة الشخصية لـ ${user.name ?? 'المستخدم'}`}
      />
      {confirmation}
    </Card>
  )
}
