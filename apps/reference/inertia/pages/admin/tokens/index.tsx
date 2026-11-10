import { useState, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import axios from 'axios'
import { Copy, KeySquare, Plus, Trash2 } from 'lucide-react'
import Workspace from '~/layouts/workspace'
import { AdminHeader, useDateTimeFormatter } from '~/components/admin-nav'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
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

type Token = {
  id: number
  name: string | null
  access: 'read' | 'write'
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}
type Props = { tokens: Token[] }
const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }

export default function ApiTokens({ tokens }: Props) {
  const formatDateTime = useDateTimeFormatter()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [access, setAccess] = useState<'read' | 'write'>('read')
  const [days, setDays] = useState('90')
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState('')
  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      const response = await axios.post(
        '/admin/tokens',
        { name, access, expiresInDays: Number(days) },
        json
      )
      setSecret(response.data.data.secret)
      setCreating(false)
      setName('')
      router.reload({ only: ['tokens'] })
    } catch (caught) {
      setError(
        axios.isAxiosError(caught) && caught.response?.data?.error?.message
          ? String(caught.response.data.error.message)
          : 'تعذر إنشاء الرمز.'
      )
    }
  }
  return (
    <>
      <Head title="رموز API" />
      <AdminHeader
        title="رموز API"
        description={
          <>
            يعمل الرمز بصلاحياتك الحالية نفسها عبر <code dir="ltr">/api/v1</code>. وصف الواجهة
            متاح في <code dir="ltr">/api/v1/openapi.json</code>.
          </>
        }
      >
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} />
          إنشاء رمز
        </Button>
      </AdminHeader>
      <ul className="space-y-3">
        {tokens.map((token) => (
          <li
            key={token.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-4"
          >
            <div className="space-y-1">
              <p className="flex items-center gap-2 font-semibold">
                <KeySquare size={16} className="text-muted-foreground" />
                {token.name ?? `رمز #${token.id}`}
                <Badge variant={token.access === 'write' ? 'default' : 'secondary'}>
                  {token.access === 'write' ? 'قراءة وكتابة' : 'قراءة فقط'}
                </Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                آخر استخدام: {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : 'لم يُستخدم'} ·
                ينتهي: {token.expiresAt ? formatDateTime(token.expiresAt) : 'لا ينتهي'}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`إلغاء ${token.name ?? token.id}`}
              onClick={async () => {
                await axios.delete(`/admin/tokens/${token.id}`, json)
                router.reload({ only: ['tokens'] })
              }}
            >
              <Trash2 size={14} />
              إلغاء الرمز
            </Button>
          </li>
        ))}
        {tokens.length === 0 && (
          <li className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
            لا رموز بعد.
          </li>
        )}
      </ul>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إنشاء رمز API</DialogTitle>
            <DialogDescription>اختر أقل صلاحية تكفي التكامل.</DialogDescription>
          </DialogHeader>
          <form id="token-form" className="space-y-4" onSubmit={create}>
            <div className="space-y-2">
              <Label htmlFor="token-name">اسم الرمز</Label>
              <Input
                id="token-name"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <RadioGroup
              value={access}
              onValueChange={(value) => setAccess(value as 'read' | 'write')}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id="token-read" value="read" />
                <Label htmlFor="token-read">قراءة فقط</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="token-write" value="write" />
                <Label htmlFor="token-write">قراءة وكتابة</Label>
              </div>
            </RadioGroup>
            <div className="space-y-2">
              <Label htmlFor="token-days">الصلاحية بالأيام</Label>
              <Input
                id="token-days"
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="token-form">
              إنشاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={secret !== null} onOpenChange={(value) => !value && setSecret(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>انسخ الرمز الآن</DialogTitle>
            <DialogDescription>لن يظهر الرمز مرة أخرى. أرسله في ترويسة Authorization.</DialogDescription>
          </DialogHeader>
          <code dir="ltr" className="block break-all rounded-lg bg-muted px-3 py-2 text-xs">
            Bearer {secret}
          </code>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => secret && navigator.clipboard?.writeText(secret)}
            >
              <Copy size={14} />
              نسخ
            </Button>
            <Button type="button" onClick={() => setSecret(null)}>
              تم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
ApiTokens.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
