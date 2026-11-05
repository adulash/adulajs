import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { ListChecks, Plus } from 'lucide-react'
import type { Assignment, MentionCandidate } from 'adula'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { formatDate } from '~/components/ui/resource-value'
import { useUiPreferences } from '~/components/ui/ui-preferences'

const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }
const statusLabel: Record<Assignment['status'], string> = {
  open: 'مفتوحة',
  done: 'منجزة',
  cancelled: 'ملغاة',
}

/** Tasks assigned on one record, with an assignment dialog for users who may update it. */
export function RecordAssignments({
  resource,
  id,
  canAssign,
}: {
  resource: string
  id: number | string
  canAssign: boolean
}) {
  const { calendar } = useUiPreferences()
  const base = `/resources/${resource}/${id}`
  const [rows, setRows] = useState<Assignment[] | null>(null)
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState<MentionCandidate[]>([])
  const [assigneeId, setAssigneeId] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await axios.get<{ data: Assignment[] }>(`${base}/assignments`, json)
      setRows(response.data.data)
    } catch {
      setRows([])
    }
  }, [base])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!open) return
    axios
      .get<{ data: MentionCandidate[] }>(`${base}/mentions`, json)
      .then((response) => setPeople(response.data.data))
      .catch(() => setPeople([]))
  }, [open, base])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await axios.post(
        `${base}/assignments`,
        { assigneeId: Number(assigneeId), title, note, dueOn },
        json
      )
      setOpen(false)
      setTitle('')
      setNote('')
      setDueOn('')
      setAssigneeId('')
      await load()
    } catch (caught) {
      setError(
        axios.isAxiosError(caught) && caught.response?.data?.error?.message
          ? String(caught.response.data.error.message)
          : 'تعذر إسناد المهمة.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="المهام المسندة" className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-7 py-4">
        <ListChecks size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">المهام المسندة</h2>
        {canAssign && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ms-auto"
            onClick={() => setOpen(true)}
          >
            <Plus size={14} />
            إسناد مهمة
          </Button>
        )}
      </div>
      {rows === null ? (
        <p role="status" className="px-7 py-5 text-xs text-muted-foreground">
          جارٍ تحميل المهام…
        </p>
      ) : rows.length === 0 ? (
        <p className="px-7 py-5 text-xs text-muted-foreground">لا مهام على هذا السجل.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-7 py-3 text-sm"
            >
              <span className="font-medium">{row.title}</span>
              <Badge variant={row.status === 'open' ? 'default' : 'secondary'}>
                {statusLabel[row.status]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                المكلف: {row.assigneeName ?? `#${row.assigneeId}`}
              </span>
              {row.dueOn && (
                <span className="text-xs text-muted-foreground">
                  الاستحقاق <bdi className="tabular-nums">{formatDate(row.dueOn, calendar)}</bdi>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>إسناد مهمة</DialogTitle>
            <DialogDescription>
              تظهر المهمة في «مهامي» لدى المكلف، ويُشعَر بها فوراً.
            </DialogDescription>
          </DialogHeader>
          <form id="assignment-form" className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="assignment-assignee">المكلف</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger id="assignment-assignee" aria-label="المكلف">
                  <SelectValue placeholder="اختر زميلاً يملك صلاحية العرض" />
                </SelectTrigger>
                <SelectContent>
                  {people.map((person) => (
                    <SelectItem key={person.id} value={String(person.id)}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignment-title">عنوان المهمة</Label>
              <Input
                id="assignment-title"
                value={title}
                maxLength={200}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignment-due">تاريخ الاستحقاق</Label>
              <Input
                id="assignment-due"
                type="date"
                value={dueOn}
                onChange={(event) => setDueOn(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignment-note">ملاحظة</Label>
              <Textarea
                id="assignment-note"
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button
              type="submit"
              form="assignment-form"
              disabled={busy || !assigneeId || !title.trim()}
            >
              إسناد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
