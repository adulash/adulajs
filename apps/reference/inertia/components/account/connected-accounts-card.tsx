import { useState } from 'react'
import { router } from '@inertiajs/react'
import axios from 'axios'
import { toast } from 'sonner'
import { Link2, Link2Off, PlugZap } from 'lucide-react'
import { useDateTimeFormatter } from '~/components/admin-nav'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { failure, json } from './request'

/** Profile prop `connections` (app/services/social_accounts.ts userConnections). */
export type ConnectionsProps = {
  available: { name: string; label: string }[]
  linked: { provider: string; label: string; linkedAt: string }[]
}
type Row = { name: string; label: string; linkedAt: string | null; available: boolean }

export function ConnectedAccountsCard({
  connections,
  csrfToken,
}: {
  connections: ConnectionsProps
  csrfToken: string
}) {
  const formatDateTime = useDateTimeFormatter()
  const [linking, setLinking] = useState<Row | null>(null)
  const [unlinking, setUnlinking] = useState<Row | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // A provider switched off later stays listed while linked, so it can still be removed.
  const rows: Row[] = [
    ...connections.available.map((provider) => ({
      ...provider,
      available: true,
      linkedAt:
        connections.linked.find((link) => link.provider === provider.name)?.linkedAt ?? null,
    })),
    ...connections.linked
      .filter((link) => !connections.available.some((provider) => provider.name === link.provider))
      .map((link) => ({
        name: link.provider,
        label: link.label,
        linkedAt: link.linkedAt,
        available: false,
      })),
  ]

  const unlink = async () => {
    if (!unlinking) return
    setError('')
    setBusy(true)
    try {
      await axios.delete(`/account/connections/${encodeURIComponent(unlinking.name)}`, json)
      toast.success(`فُكّ ارتباط حساب ${unlinking.label}.`)
      setUnlinking(null)
      router.reload({ only: ['connections'] })
    } catch (caught) {
      setError(failure(caught, 'تعذر فكّ الارتباط.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugZap size={16} />
          الحسابات المرتبطة
        </CardTitle>
        <CardDescription>
          اربط حسابًا لدى مزوّد خارجي لتدخل به بدل كلمة المرور. يبقى التحقق بخطوتين مطلوبًا إن كان
          مفعّلًا.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            لا مزوّدات دخول خارجية مفعّلة في هذا النظام.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rows.map((row) => (
              <li
                key={row.name}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="space-y-1">
                  <p className="flex items-center gap-2 font-medium">
                    <span dir="ltr">{row.label}</span>
                    {row.linkedAt ? (
                      <Badge>مرتبط</Badge>
                    ) : (
                      <Badge variant="secondary">غير مرتبط</Badge>
                    )}
                  </p>
                  {row.linkedAt && (
                    <p className="text-xs text-muted-foreground">
                      رُبط في <span className="tabular-nums">{formatDateTime(row.linkedAt)}</span>
                      {!row.available && ' · الدخول عبره موقوف حاليًا'}
                    </p>
                  )}
                </div>
                {row.linkedAt ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setError('')
                      setUnlinking(row)
                    }}
                  >
                    <Link2Off size={14} />
                    فكّ الارتباط
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setLinking(row)}>
                    <Link2 size={14} />
                    ربط
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog
        mode="edit"
        open={linking !== null}
        onOpenChange={(open) => !open && setLinking(null)}
      >
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ربط حساب {linking?.label}</DialogTitle>
            <DialogDescription>
              ستنتقل إلى صفحة {linking?.label} للموافقة، ثم تعود إلى ملفك الشخصي.
            </DialogDescription>
          </DialogHeader>
          {/* A full navigation: the provider redirect must leave the Inertia app. */}
          <form
            id="connection-link"
            method="post"
            action={
              linking ? `/account/connections/${encodeURIComponent(linking.name)}` : undefined
            }
            className="space-y-2"
          >
            <input type="hidden" name="_csrf" value={csrfToken} />
            <Label htmlFor="connection-password">كلمة المرور الحالية (اختيارية)</Label>
            <Input
              id="connection-password"
              name="password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              مطلوبة إن مضى على دخولك أكثر من 10 دقائق. إن دخلت عبر مزوّد خارجي ولا تعرف كلمة
              المرور، سجّل الخروج وادخل مجددًا ثم اربط الحساب.
            </p>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinking(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="connection-link">
              <Link2 size={14} />
              متابعة إلى {linking?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        mode="confirm"
        open={unlinking !== null}
        onOpenChange={(open) => !open && setUnlinking(null)}
      >
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>فكّ ارتباط {unlinking?.label}؟</DialogTitle>
            <DialogDescription>
              لن تتمكن من الدخول عبر {unlinking?.label} بعد الآن. تأكد أنك تعرف كلمة مرور حسابك أو
              لديك مزوّد آخر مرتبط.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUnlinking(null)}>
              تراجع
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={unlink}>
              فكّ الارتباط
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
