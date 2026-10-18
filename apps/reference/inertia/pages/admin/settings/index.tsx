import { useState, type FormEvent, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import type { SettingRow, SettingScope } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { UiSettings } from '~/components/ui-settings'
import { MailTest, type MailTestProps } from '~/components/mail-test'
import {
  AuthenticationSettings,
  type AuthenticationSettingsProps,
} from '~/components/authentication-settings'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Badge } from '~/components/ui/badge'
import { Textarea } from '~/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

type Props = {
  settings: SettingRow[]
  scope: SettingScope
  scopeId: string
  authentication: AuthenticationSettingsProps
} & MailTestProps
type Draft = { id: number | null; key: string; value: string }
const SCOPES: [SettingScope, string][] = [
  ['system', 'النظام'],
  ['org_unit', 'وحدة تنظيمية'],
  ['user', 'مستخدم'],
]

function jsonError(text: string) {
  try {
    JSON.parse(text)
    return ''
  } catch {
    return 'القيمة ليست JSON صالحاً'
  }
}

export default function SettingsIndex({
  settings,
  scope,
  scopeId,
  mailTest,
  mailRecipient,
  authentication,
}: Props) {
  const preferences = useUiPreferences()
  const { confirm, confirmation } = useConfirmAction()
  const [target, setTarget] = useState(scopeId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const options = { preserveScroll: true, preserveState: true }
  const visit = (nextScope: SettingScope, nextId: string) =>
    router.get('/admin/settings', { scope: nextScope, scopeId: nextId }, { preserveState: true })
  const error = draft ? jsonError(draft.value) : ''
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!draft || error) return
    router.put(
      '/admin/settings',
      { key: draft.key, scope, scopeId, value: draft.value },
      { ...options, onSuccess: () => setDraft(null) }
    )
  }
  return (
    <>
      <Head title="الإعدادات" />
      <AdminHeader
        title="الإعدادات"
        description="اضبط التواريخ وسلوك الواجهة، وراجع إعدادات النظام."
      >
        <Button
          disabled={scope !== 'system' && !/^\d+$/.test(scopeId)}
          onClick={() => setDraft({ id: null, key: '', value: '' })}
        >
          <Plus size={16} />
          إضافة إعداد
        </Button>
      </AdminHeader>
      <UiSettings key={JSON.stringify(preferences)} initial={preferences} />
      <AuthenticationSettings authentication={authentication} />
      <MailTest mailTest={mailTest} mailRecipient={mailRecipient} />
      <h2 className="mb-4 text-lg font-semibold">إعدادات متقدمة</h2>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Tabs value={scope} onValueChange={(value) => visit(value as SettingScope, '')}>
          <TabsList>
            {SCOPES.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {scope !== 'system' && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              visit(scope, target)
            }}
            className="flex items-end gap-2"
          >
            <div className="space-y-1">
              <Label htmlFor="scope-id">
                {scope === 'org_unit' ? 'معرّف الوحدة' : 'معرّف المستخدم'}
              </Label>
              <Input
                id="scope-id"
                type="number"
                min={1}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                className="w-40 bg-white"
              />
            </div>
            <Button type="submit" variant="outline">
              عرض
            </Button>
          </form>
        )}
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المفتاح</TableHead>
              <TableHead>القيمة</TableHead>
              <TableHead>الحماية</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {settings.map((row) => (
              <TableRow key={row.id}>
                <TableCell dir="ltr" className="font-medium">
                  {row.key}
                </TableCell>
                <TableCell>
                  <code className="line-clamp-2 max-w-md text-xs" dir="ltr">
                    {JSON.stringify(row.value)}
                  </code>
                </TableCell>
                <TableCell>
                  {row.readOnly ? (
                    <Badge variant="secondary">
                      <Lock size={11} />
                      للقراءة فقط
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">قابل للتحرير</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="inline-flex gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`تحرير ${row.key}`}
                      disabled={row.readOnly}
                      onClick={() =>
                        setDraft({
                          id: row.id,
                          key: row.key,
                          value: JSON.stringify(row.value, null, 2),
                        })
                      }
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`حذف ${row.key}`}
                      disabled={row.readOnly}
                      onClick={() =>
                        confirm({
                          title: 'حذف الإعداد؟',
                          description: `سيُحذف ${row.key} وتعود القيم الافتراضية إن وُجدت.`,
                          destructive: true,
                          action: () => router.delete(`/admin/settings/${row.id}`, options),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {settings.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  {scope !== 'system' && !/^\d+$/.test(scopeId)
                    ? 'أدخل معرّف النطاق لعرض إعداداته.'
                    : 'لا إعدادات في هذا النطاق.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <form onSubmit={save} className="space-y-5">
            <DialogHeader>
              <DialogTitle>{draft?.id ? `تحرير ${draft.key}` : 'إعداد جديد'}</DialogTitle>
              <DialogDescription>القيمة تُحفظ كما هي بصيغة JSON.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="setting-key">المفتاح</Label>
              <Input
                id="setting-key"
                dir="ltr"
                value={draft?.key ?? ''}
                disabled={Boolean(draft?.id)}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, key: event.target.value } : current
                  )
                }
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="setting-value">القيمة (JSON)</Label>
              <Textarea
                id="setting-value"
                dir="ltr"
                rows={6}
                value={draft?.value ?? ''}
                aria-invalid={Boolean(error)}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, value: event.target.value } : current
                  )
                }
                required
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={Boolean(error) || !draft?.key}>
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {confirmation}
    </>
  )
}
SettingsIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
