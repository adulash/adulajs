import { useState, type FormEvent, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { ArrowDown, ArrowUp, Ban, CircleCheck, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import type { LookupGroupSummary, LookupValue } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Badge } from '~/components/ui/badge'
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

type Props = { groups: LookupGroupSummary[]; group: string | null; values: LookupValue[] }
type Draft = {
  id: number | null
  group: string
  key: string
  labelAr: string
  labelEn: string
  newGroup: boolean
}

const options = { preserveScroll: true, preserveState: true }

function usageText(value: LookupValue) {
  if (value.usage === null) return 'غير معروف'
  if (value.usage === 0) return 'غير مستخدمة'
  return `${value.usage} سجل`
}

export default function LookupsIndex({ groups, group, values }: Props) {
  const { confirm, confirmation } = useConfirmAction()
  const [draft, setDraft] = useState<Draft | null>(null)
  const current = groups.find((entry) => entry.group === group) ?? null
  const blank = (selected: string, newGroup: boolean): Draft => ({
    id: null,
    group: selected,
    key: '',
    labelAr: '',
    labelEn: '',
    newGroup,
  })
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const done = { ...options, onSuccess: () => setDraft(null) }
    if (draft.id)
      router.patch(
        `/admin/lookups/${draft.id}`,
        { labelAr: draft.labelAr, labelEn: draft.labelEn },
        done
      )
    else
      router.post(
        '/admin/lookups',
        { group: draft.group, key: draft.key, labelAr: draft.labelAr, labelEn: draft.labelEn },
        { ...done, preserveState: false }
      )
  }
  const move = (index: number, offset: number) => {
    const ids = values.map((value) => value.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + offset, 0, moved)
    router.put(`/admin/lookups/groups/${group}/order`, { ids }, options)
  }
  return (
    <>
      <Head title="القوائم المرجعية" />
      <AdminHeader
        title="القوائم المرجعية"
        description="قيم الحقول ذات الخيارات المحددة: عدّل تسمياتها وترتيبها وأوقف ما لم يعد يُستخدم. المفتاح ثابت لأن السجلات تحفظه."
      >
        <Button variant="outline" onClick={() => setDraft(blank('', true))}>
          <Plus size={16} />
          قائمة جديدة
        </Button>
        <Button disabled={!group} onClick={() => group && setDraft(blank(group, false))}>
          <Plus size={16} />
          إضافة قيمة
        </Button>
      </AdminHeader>
      {groups.length === 0 ? (
        <section className="rounded-xl border border-border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          لا توجد قوائم بعد. أنشئ قائمة جديدة بإضافة أول قيمة فيها.
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <nav
            aria-label="القوائم"
            className="h-fit overflow-hidden rounded-xl border border-border bg-white"
          >
            <p className="border-b border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground">
              القوائم ({groups.length})
            </p>
            <ul className="max-h-[32rem] overflow-y-auto py-1">
              {groups.map((entry) => {
                const active = entry.group === group
                return (
                  <li key={entry.group}>
                    <Link
                      href={`/admin/lookups?group=${entry.group}`}
                      preserveScroll
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center justify-between gap-2 px-4 py-2 text-sm transition-colors ${active ? 'bg-accent font-semibold text-primary' : 'hover:bg-muted'}`}
                    >
                      <span className="truncate" dir="ltr">
                        {entry.group}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {entry.active}/{entry.total}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
          <section className="min-w-0 space-y-3">
            {current && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <h2 className="text-lg font-semibold" dir="ltr">
                  {current.group}
                </h2>
                {current.declared && (
                  <Badge variant="secondary">
                    <Lock size={11} />
                    معرّفة في تطبيق
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  {current.fields.length
                    ? `تستخدمها: ${current.fields.map((field) => `${field.label} (${field.resource})`).join('، ')}`
                    : 'لا يستخدمها حقل مسجّل حالياً'}
                </span>
              </div>
            )}
            <div className="overflow-hidden rounded-xl border border-border bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">الترتيب</TableHead>
                    <TableHead>المفتاح</TableHead>
                    <TableHead>التسمية العربية</TableHead>
                    <TableHead>التسمية الإنجليزية</TableHead>
                    <TableHead>الاستخدام</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {values.map((value, index) => (
                    <TableRow key={value.id} className={value.active ? '' : 'text-muted-foreground'}>
                      <TableCell>
                        <span className="inline-flex gap-0.5">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`نقل ${value.labelAr} إلى الأعلى`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp size={15} />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`نقل ${value.labelAr} إلى الأسفل`}
                            disabled={index === values.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown size={15} />
                          </Button>
                        </span>
                      </TableCell>
                      <TableCell dir="ltr" className="text-start font-mono text-xs">
                        {value.key}
                      </TableCell>
                      <TableCell className="font-medium">{value.labelAr}</TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {value.labelEn}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {value.usage ? (
                          <Badge variant="outline">{usageText(value)}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{usageText(value)}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {value.active ? (
                          <Badge variant="secondary">
                            <CircleCheck size={11} />
                            مفعّلة
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            <Ban size={11} />
                            معطّلة
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`تحرير ${value.labelAr}`}
                            onClick={() =>
                              setDraft({
                                id: value.id,
                                group: value.group,
                                key: value.key,
                                labelAr: value.labelAr,
                                labelEn: value.labelEn === value.key ? '' : value.labelEn,
                                newGroup: false,
                              })
                            }
                          >
                            <Pencil size={15} />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={value.active ? `تعطيل ${value.labelAr}` : `تفعيل ${value.labelAr}`}
                            disabled={value.active && value.usage !== 0}
                            title={
                              value.active && value.usage
                                ? 'محفوظة في سجلات؛ غيّر قيمتها فيها أولاً'
                                : undefined
                            }
                            onClick={() =>
                              value.active
                                ? confirm({
                                    title: 'تعطيل القيمة؟',
                                    description: `لن تظهر «${value.labelAr}» عند إنشاء السجلات أو تعديلها، ويمكن تفعيلها لاحقاً.`,
                                    label: 'تعطيل القيمة',
                                    action: () =>
                                      router.post(`/admin/lookups/${value.id}/disable`, {}, options),
                                  })
                                : router.post(`/admin/lookups/${value.id}/enable`, {}, options)
                            }
                          >
                            {value.active ? <Ban size={15} /> : <CircleCheck size={15} />}
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`حذف ${value.labelAr}`}
                            disabled={value.declared || value.usage !== 0}
                            onClick={() =>
                              confirm({
                                title: 'حذف القيمة نهائياً؟',
                                description: `ستُحذف «${value.labelAr}» (${value.key}) لأنها غير مستخدمة في أي سجل.`,
                                label: 'حذف القيمة',
                                destructive: true,
                                action: () =>
                                  router.delete(`/admin/lookups/${value.id}`, {
                                    ...options,
                                    preserveState: false,
                                  }),
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {values.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        لا قيم في هذه القائمة بعد.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      )}
      <Dialog mode="edit" open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <form onSubmit={save} className="space-y-5">
            <DialogHeader>
              <DialogTitle>
                {draft?.id
                  ? `تحرير ${draft.key}`
                  : draft?.newGroup
                    ? 'قائمة جديدة'
                    : `قيمة جديدة في ${draft?.group ?? ''}`}
              </DialogTitle>
              <DialogDescription>
                {draft?.id
                  ? 'المفتاح لا يتغير لأن السجلات تحفظه؛ عدّل التسميات فقط.'
                  : 'المفتاح يُحفظ في السجلات ولا يمكن تغييره بعد الإضافة. التسمية الإنجليزية اختيارية، ويُعرض المفتاح مكانها إن تُركت فارغة.'}
              </DialogDescription>
            </DialogHeader>
            {draft?.newGroup && (
              <div className="space-y-1">
                <Label htmlFor="lookup-group">اسم القائمة</Label>
                <Input
                  id="lookup-group"
                  dir="ltr"
                  placeholder="ticket_priority"
                  value={draft.group}
                  onChange={(event) =>
                    setDraft((value) => value && { ...value, group: event.target.value })
                  }
                  required
                />
                <p className="text-xs text-muted-foreground">
                  حروف إنجليزية صغيرة وأرقام وشرطة سفلية، ويطابق ما يُكتب في تعريف الحقل.
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="lookup-key">المفتاح</Label>
              <Input
                id="lookup-key"
                dir="ltr"
                placeholder="high"
                value={draft?.key ?? ''}
                disabled={Boolean(draft?.id)}
                onChange={(event) =>
                  setDraft((value) => value && { ...value, key: event.target.value })
                }
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lookup-label-ar">التسمية العربية</Label>
              <Input
                id="lookup-label-ar"
                value={draft?.labelAr ?? ''}
                onChange={(event) =>
                  setDraft((value) => value && { ...value, labelAr: event.target.value })
                }
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lookup-label-en">التسمية الإنجليزية (اختيارية)</Label>
              <Input
                id="lookup-label-en"
                dir="ltr"
                value={draft?.labelEn ?? ''}
                onChange={(event) =>
                  setDraft((value) => value && { ...value, labelEn: event.target.value })
                }
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={!draft?.key || !draft?.labelAr || !draft?.group}>
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
LookupsIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
