import { useRef, useState, type FormEvent } from 'react'
import { router, usePage } from '@inertiajs/react'
import axios from 'axios'
import { toast } from 'sonner'
import { Bot, Send } from 'lucide-react'
import type { AssistantProposal, AssistantStatus, AssistantTurnResult } from 'adula'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'
import { countForm, useMessages, type Translate } from '~/components/ui/messages'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { failure, json } from '~/components/account/request'
import { AssistantNotice } from './notice'
import { ProposalDialog } from './proposal-dialog'

type Entry = { role: 'user' | 'assistant'; content: string }
const HISTORY_LIMIT = 20

/** The daily budget counts tokens: «رمز واحد»، «رمزان»، «3 رموز»، «11 رمزًا»، «100 رمز». */
export function tokenCount(count: number, t: Translate) {
  switch (countForm(count)) {
    case 'one':
      return t('رمز واحد')
    case 'two':
      return t('رمزان')
    case 'few':
      return t('{count} رموز', { count })
    case 'many':
      return t('{count} رمزًا', { count })
    default:
      return t('{count} رمز', { count })
  }
}

/**
 * The assistant entry in the top bar and its panel (ADR 052). Renders nothing unless the
 * user has `core.ai/use` and an administrator enabled the assistant. Replies are plain
 * text; proposed changes run only from the review dialog.
 */
export default function AssistantLauncher() {
  const { props } = usePage<{ assistant?: AssistantStatus }>()
  const { t, dir } = useMessages()
  const status = props.assistant
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conversation, setConversation] = useState<number | null>(null)
  const [proposals, setProposals] = useState<AssistantProposal[]>([])
  const [reviewing, setReviewing] = useState<AssistantProposal | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [remaining, setRemaining] = useState<number | null>(null)
  const end = useRef<HTMLDivElement>(null)
  if (!status?.available) return null

  const scroll = () => setTimeout(() => end.current?.scrollIntoView({ block: 'end' }), 0)

  const accept = async () => {
    setBusy(true)
    setError('')
    try {
      await axios.post('/assistant/notice', {}, json)
      router.reload({ only: ['assistant'] })
    } catch (caught) {
      setError(failure(caught, t('تعذر حفظ الموافقة.')))
    } finally {
      setBusy(false)
    }
  }

  const ask = async (event: FormEvent) => {
    event.preventDefault()
    const message = draft.trim()
    if (!message || busy) return
    setBusy(true)
    setError('')
    const history = entries.slice(-HISTORY_LIMIT)
    setEntries((current) => [...current, { role: 'user', content: message }])
    setDraft('')
    scroll()
    try {
      let id = conversation
      if (id === null) {
        const started = await axios.post('/assistant/conversations', {}, json)
        id = Number(started.data.data.id)
        setConversation(id)
      }
      const response = await axios.post(
        `/assistant/conversations/${id}/turns`,
        { message, history },
        json
      )
      const result = response.data.data as AssistantTurnResult
      setEntries((current) => [...current, { role: 'assistant', content: result.reply }])
      setProposals((current) => [...current, ...result.proposals])
      setRemaining(result.usage.remainingToday)
    } catch (caught) {
      setEntries((current) => current.slice(0, -1))
      setDraft(message)
      setError(failure(caught, t('تعذر الحصول على رد. حاول مرة أخرى.')))
    } finally {
      setBusy(false)
      scroll()
    }
  }

  const decide = async (decision: 'confirm' | 'reject') => {
    if (!reviewing || conversation === null) return
    setBusy(true)
    setReviewError('')
    try {
      await axios.post(
        `/assistant/conversations/${conversation}/actions/${reviewing.id}/${decision}`,
        {},
        json
      )
      const note = decision === 'confirm' ? t('نُفّذ الاقتراح.') : t('رُفض الاقتراح ولم يُنفَّذ.')
      setEntries((current) => [...current, { role: 'assistant', content: note }])
      setProposals((current) => current.filter((entry) => entry.id !== reviewing.id))
      setReviewing(null)
      if (decision === 'confirm') {
        toast.success(note)
        router.reload()
      }
    } catch (caught) {
      setReviewError(failure(caught, t('تعذر تنفيذ الاقتراح.')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* The top-bar icon pattern of the notification bell and «مهامي». */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('المساعد الذكي')}
            aria-expanded={open}
            data-testid="assistant-launcher"
            onClick={() => setOpen(true)}
            className={`relative grid size-9 place-items-center rounded-full transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${open ? 'bg-accent text-primary' : 'text-muted-foreground'}`}
          >
            <Bot size={18} strokeWidth={1.6} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('المساعد الذكي')}</TooltipContent>
      </Tooltip>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          dir={dir}
          side={dir === 'rtl' ? 'left' : 'right'}
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2">
              <Bot size={18} />
              {t('المساعد الذكي')}
            </SheetTitle>
            <SheetDescription>
              {t('يجيب عن أسئلتك ويقرأ السجلات بصلاحياتك أنت فقط.')}
            </SheetDescription>
          </SheetHeader>
          {!status.noticeAccepted ? (
            <div className="space-y-4 p-4">
              <AssistantNotice />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="button" disabled={busy} onClick={accept}>
                {t('فهمت وأوافق')}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
                {entries.length === 0 && (
                  <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    {t('اسأل عن سجلاتك، مثل: كم طلباً مفتوحاً في وحدتي؟')}
                  </p>
                )}
                {entries.map((entry, index) => (
                  <div
                    key={index}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-6 whitespace-pre-wrap ${entry.role === 'user' ? 'ms-auto bg-primary text-primary-foreground' : 'bg-muted'}`}
                  >
                    {entry.content}
                  </div>
                ))}
                {proposals.map((proposal) => (
                  <div
                    key={proposal.id}
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span>
                      {t('اقتراح بانتظار مراجعتك')}: {proposal.resourceLabel}
                      {proposal.recordId !== null && ` #${proposal.recordId}`}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReviewError('')
                        setReviewing(proposal)
                      }}
                    >
                      {t('مراجعة')}
                    </Button>
                  </div>
                ))}
                {busy && <p className="text-xs text-muted-foreground">{t('يكتب المساعد…')}</p>}
                <div ref={end} />
              </div>
              <form onSubmit={ask} className="space-y-2 border-t p-4">
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Textarea
                  value={draft}
                  maxLength={4000}
                  rows={3}
                  aria-label={t('سؤالك')}
                  placeholder={t('اكتب سؤالك…')}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {remaining !== null &&
                      t('المتبقي اليوم: {count}', { count: tokenCount(remaining, t) })}
                  </span>
                  <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
                    <Send size={14} />
                    {t('إرسال')}
                  </Button>
                </div>
              </form>
            </>
          )}
        </SheetContent>
      </Sheet>
      <ProposalDialog
        proposal={reviewing}
        busy={busy}
        error={reviewError}
        onConfirm={() => decide('confirm')}
        onReject={() => decide('reject')}
        onClose={() => setReviewing(null)}
      />
    </>
  )
}
