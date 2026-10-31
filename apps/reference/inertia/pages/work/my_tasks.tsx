import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import axios from 'axios'
import { CalendarClock, CheckCircle2, ListChecks, XCircle } from 'lucide-react'
import type { Assignment, AssignmentPage, WorkflowRun } from 'adula'
import Workspace from '~/layouts/workspace'
import { useDateTimeFormatter } from '~/components/admin-nav'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { formatDate } from '~/components/ui/resource-value'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { OnBehalfOf, SlaBadge, WorkflowDecision } from '~/components/ui/record-workflows'

type Tab = 'all' | 'approvals' | 'assigned' | 'closed'
/** Approval runs waiting for this user's decision, by workflow run id. */
type Props = { assignments: AssignmentPage; tab: Tab; decisions: Record<string, WorkflowRun> }

const empty: Record<Tab, string> = {
  all: 'لا مهام ولا موافقات مفتوحة.',
  approvals: 'لا موافقات بانتظار قرارك.',
  assigned: 'لا مهام مسندة إليك مفتوحة.',
  closed: 'لا مهام مغلقة بعد.',
}

const statusLabel: Record<Assignment['status'], string> = {
  open: 'مفتوحة',
  done: 'منجزة',
  cancelled: 'ملغاة',
}

/** Everything waiting for the user: assigned tasks and approval decisions, acted on in place (#35). */
export default function MyTasks({ assignments, tab, decisions }: Props) {
  const formatDateTime = useDateTimeFormatter()
  const { calendar } = useUiPreferences()
  const [rows, setRows] = useState(assignments.data)
  // Runs for the decision dialog, merged as "load more" pages arrive.
  const [runs, setRuns] = useState(decisions)
  const [cursor, setCursor] = useState(assignments.nextCursor)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  // Closing asks for a note first; the application decides whether it is required.
  const [closing, setClosing] = useState<{
    item: Assignment
    action: 'complete' | 'cancel'
  } | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  useEffect(() => {
    setRows(assignments.data)
    setCursor(assignments.nextCursor)
    setRuns(decisions)
  }, [assignments, decisions])
  const today = new Date().toISOString().slice(0, 10)
  const more = async () => {
    if (!cursor) return
    const response = await axios.get<
      AssignmentPage & { decisions: Record<string, WorkflowRun> }
    >('/my-tasks', {
      params: { cursor, tab },
      headers: { Accept: 'application/json' },
    })
    setRows((current) => [...current, ...response.data.data])
    setRuns((current) => ({ ...current, ...response.data.decisions }))
    setCursor(response.data.nextCursor)
  }
  const reload = () => router.reload({ only: ['assignments', 'decisions', 'openTasks'] })
  const approvals = assignments.approvals ?? 0
  const tasks = assignments.open - approvals
  const act = (item: Assignment, action: 'complete' | 'cancel') => {
    setClosing({ item, action })
    setNote('')
    setNoteError('')
  }
  const submitClose = async (event: FormEvent) => {
    event.preventDefault()
    if (!closing) return
    const { item, action } = closing
    if (item.closeNote === 'required' && !note.trim()) {
      setNoteError('اكتب ملاحظة الإغلاق.')
      return
    }
    setBusy(item.id)
    setError('')
    try {
      await axios.post(
        `/my-tasks/${item.id}/${action}`,
        { note: note.trim() },
        { headers: { Accept: 'application/json' }, withXSRFToken: true }
      )
      setClosing(null)
      reload()
    } catch (caught) {
      setNoteError(
        axios.isAxiosError(caught) && caught.response?.data?.error?.message
          ? String(caught.response.data.error.message)
          : 'تعذر تحديث المهمة.'
      )
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <Head title="مهامي" />
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">مهامي</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {assignments.open
              ? `${assignments.open} مفتوحة، منها ${approvals} بانتظار قرارك`
              : 'لا مهام مفتوحة'}
          </p>
        </div>
        <Tabs value={tab} onValueChange={(value) => router.get('/my-tasks', { tab: value })}>
          <TabsList>
            <TabsTrigger value="all">
              الكل{assignments.open ? ` (${assignments.open})` : ''}
            </TabsTrigger>
            <TabsTrigger value="approvals">
              بانتظار قراري{approvals ? ` (${approvals})` : ''}
            </TabsTrigger>
            <TabsTrigger value="assigned">مهام مسندة{tasks ? ` (${tasks})` : ''}</TabsTrigger>
            <TabsTrigger value="closed">المغلقة</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {rows.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white px-5 py-4"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {item.title}
                <Badge variant={item.status === 'open' ? 'default' : 'secondary'}>
                  {statusLabel[item.status]}
                </Badge>
                {item.kind === 'approval' && <Badge variant="outline">موافقة</Badge>}
                {item.onBehalfOf && <OnBehalfOf name={item.onBehalfOf.name} />}
                {item.managed && <Badge variant="outline">تُغلق مع السجل</Badge>}
              </p>
              <Link
                href={`/resources/${item.resource}/${item.recordId}`}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                {item.resourceLabel}: {item.recordTitle ?? `#${item.recordId}`}
              </Link>
              {item.note && <p className="text-sm text-muted-foreground">{item.note}</p>}
              {item.managed && item.status === 'open' && (
                <p className="text-sm text-muted-foreground">
                  تُغلق هذه المهمة تلقائياً عند إنجاز العمل المطلوب في السجل، أو يدوياً مع
                  ملاحظة.
                </p>
              )}
              {item.closeReason && (
                <p className="text-sm text-muted-foreground">سبب الإغلاق: {item.closeReason}</p>
              )}
              <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>
                  {item.kind === 'approval' ? 'طلبها' : 'أسندها'}: {item.assignedByName ?? 'النظام'}
                </span>
                <span>{formatDateTime(item.createdAt)}</span>
                {item.status === 'open' && item.sla && item.dueAt ? (
                  <SlaBadge state={item.sla} dueAt={item.dueAt} />
                ) : item.dueOn && (
                  <span
                    className={
                      item.status === 'open' && item.dueOn < today
                        ? 'flex items-center gap-1 font-medium text-red-700'
                        : 'flex items-center gap-1'
                    }
                  >
                    <CalendarClock size={13} />
                    الاستحقاق <bdi className="tabular-nums">{formatDate(item.dueOn, calendar)}</bdi>
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              {item.canComplete && (
                <Button size="sm" disabled={busy === item.id} onClick={() => act(item, 'complete')}>
                  <CheckCircle2 size={15} />
                  تم الإنجاز
                </Button>
              )}
              {item.canCancel && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === item.id}
                  onClick={() => act(item, 'cancel')}
                >
                  <XCircle size={15} />
                  إلغاء المهمة
                </Button>
              )}
              {item.managed && item.status === 'open' && (
                <Button size="sm" asChild>
                  <Link href={`/resources/${item.resource}/${item.recordId}`}>فتح السجل</Link>
                </Button>
              )}
              {item.canDecide && item.workflowRunId && runs[item.workflowRunId] && (
                <WorkflowDecision run={runs[item.workflowRunId]} onDecided={reload} />
              )}
            </div>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-muted-foreground">
            <ListChecks size={26} />
            {empty[tab]}
          </li>
        )}
      </ul>
      {cursor && (
        <div className="mt-6 text-center">
          <Button variant="outline" onClick={more}>
            تحميل المزيد
          </Button>
        </div>
      )}
      <Dialog open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
        <DialogContent>
          <form onSubmit={submitClose} className="space-y-5">
            <DialogHeader>
              <DialogTitle>
                {closing?.action === 'cancel' ? 'إلغاء المهمة' : 'إنجاز المهمة'}
              </DialogTitle>
              <DialogDescription>{closing?.item.title}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="close-note" className="flex items-center gap-2">
                ملاحظة الإغلاق
                {closing?.item.closeNote === 'required' ? (
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">(اختيارية)</span>
                )}
              </Label>
              <Textarea
                id="close-note"
                value={note}
                maxLength={500}
                required={closing?.item.closeNote === 'required'}
                aria-invalid={Boolean(noteError)}
                onChange={(event) => setNote(event.target.value)}
              />
              {noteError && (
                <p role="alert" className="text-sm text-destructive">
                  {noteError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClosing(null)}>
                تراجع
              </Button>
              <Button type="submit" disabled={busy === closing?.item.id}>
                {closing?.action === 'cancel' ? 'تأكيد الإلغاء' : 'تأكيد الإنجاز'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
MyTasks.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
