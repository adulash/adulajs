import { useEffect, useState } from 'react'
import { router } from '@inertiajs/react'
import { RotateCcw } from 'lucide-react'
import type { OverviewState } from 'adula'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { useMessages } from '~/components/ui/messages'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { SortableList, keepEscapeForSorting } from '~/components/ui/sortable-list'
import { Dialog } from '~/components/ui/dialog'
import { LongDialogContent } from '~/components/ui/long-dialog'
import { usePreference } from '~/components/preferences'

type Layout = { order: string[]; hidden: string[] }
type Row = { id: string; label: string; hidden: boolean }

/**
 * Shows, hides and orders the overview widgets (ADR 050), saved as the user's `overview.layout`
 * preference. The list holds only widgets the server says the user may see.
 */
export function CustomizeOverviewDialog({
  open,
  onOpenChange,
  overview,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  overview: OverviewState
}) {
  const { t, dir } = useMessages()
  const [, save, reset] = usePreference<Layout>('overview.layout')
  const { confirm, confirmation } = useConfirmAction()
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const label = (widget: { kind: string; label: string }) =>
    widget.kind === 'builtin' ? t(widget.label) : widget.label

  useEffect(() => {
    if (open)
      setRows(
        overview.widgets.map((widget) => ({
          id: widget.id,
          label: label(widget),
          hidden: widget.hidden,
        }))
      )
    // The draft starts from the server's arrangement each time the dialog opens.
  }, [open])

  const refresh = () =>
    new Promise<void>((resolve) =>
      router.reload({ only: ['overview'], onFinish: () => resolve() })
    )
  const submit = async () => {
    setSaving(true)
    try {
      await save({
        order: rows.map((row) => row.id),
        hidden: rows.filter((row) => row.hidden).map((row) => row.id),
      })
      await refresh()
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }
  const restore = () =>
    confirm({
      title: t('استعادة الترتيب الافتراضي؟'),
      description: t('ستعود العناصر إلى ترتيبها وظهورها الافتراضيين.'),
      label: t('استعادة الافتراضي'),
      action: async () => {
        await reset()
        await refresh()
        onOpenChange(false)
      },
    })

  return (
    <Dialog mode="edit" open={open} onOpenChange={onOpenChange}>
      <LongDialogContent
        dir={dir}
        width="md"
        onEscapeKeyDown={keepEscapeForSorting}
        title={t('تخصيص النظرة العامة')}
        description={t('اختر العناصر الظاهرة ورتّبها بالسحب أو بلوحة المفاتيح.')}
        footer={
          <>
            {/* The secondary action sits at the start; cancel and save follow at the end. */}
            <Button
              type="button"
              variant="ghost"
              className="sm:me-auto"
              onClick={restore}
              disabled={saving}
            >
              <RotateCcw size={16} />
              {t('استعادة الافتراضي')}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('إلغاء')}
            </Button>
            <Button type="button" onClick={submit} disabled={saving}>
              {t('حفظ')}
            </Button>
          </>
        }
      >
        <SortableList
          label={t('عناصر النظرة العامة')}
          items={rows}
          onChange={setRows}
          renderItem={(row) => (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{row.label}</span>
              <Switch
                checked={!row.hidden}
                aria-label={t('إظهار {widget}', { widget: row.label })}
                onCheckedChange={(checked) =>
                  setRows((current) =>
                    current.map((entry) =>
                      entry.id === row.id ? { ...entry, hidden: !checked } : entry
                    )
                  )
                }
              />
            </label>
          )}
        />
      </LongDialogContent>
      {confirmation}
    </Dialog>
  )
}
