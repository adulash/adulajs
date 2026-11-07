import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { LongDialogContent } from '~/components/ui/long-dialog'
import { useMessages } from '~/components/ui/messages'
import { applyOrder, move, replaceGroupOrder } from '~/components/shell_navigation'

export type OrderEntry = { id: string; label: string }
export type OrderGroup = { id: string; title: string; entries: OrderEntry[] }

/**
 * Arranges the navigation entries the user can see (#157), one list per group, with
 * buttons rather than dragging so the keyboard and screen readers can do it too. Saving
 * stores the user's order; the reset restores the default for every group.
 */
export function NavOrderDialog({
  open,
  onOpenChange,
  groups,
  order,
  onSave,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: OrderGroup[]
  order: string[]
  onSave: (order: string[]) => Promise<void>
  onReset: () => Promise<void>
}) {
  const { t } = useMessages()
  const initial = () => groups.map((group) => applyOrder(group.entries, order))
  const [lists, setLists] = useState<OrderEntry[][]>(initial)
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)
  const focus = useRef<string | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const formId = useId()

  // Opening again starts from the saved order.
  useEffect(() => {
    if (open) setLists(initial())
  }, [open])
  // Keeps focus on the moved entry's button so repeated moves need no tabbing.
  useEffect(() => {
    if (!focus.current) return
    container.current?.querySelector<HTMLButtonElement>(`[data-focus="${focus.current}"]`)?.focus()
    focus.current = null
  }, [lists])

  const dirty = lists.some((list, index) =>
    list.some((entry, position) => entry.id !== initial()[index][position]?.id)
  )

  const shift = (groupIndex: number, index: number, delta: -1 | 1) => {
    const list = lists[groupIndex]
    const next = move(list, index, delta)
    const entry = list[index]
    const position = index + delta
    // The same arrow again, unless the entry reached that end of the list.
    let direction = delta < 0 ? 'up' : 'down'
    if (direction === 'up' && position === 0) direction = 'down'
    if (direction === 'down' && position === list.length - 1) direction = 'up'
    focus.current = `${entry.id}:${direction}`
    setLists(lists.map((current, i) => (i === groupIndex ? next : current)))
    setAnnouncement(t('{name} في الموضع {position}', { name: entry.label, position: position + 1 }))
  }

  const save = async () => {
    setBusy(true)
    let next = [...order]
    const opened = initial()
    groups.forEach((group, index) => {
      // Only lists the user changed are stored; the others keep following the default.
      if (lists[index].every((entry, position) => entry.id === opened[index][position]?.id))
        return
      next = replaceGroupOrder(
        next,
        group.entries.map((entry) => entry.id),
        lists[index].map((entry) => entry.id)
      )
    })
    await onSave(next)
    setBusy(false)
    onOpenChange(false)
  }

  const reset = async () => {
    setBusy(true)
    await onReset()
    setBusy(false)
    onOpenChange(false)
  }

  return (
    <Dialog mode="edit" open={open} onOpenChange={onOpenChange}>
      {/* The long dialog pattern: fixed header and footer, only the lists scroll. */}
      <LongDialogContent
        width="lg"
        title={t('ترتيب القائمة')}
        description={t(
          'رتّب عناصر القائمة كما يناسب عملك. يظهر الترتيب نفسه في القائمة الجانبية والعلوية.'
        )}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              className="sm:me-auto"
              disabled={busy}
              onClick={() => void reset()}
            >
              <RotateCcw size={16} aria-hidden />
              {t('استعادة الترتيب الافتراضي')}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('إلغاء')}
            </Button>
            <Button type="submit" form={formId} disabled={busy || !dirty}>
              {t('حفظ الترتيب')}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          data-dirty={dirty ? 'true' : 'false'}
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div ref={container} className="space-y-5">
            {groups.map((group, groupIndex) => (
              <section key={group.id} aria-labelledby={`nav-order-${group.id}`}>
                <h3
                  id={`nav-order-${group.id}`}
                  className="mb-2 text-xs font-semibold text-muted-foreground"
                >
                  {group.title}
                </h3>
                <ol className="divide-y divide-border rounded-lg border border-border">
                  {lists[groupIndex].map((entry, index, list) => (
                    <li key={entry.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="w-5 text-xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        data-focus={`${entry.id}:up`}
                        disabled={index === 0}
                        aria-label={t('تحريك {name} لأعلى', { name: entry.label })}
                        onClick={() => shift(groupIndex, index, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        data-focus={`${entry.id}:down`}
                        disabled={index === list.length - 1}
                        aria-label={t('تحريك {name} لأسفل', { name: entry.label })}
                        onClick={() => shift(groupIndex, index, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </form>
      </LongDialogContent>
    </Dialog>
  )
}
