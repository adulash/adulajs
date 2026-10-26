import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { AlarmClock, CheckCircle2, GitBranch, UserRoundCheck, XCircle } from 'lucide-react'
import type { SlaState, WorkflowRun } from 'adula'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
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
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { formatDatetime } from '~/components/ui/resource-value'

const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }
export const runStatusLabel: Record<string, string> = {
  pending_definition: 'بانتظار التعريف',
  running: 'قيد التنفيذ',
  waiting: 'بانتظار موافقة',
  completed: 'مكتمل',
  failed: 'فشل',
  cancelled: 'أُلغي',
}
const outcomeLabel: Record<string, string> = {
  approved: 'معتمد',
  rejected: 'مرفوض',
  completed: 'مكتمل',
  no_workflow: 'بلا تدفق',
}
const eventLabel: Record<string, string> = {
  started: 'بدأ التدفق',
  evaluate: 'تقييم شرط',
  approval_requested: 'طُلبت الموافقة',
  approved: 'موافقة',
  rejected: 'رفض',
  decided: 'قرار',
  done: 'نُفذت الخطوة',
  delay_started: 'بدأ الانتظار',
  retry_scheduled: 'جدولة إعادة المحاولة',
  failed: 'فشل',
  retried: 'إعادة تشغيل',
  migrated: 'ترحيل إلى إصدار أحدث',
  completed: 'اكتمل',
  cancelled: 'أُلغي',
  sla_reminded: 'تذكير بقرب الموعد',
  sla_escalated: 'تصعيد بعد تجاوز المهلة',
}
const escalationLabel: Record<string, string> = {
  overdue: 'وُسمت متأخرة',
  notify: 'أُبلغ المسؤول',
  reassign: 'أُعيد الإسناد',
}
export const slaStateLabel: Record<SlaState, string> = {
  on_time: 'في الموعد',
  due_soon: 'يقترب الموعد',
  overdue: 'متأخر',
}

/**
 * Where an approval stands against its SLA deadline (ADR 044), with the deadline itself;
 * the state is in the text, never in the colour alone.
 */
export function SlaBadge({
  state,
  dueAt,
  escalated = false,
}: {
  state: SlaState
  dueAt: string
  escalated?: boolean
}) {
  const { calendar } = useUiPreferences()
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <Badge
        variant={state === 'overdue' ? 'destructive' : 'outline'}
        className={state === 'due_soon' ? 'border-amber-300 bg-amber-50 text-amber-900' : undefined}
      >
        <AlarmClock aria-hidden="true" />
        {slaStateLabel[state]}
      </Badge>
      <span className="text-muted-foreground">
        الموعد{' '}
        <time dateTime={dueAt} className="tabular-nums">
          <bdi>{formatDatetime(dueAt, calendar)}</bdi>
        </time>
      </span>
      {escalated && <Badge variant="secondary">صُعّدت</Badge>}
    </span>
  )
}

/** «On behalf of <name>» for an approval decided through a delegation. */
export function OnBehalfOf({ name }: { name: string | null | undefined }) {
  return (
    <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-900">
      <UserRoundCheck aria-hidden="true" />
      نيابة عن {name ?? 'زميل'}
    </Badge>
  )
}

type DecisionChoice = NonNullable<
  NonNullable<WorkflowRun['myApproval']>['decision']
>['outcomes'][number]

// A plain approval step offers exactly these two decisions.
const approvalChoices: DecisionChoice[] = [
  { key: 'approve', label: 'موافقة', comment: 'optional' },
  { key: 'reject', label: 'رفض', comment: 'optional' },
]
const dialogTitle: Record<string, string> = { approve: 'تأكيد الموافقة', reject: 'تأكيد الرفض' }

/**
 * The approver's decision in a confirmation dialog: approve or reject, or at a decision
 * step one of its named outcomes (#42). A decision never edits the submitted document.
 */
export function WorkflowDecision({
  run,
  onDecided,
}: {
  run: WorkflowRun
  onDecided: (run: WorkflowRun) => void
}) {
  const [choice, setChoice] = useState<DecisionChoice | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!run.myApproval) return null
  const form = run.myApproval.decision
  const choices = form?.outcomes ?? approvalChoices
  const open = (next: DecisionChoice) => {
    setChoice(next)
    setComment('')
    setError('')
  }
  const submit = async () => {
    if (!choice) return
    if (choice.comment === 'required' && !comment.trim()) {
      setError('اكتب ملاحظة القرار.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await axios.post<{ data: WorkflowRun }>(
        `/workflows/${run.id}/decide`,
        { decision: choice.key, comment },
        json
      )
      setChoice(null)
      setComment('')
      onDecided(response.data.data)
    } catch (caught) {
      setError(
        axios.isAxiosError(caught) && caught.response?.data?.error?.message
          ? String(caught.response.data.error.message)
          : 'تعذر تسجيل القرار.'
      )
    } finally {
      setBusy(false)
    }
  }
  const rejecting = choice?.key === 'reject'
  const behalf = run.myApproval.onBehalfOf
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {choices.map((item, index) => (
          <Button
            key={item.key}
            size="sm"
            variant={index === 0 ? 'default' : 'outline'}
            className={item.key === 'reject' ? 'text-destructive' : undefined}
            onClick={() => open(item)}
          >
            {item.key === 'approve' && <CheckCircle2 size={15} />}
            {item.key === 'reject' && <XCircle size={15} />}
            {item.label}
          </Button>
        ))}
      </div>
      <Dialog open={choice !== null} onOpenChange={(next) => !next && !busy && setChoice(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {choice && (form ? `تأكيد القرار: ${choice.label}` : dialogTitle[choice.key])}
            </DialogTitle>
            <DialogDescription>
              {run.myApproval.title} — {run.resourceLabel}:{' '}
              {run.recordTitle ?? `#${run.recordId}`}
            </DialogDescription>
          </DialogHeader>
          {behalf && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
              تقرر نيابة عن {behalf.name ?? 'زميل'} بموجب تفويض، ويُسجَّل القرار باسمك نيابة عنه.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor={`decision-comment-${run.id}`} className="flex items-center gap-1">
              {choice?.comment === 'required' ? (
                <>
                  ملاحظة
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </>
              ) : (
                'ملاحظة (اختيارية)'
              )}
            </Label>
            <Textarea
              id={`decision-comment-${run.id}`}
              value={comment}
              maxLength={1000}
              required={choice?.comment === 'required'}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setChoice(null)}>
              تراجع
            </Button>
            <Button
              type="button"
              variant={rejecting ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => void submit()}
            >
              {choice?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Workflow runs of one submittable record with their step history. */
export function RecordWorkflows({ resource, id }: { resource: string; id: number | string }) {
  const { calendar } = useUiPreferences()
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null)
  const load = useCallback(async () => {
    try {
      const response = await axios.get<{ data: WorkflowRun[] }>(
        `/resources/${resource}/${id}/workflows`,
        json
      )
      setRuns(response.data.data)
    } catch {
      setRuns([])
    }
  }, [resource, id])
  useEffect(() => {
    void load()
  }, [load])
  if (runs !== null && runs.length === 0) return null
  return (
    <section aria-label="سير العمل" className="rounded-xl border bg-white">
      <div className="flex items-center gap-2 border-b px-7 py-4">
        <GitBranch size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">سير العمل</h2>
      </div>
      {runs === null ? (
        <p role="status" className="px-7 py-5 text-xs text-muted-foreground">
          جارٍ تحميل سير العمل…
        </p>
      ) : (
        <ul className="divide-y">
          {runs.map((run) => (
            <li key={run.id} className="space-y-3 px-7 py-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{run.label}</span>
                <Badge variant={run.status === 'failed' ? 'destructive' : 'secondary'}>
                  {runStatusLabel[run.status] ?? run.status}
                </Badge>
                {run.outcome && <Badge>{outcomeLabel[run.outcome] ?? run.outcome}</Badge>}
                {run.status === 'waiting' && run.stepLabel && (
                  <span className="text-xs text-muted-foreground">الخطوة: {run.stepLabel}</span>
                )}
                {run.status === 'waiting' && run.sla && (
                  <SlaBadge
                    state={run.sla.state}
                    dueAt={run.sla.dueAt}
                    escalated={run.sla.escalated}
                  />
                )}
                <span className="ms-auto flex flex-wrap items-center gap-2">
                  {run.myApproval?.onBehalfOf && (
                    <OnBehalfOf name={run.myApproval.onBehalfOf.name} />
                  )}
                  <WorkflowDecision
                    run={run}
                    onDecided={() => {
                      void load()
                    }}
                  />
                </span>
              </div>
              {run.lastError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                  {run.lastError}
                </p>
              )}
              <ol className="space-y-1 border-s ps-4 text-xs">
                {run.history.map((entry, index) => (
                  <li key={index} className="flex flex-wrap gap-x-3">
                    <span className="font-medium">{eventLabel[entry.event] ?? entry.event}</span>
                    {entry.actorName && <span>{entry.actorName}</span>}
                    {entry.onBehalfOfName && (
                      <span className="text-sky-800">نيابة عن {entry.onBehalfOfName}</span>
                    )}
                    {entry.event === 'sla_escalated' &&
                      typeof entry.detail.action === 'string' && (
                        <span className="text-muted-foreground">
                          {escalationLabel[entry.detail.action] ?? entry.detail.action}
                        </span>
                      )}
                    {typeof entry.detail.comment === 'string' && (
                      <span className="text-muted-foreground">«{entry.detail.comment}»</span>
                    )}
                    <time dateTime={entry.at} className="text-muted-foreground tabular-nums">
                      {formatDatetime(entry.at, calendar)}
                    </time>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
