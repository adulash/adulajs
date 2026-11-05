import type { AssistantProposal } from 'adula'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { useMessages } from '~/components/ui/messages'

const ACTIONS: Record<string, string> = {
  create: 'إنشاء سجل',
  update: 'تعديل سجل',
  delete: 'حذف سجل',
  submit: 'اعتماد سجل',
  cancel: 'إلغاء سجل',
}

const shown = (value: unknown) =>
  value === null || value === undefined || value === ''
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)

/**
 * The exact change the assistant proposed. Nothing runs until the user presses «تنفيذ»;
 * the server then re-checks every permission as the user.
 */
export function ProposalDialog({
  proposal,
  busy,
  error,
  onConfirm,
  onReject,
  onClose,
}: {
  proposal: AssistantProposal | null
  busy: boolean
  error: string
  onConfirm: () => void
  onReject: () => void
  onClose: () => void
}) {
  const { t, dir } = useMessages()
  const fields = Object.entries(proposal?.input ?? {}).filter(([key]) => key !== 'version')
  const destructive = proposal?.action === 'delete' || proposal?.action === 'cancel'
  return (
    <Dialog mode="confirm" open={proposal !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent dir={dir} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('مراجعة اقتراح المساعد')}</DialogTitle>
          <DialogDescription>
            {t('اقترح المساعد هذا التعديل ولم يُنفَّذ بعد. راجعه ثم نفّذه أو ارفضه.')}
          </DialogDescription>
        </DialogHeader>
        {proposal && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-3 rounded-lg border px-4 py-3">
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">{t('الإجراء')}</dt>
                <dd className="font-medium">{t(ACTIONS[proposal.action] ?? proposal.action)}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">{t('الكيان')}</dt>
                <dd>{proposal.resourceLabel}</dd>
              </div>
              {proposal.recordId !== null && (
                <div className="col-span-2 space-y-1">
                  <dt className="text-xs text-muted-foreground">{t('السجل')}</dt>
                  <dd>
                    {proposal.recordTitle}{' '}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      #{proposal.recordId}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
            {fields.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('الحقل')}</TableHead>
                      {proposal.before && <TableHead>{t('القيمة الحالية')}</TableHead>}
                      <TableHead>{t('القيمة المقترحة')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map(([key, value]) => (
                      <TableRow key={key}>
                        <TableCell dir="ltr" className="text-end font-mono text-xs">
                          {key}
                        </TableCell>
                        {proposal.before && (
                          <TableCell className="whitespace-pre-wrap text-muted-foreground">
                            {shown(proposal.before[key])}
                          </TableCell>
                        )}
                        <TableCell className="whitespace-pre-wrap">{shown(value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onReject}>
            {t('رفض الاقتراح')}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={onConfirm}
          >
            {t('تنفيذ')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
