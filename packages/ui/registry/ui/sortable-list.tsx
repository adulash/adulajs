import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { useMessages } from '~/components/ui/messages'

export type SortableItem = { id: string; label: string }

/**
 * A vertical list the user reorders by dragging a row's handle, with the keyboard (Space or
 * Enter picks a row up, the arrow keys, Home and End move it, Space or Enter drops it, Escape
 * puts it back) or with the move buttons. Every move is announced. While a row is picked up
 * its handle carries `data-sortable-picked`, so a surrounding Dialog can keep Escape for the
 * list (see `keepEscapeForSorting`).
 */
export function SortableList<T extends SortableItem>({
  items,
  onChange,
  renderItem,
  label,
}: {
  items: T[]
  onChange: (items: T[]) => void
  renderItem?: (item: T) => ReactNode
  /** The list's accessible name. */
  label: string
}) {
  const { t } = useMessages()
  const [picked, setPicked] = useState<{ id: string; from: number; original: T[] } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rows = useRef(new Map<string, HTMLLIElement>())
  const handles = useRef(new Map<string, HTMLButtonElement>())

  const move = (list: T[], id: string, to: number) => {
    const from = list.findIndex((item) => item.id === id)
    if (from === -1) return list
    const target = Math.max(0, Math.min(list.length - 1, to))
    if (target === from) return list
    const next = [...list]
    const [item] = next.splice(from, 1)
    next.splice(target, 0, item)
    return next
  }
  const position = (list: T[], id: string) => list.findIndex((item) => item.id === id) + 1
  const commit = (next: T[], id: string, message: 'moved' | 'dropped') => {
    onChange(next)
    const item = next.find((entry) => entry.id === id)
    if (!item) return
    const values = {
      item: item.label,
      position: String(position(next, id)),
      total: String(next.length),
    }
    setAnnouncement(
      message === 'moved'
        ? t('نُقل {item} إلى الموضع {position} من {total}.', values)
        : t('وُضع {item} في الموضع {position} من {total}.', values)
    )
    // Keep focus on the moved row's handle after React re-renders the list.
    requestAnimationFrame(() => handles.current.get(id)?.focus())
  }

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, item: T) => {
    const index = items.findIndex((entry) => entry.id === item.id)
    if (!picked) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        setPicked({ id: item.id, from: index, original: items })
        setAnnouncement(
          t('تم التقاط {item}، الموضع {position} من {total}. استخدم الأسهم للنقل ثم المسافة للإفلات.', {
            item: item.label,
            position: String(index + 1),
            total: String(items.length),
          })
        )
      }
      return
    }
    if (picked.id !== item.id) return
    const targets: Record<string, number> = {
      ArrowUp: index - 1,
      ArrowDown: index + 1,
      Home: 0,
      End: items.length - 1,
    }
    if (event.key in targets) {
      event.preventDefault()
      commit(move(items, item.id, targets[event.key]), item.id, 'moved')
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      setPicked(null)
      commit(items, item.id, 'dropped')
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setPicked(null)
      onChange(picked.original)
      setAnnouncement(
        t('أُلغي النقل وعاد {item} إلى الموضع {position}.', {
          item: item.label,
          position: String(picked.from + 1),
        })
      )
      requestAnimationFrame(() => handles.current.get(item.id)?.focus())
    }
  }

  const pointerDown = (event: PointerEvent<HTMLButtonElement>, item: T) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setPicked(null)
    setDragging(item.id)
  }
  const pointerMove = (event: PointerEvent<HTMLButtonElement>, item: T) => {
    if (dragging !== item.id) return
    // The new position is the number of other rows whose middle lies above the pointer.
    let to = 0
    for (const entry of items) {
      if (entry.id === item.id) continue
      const box = rows.current.get(entry.id)?.getBoundingClientRect()
      if (box && event.clientY > box.top + box.height / 2) to++
    }
    const from = items.findIndex((entry) => entry.id === item.id)
    if (to !== from) onChange(move(items, item.id, to))
  }
  const pointerUp = (item: T) => {
    if (dragging !== item.id) return
    setDragging(null)
    commit(items, item.id, 'dropped')
  }

  return (
    <>
      <ul aria-label={label} className="divide-y rounded-lg border">
        {items.map((item, index) => {
          const active = picked?.id === item.id || dragging === item.id
          return (
            <li
              key={item.id}
              ref={(node) => {
                if (node) rows.current.set(item.id, node)
                else rows.current.delete(item.id)
              }}
              data-sortable-item={item.id}
              data-active={active || undefined}
              className="flex items-center gap-2 bg-background px-2 py-1.5 data-[active]:bg-accent"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                ref={(node) => {
                  if (node) handles.current.set(item.id, node)
                  else handles.current.delete(item.id)
                }}
                aria-label={t('مقبض نقل {item}', { item: item.label })}
                aria-pressed={picked?.id === item.id}
                aria-describedby="sortable-list-hint"
                data-sortable-picked={picked?.id === item.id || undefined}
                className="size-8 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
                onKeyDown={(event) => keyDown(event, item)}
                onBlur={() => picked?.id === item.id && setPicked(null)}
                onPointerDown={(event) => pointerDown(event, item)}
                onPointerMove={(event) => pointerMove(event, item)}
                onPointerUp={() => pointerUp(item)}
                onPointerCancel={() => pointerUp(item)}
              >
                <GripVertical size={16} />
              </Button>
              <div className="min-w-0 flex-1">{renderItem ? renderItem(item) : item.label}</div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={index === 0}
                aria-label={t('نقل {item} للأعلى', { item: item.label })}
                onClick={() => commit(move(items, item.id, index - 1), item.id, 'moved')}
              >
                <ArrowUp size={15} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={index === items.length - 1}
                aria-label={t('نقل {item} للأسفل', { item: item.label })}
                onClick={() => commit(move(items, item.id, index + 1), item.id, 'moved')}
              >
                <ArrowDown size={15} />
              </Button>
            </li>
          )
        })}
      </ul>
      <p id="sortable-list-hint" className="sr-only">
        {t('اضغط المسافة لالتقاط العنصر، ثم الأسهم لنقله، ثم المسافة لإفلاته، أو Escape للإلغاء.')}
      </p>
      <p aria-live="polite" role="status" className="sr-only" data-testid="sortable-announcement">
        {announcement}
      </p>
    </>
  )
}

/** For a Dialog's `onEscapeKeyDown`: Escape cancels a keyboard move instead of closing. */
export function keepEscapeForSorting(event: KeyboardEvent | globalThis.KeyboardEvent) {
  const target = event.target as Element | null
  if (target?.closest?.('[data-sortable-picked]')) event.preventDefault()
}
