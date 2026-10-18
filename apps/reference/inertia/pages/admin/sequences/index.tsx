import { useState, type FormEvent, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { SlidersHorizontal } from 'lucide-react'
import type { SequenceRow } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { Button } from '~/components/ui/button'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

type Props = { sequences: SequenceRow[] }
type Draft = { row: SequenceRow; next: string }

function preview(key: string, next: string) {
  return /^\d{1,18}$/.test(next) ? `${key}-${next.padStart(6, '0')}` : '—'
}

export default function SequencesIndex({ sequences }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const minimum = draft ? BigInt(draft.row.value) + 1n : 1n
  const valid = Boolean(draft && /^\d{1,18}$/.test(draft.next) && BigInt(draft.next) >= minimum)
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!draft || !valid) return
    router.patch(
      `/admin/sequences/${encodeURIComponent(draft.row.key)}`,
      { next: draft.next },
      { preserveScroll: true, preserveState: true, onSuccess: () => setDraft(null) }
    )
  }
  return (
    <>
      <Head title="الترقيم التسلسلي" />
      <AdminHeader
        title="الترقيم التسلسلي"
        description="أرقام المستندات التي تصدر تلقائياً. يمكن تقديم الرقم التالي فقط؛ الرجوع يكرر أرقاماً صدرت لسجلات قائمة."
      />
      <section className="overflow-hidden rounded-xl border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>التسلسل</TableHead>
              <TableHead>يُستخدم في</TableHead>
              <TableHead>آخر رقم صدر</TableHead>
              <TableHead>الرقم التالي</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sequences.map((row) => (
              <TableRow key={row.key}>
                <TableCell dir="ltr" className="text-start font-mono text-xs font-medium">
                  {row.key}
                </TableCell>
                <TableCell className="text-sm">
                  {row.fields.length ? (
                    row.fields.map((field) => `${field.label} (${field.resource})`).join('، ')
                  ) : (
                    <span className="text-muted-foreground">غير مرتبط بحقل مسجّل</span>
                  )}
                </TableCell>
                <TableCell dir="ltr" className="text-start font-mono text-xs tabular-nums">
                  {row.value === '0' ? (
                    <span className="text-muted-foreground">لم يصدر بعد</span>
                  ) : (
                    preview(row.key, row.value)
                  )}
                </TableCell>
                <TableCell dir="ltr" className="text-start font-mono text-xs font-semibold tabular-nums">
                  {row.next}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDraft({ row, next: (BigInt(row.value) + 1n).toString() })
                    }
                  >
                    <SlidersHorizontal size={14} />
                    ضبط
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {sequences.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  لا توجد تسلسلات. تظهر هنا عند تعريف حقل مرقّم تلقائياً أو صدور أول رقم.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
      <Dialog mode="edit" open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <form onSubmit={save} className="space-y-5">
            <DialogHeader>
              <DialogTitle>ضبط الرقم التالي لـ {draft?.row.key}</DialogTitle>
              <DialogDescription>
                الرقم التالي يجب أن يكون {minimum.toString()} أو أكبر. التغيير يُسجَّل في سجل
                النشاط.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="sequence-next">الرقم التالي</Label>
              <Input
                id="sequence-next"
                dir="ltr"
                inputMode="numeric"
                value={draft?.next ?? ''}
                aria-invalid={Boolean(draft) && !valid}
                onChange={(event) =>
                  setDraft((value) => value && { ...value, next: event.target.value.trim() })
                }
                required
              />
              <p className="text-xs text-muted-foreground" dir="rtl">
                سيصدر للسجل التالي:{' '}
                <span dir="ltr" className="font-mono">
                  {draft ? preview(draft.row.key, draft.next) : ''}
                </span>
              </p>
              {draft && !valid && (
                <p className="text-xs text-destructive">
                  أدخل عدداً صحيحاً لا يقل عن {minimum.toString()}.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={!valid}>
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
SequencesIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
