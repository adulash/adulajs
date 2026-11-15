import { useState, type FormEvent, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { CornerDownLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import type { OrgUnitNode } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { ResourceSelect } from '~/components/ui/resource-field'
import { Badge } from '~/components/ui/badge'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { useDialogParam } from '~/components/ui/dialog_param'

type Props = { units: OrgUnitNode[] }
type Draft = { parentId: number | null; name: string; type: string }
/** Indents nested units in a flat list so the hierarchy stays readable. */
const unitOption = (unit: OrgUnitNode) => ({
  value: String(unit.id),
  label: `${'· '.repeat(unit.depth - 1)}${unit.name}`,
})

export default function OrgUnitsIndex({ units }: Props) {
  const [creating, setCreating] = useState<Draft | null>(null)
  // `?new=1` opens the create dialog (decision 30); a sub-unit's parent comes with the opening.
  const createDialog = useDialogParam<true, number>(
    'new',
    (value) => (value === '1' ? true : undefined),
    {
      onOpen: (_open, _value, parentId) =>
        setCreating({ parentId: parentId ?? null, name: '', type: 'department' }),
    }
  )
  const [renaming, setRenaming] = useState<OrgUnitNode | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const [deleting, setDeleting] = useState<OrgUnitNode | null>(null)
  const [targets, setTargets] = useState<Record<number, string>>({})
  const options = { preserveScroll: true, preserveState: true }
  const submitCreate = (event: FormEvent) => {
    event.preventDefault()
    if (!creating) return
    router.post('/admin/org-units', creating, {
      ...options,
      // A refused unit returns with an error message; the dialog stays open with the draft.
      onSuccess: (page) => !page.flash?.error && createDialog.close(),
    })
  }
  const submitRename = (event: FormEvent) => {
    event.preventDefault()
    if (!renaming) return
    router.patch(
      `/admin/org-units/${renaming.id}`,
      { name: renameTo },
      { ...options, onSuccess: () => setRenaming(null) }
    )
  }
  const move = (unit: OrgUnitNode) => {
    const chosen = targets[unit.id] ?? String(unit.parentId ?? '')
    router.post(`/admin/org-units/${unit.id}/move`, { parentId: chosen || null }, options)
  }
  const candidates = (unit: OrgUnitNode) =>
    units.filter((other) => other.id !== unit.id && !other.path.startsWith(`${unit.path}.`))
  return (
    <>
      <Head title="الهيكل التنظيمي" />
      <AdminHeader
        title="الهيكل التنظيمي"
        description="شجرة واحدة لكل المستويات؛ نقل وحدة يحدّث نطاق كل ما تحتها فوراً."
      >
        <Button onClick={() => createDialog.open()}>
          <Plus size={16} />
          إضافة وحدة
        </Button>
      </AdminHeader>
      <ul className="space-y-2">
        {units.map((unit) => (
          <li
            key={unit.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            style={{ marginInlineStart: `${(unit.depth - 1) * 24}px` }}
          >
            <span className="min-w-48 flex-1">
              <strong className="block">{unit.name}</strong>
              <span className="text-xs text-muted-foreground">
                {unit.type}
                <span className="mx-2">·</span>
                <span dir="ltr">{unit.path}</span>
              </span>
            </span>
            <Badge variant="outline">{unit.members} عضو</Badge>
            <span className="flex items-center gap-1">
              <ResourceSelect
                aria-label={`نقل ${unit.name} إلى`}
                className="h-8 w-48 text-xs"
                value={targets[unit.id] ?? String(unit.parentId ?? '')}
                placeholder="— الجذر —"
                options={candidates(unit).map(unitOption)}
                onChange={(value) => setTargets((current) => ({ ...current, [unit.id]: value }))}
              />
              <Button
                size="sm"
                variant="outline"
                aria-label={`نقل ${unit.name}`}
                onClick={() => move(unit)}
              >
                <CornerDownLeft size={14} />
                نقل
              </Button>
            </span>
            <span className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`إضافة وحدة فرعية تحت ${unit.name}`}
                onClick={() => createDialog.open('1', unit.id)}
              >
                <Plus size={15} />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`إعادة تسمية ${unit.name}`}
                onClick={() => {
                  setRenaming(unit)
                  setRenameTo(unit.name)
                }}
              >
                <Pencil size={15} />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`حذف ${unit.name}`}
                onClick={() => setDeleting(unit)}
              >
                <Trash2 size={15} />
              </Button>
            </span>
          </li>
        ))}
        {units.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
            لا وحدات بعد؛ أضف الوحدة الجذر أولاً.
          </li>
        )}
      </ul>
      <Dialog
        open={createDialog.item !== null && creating !== null}
        onOpenChange={(open) => !open && createDialog.close()}
      >
        <DialogContent>
          <form onSubmit={submitCreate} className="space-y-5">
            <DialogHeader>
              <DialogTitle>وحدة جديدة</DialogTitle>
              <DialogDescription>تُضاف تحت الوحدة الأم المختارة أو كجذر.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="unit-parent">الوحدة الأم</Label>
              <ResourceSelect
                id="unit-parent"
                value={String(creating?.parentId ?? '')}
                placeholder="— الجذر —"
                options={units.map(unitOption)}
                onChange={(value) =>
                  setCreating((draft) =>
                    draft ? { ...draft, parentId: value ? Number(value) : null } : draft
                  )
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="unit-name">الاسم</Label>
              <Input
                id="unit-name"
                value={creating?.name ?? ''}
                onChange={(event) =>
                  setCreating((draft) => (draft ? { ...draft, name: event.target.value } : draft))
                }
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="unit-type">النوع</Label>
              <Input
                id="unit-type"
                value={creating?.type ?? ''}
                onChange={(event) =>
                  setCreating((draft) => (draft ? { ...draft, type: event.target.value } : draft))
                }
                required
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  إلغاء
                </Button>
              </DialogClose>
              <Button type="submit">إضافة</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <form onSubmit={submitRename} className="space-y-5">
            <DialogHeader>
              <DialogTitle>إعادة تسمية {renaming?.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="rename-unit">الاسم الجديد</Label>
              <Input
                id="rename-unit"
                value={renameTo}
                onChange={(event) => setRenameTo(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  إلغاء
                </Button>
              </DialogClose>
              <Button type="submit">حفظ</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حذف {deleting?.name}؟</DialogTitle>
            <DialogDescription>
              يُرفض الحذف إن كانت للوحدة وحدات فرعية أو أعضاء أو سجلات مقيدة بها.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                إلغاء
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                deleting &&
                router.delete(`/admin/org-units/${deleting.id}`, {
                  ...options,
                  onSuccess: () => setDeleting(null),
                })
              }
            >
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
OrgUnitsIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
