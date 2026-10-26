import { useEffect, useState, type FormEvent } from 'react'
import { router } from '@inertiajs/react'
import axios from 'axios'
import { Check, ChevronsUpDown, Trash2, UserRoundCheck } from 'lucide-react'
import type { ResourceField, WorkflowDelegation } from 'adula'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { Textarea } from '~/components/ui/textarea'
import { FieldControl } from '~/components/ui/resource-field'
import { formatDate, toLatinDigits } from '~/components/ui/resource-value'
import { calendarIso } from '~/components/ui/calendar_date'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { useUiPreferences } from '~/components/ui/ui-preferences'

export type Candidate = { id: number; name: string }
const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }

export const delegationStatusLabel: Record<WorkflowDelegation['status'], string> = {
  scheduled: 'مجدول',
  active: 'سارٍ',
  ended: 'منتهٍ',
  revoked: 'ملغى',
}

export function DelegationStatus({ status }: { status: WorkflowDelegation['status'] }) {
  return (
    <Badge
      variant={status === 'active' ? 'default' : status === 'scheduled' ? 'outline' : 'secondary'}
    >
      {delegationStatusLabel[status]}
    </Badge>
  )
}

function errorMessage(caught: unknown, fallback: string) {
  return axios.isAxiosError(caught) && caught.response?.data?.error?.message
    ? String(caught.response.data.error.message)
    : fallback
}

/** A searchable user picker backed by a delegation candidates endpoint (id and name only). */
export function UserPicker({
  id,
  url,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id: string
  url: string
  value: Candidate | null
  onChange: (value: Candidate | null) => void
  placeholder: string
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<Candidate[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!open) return
    // The server answers only searches of two characters or more.
    if (search.trim().length < 2) {
      setUsers([])
      setFailed(false)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const response = await axios.get<{ data: Candidate[] }>(url, {
          ...json,
          params: { q: search },
        })
        setUsers(response.data.data)
        setFailed(false)
      } catch {
        setUsers([])
        setFailed(true)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [open, search, url])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className="h-10 w-full justify-between font-normal"
        >
          <span className={value ? '' : 'text-muted-foreground'}>{value?.name ?? placeholder}</span>
          <ChevronsUpDown size={14} className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="اكتب حرفين من الاسم أو البريد كاملًا…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {search.trim().length < 2
                ? 'اكتب حرفين على الأقل للبحث.'
                : users === null
                  ? 'جارٍ البحث…'
                  : failed
                    ? 'تعذر تحميل المستخدمين.'
                    : 'لا يوجد مستخدمون مطابقون.'}
            </CommandEmpty>
            {(users ?? []).map((user) => (
              <CommandItem
                key={user.id}
                value={String(user.id)}
                onSelect={() => {
                  onChange(user)
                  setOpen(false)
                }}
              >
                <Check
                  size={14}
                  className={value?.id === user.id ? 'opacity-100' : 'opacity-0'}
                  aria-hidden="true"
                />
                {user.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const dateField = (label: string): ResourceField =>
  ({ key: label, type: 'date', required: true, label: { ar: label } }) as ResourceField

/** The date control stores Hijri entry as `hijri:<date>`; the API takes ISO dates. */
function isoDate(value: string) {
  try {
    return value.startsWith('hijri:')
      ? calendarIso(toLatinDigits(value.slice(6)), 'islamic-umalqura')
      : toLatinDigits(value)
  } catch {
    return value
  }
}

/**
 * The create-delegation form in a Dialog. `delegatorUrl` adds the approver picker for
 * administrators; without it the signed-in user delegates their own approvals.
 */
export function DelegationDialog({
  open,
  onOpenChange,
  endpoint,
  candidatesUrl,
  admin = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  endpoint: string
  candidatesUrl: string
  admin?: boolean
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [delegator, setDelegator] = useState<Candidate | null>(null)
  const [delegate, setDelegate] = useState<Candidate | null>(null)
  const [startsOn, setStartsOn] = useState(today)
  const [endsOn, setEndsOn] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setDelegator(null)
    setDelegate(null)
    setStartsOn(new Date().toISOString().slice(0, 10))
    setEndsOn('')
    setNote('')
    setError('')
  }, [open])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (admin && !delegator) return setError('اختر صاحب الموافقات.')
    if (!delegate) return setError('اختر المفوَّض إليه.')
    if (!startsOn || !endsOn) return setError('حدد تاريخي البداية والنهاية.')
    setBusy(true)
    setError('')
    try {
      await axios.post(
        endpoint,
        {
          ...(admin ? { delegatorId: delegator?.id } : {}),
          delegateId: delegate.id,
          startsOn: isoDate(startsOn),
          endsOn: isoDate(endsOn),
          note: note.trim(),
        },
        json
      )
      onOpenChange(false)
      router.reload({ only: ['delegations'] })
    } catch (caught) {
      setError(errorMessage(caught, 'تعذر حفظ التفويض.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog mode="edit" open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{admin ? 'تفويض موافقات مستخدم' : 'تفويض موافقاتي'}</DialogTitle>
          <DialogDescription>
            تنتقل الموافقات التي تُطلب خلال المدة إلى المفوَّض إليه، ويقرر فيها نيابة عن صاحبها.
            المهام اليدوية لا تُفوَّض.
          </DialogDescription>
        </DialogHeader>
        <form id="delegation-form" className="space-y-4" noValidate onSubmit={submit}>
          {admin && (
            <div className="space-y-2">
              <Label htmlFor="delegation-delegator">صاحب الموافقات</Label>
              <UserPicker
                id="delegation-delegator"
                url={candidatesUrl}
                value={delegator}
                onChange={setDelegator}
                placeholder="اختر المستخدم الغائب"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="delegation-delegate">المفوَّض إليه</Label>
            <UserPicker
              id="delegation-delegate"
              url={candidatesUrl}
              value={delegate}
              onChange={setDelegate}
              placeholder="اختر من يقرر نيابةً"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="delegation-starts">من تاريخ</Label>
              <FieldControl
                id="delegation-starts"
                field={dateField('من تاريخ')}
                label="من تاريخ"
                value={startsOn}
                onChange={setStartsOn}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delegation-ends">إلى تاريخ</Label>
              <FieldControl
                id="delegation-ends"
                field={dateField('إلى تاريخ')}
                label="إلى تاريخ"
                value={endsOn}
                onChange={setEndsOn}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            المدة شاملة لليومين، بحد أقصى سنة، وبتوقيت UTC.
          </p>
          <div className="space-y-2">
            <Label htmlFor="delegation-note">
              ملاحظة <span className="text-xs text-muted-foreground">(اختيارية)</span>
            </Label>
            <Textarea
              id="delegation-note"
              value={note}
              maxLength={500}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button type="submit" form="delegation-form" disabled={busy}>
            <UserRoundCheck size={15} />
            حفظ التفويض
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Delegations as a table; revocable rows ask for confirmation first. */
export function DelegationTable({
  delegations,
  revokeUrl,
  columns,
  empty,
  caption,
}: {
  delegations: WorkflowDelegation[]
  /** Omitted for read-only lists (delegations received). */
  revokeUrl?: (id: number) => string
  columns: ('delegator' | 'delegate')[]
  empty: string
  caption: string
}) {
  const { calendar } = useUiPreferences()
  const { confirm, confirmation } = useConfirmAction()
  const [error, setError] = useState('')
  const revoke = (item: WorkflowDelegation) =>
    confirm({
      title: 'إلغاء التفويض',
      description: `ينتهي تفويض موافقات ${item.delegatorName ?? ''} إلى ${item.delegateName ?? ''} الآن، وتعود الموافقات المفتوحة إلى صاحبها.`,
      destructive: true,
      label: 'إلغاء التفويض',
      action: async () => {
        setError('')
        try {
          if (revokeUrl) await axios.delete(revokeUrl(item.id), json)
          router.reload({ only: ['delegations'] })
        } catch (caught) {
          setError(errorMessage(caught, 'تعذر إلغاء التفويض.'))
        }
      },
    })
  return (
    <>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <Table aria-label={caption} className="min-w-[680px]">
          <TableHeader>
            <TableRow>
              {columns.includes('delegator') && <TableHead>صاحب الموافقات</TableHead>}
              {columns.includes('delegate') && <TableHead>المفوَّض إليه</TableHead>}
              <TableHead>المدة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>ملاحظة</TableHead>
              {revokeUrl && (
                <TableHead>
                  <span className="sr-only">إجراء</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {delegations.map((item) => (
              <TableRow key={item.id}>
                {columns.includes('delegator') && (
                  <TableCell className="font-medium">{item.delegatorName ?? `#${item.delegatorId}`}</TableCell>
                )}
                {columns.includes('delegate') && (
                  <TableCell className="font-medium">{item.delegateName ?? `#${item.delegateId}`}</TableCell>
                )}
                <TableCell className="tabular-nums">
                  <bdi>{formatDate(item.startsOn, calendar)}</bdi> إلى{' '}
                  <bdi>{formatDate(item.endsOn, calendar)}</bdi>
                </TableCell>
                <TableCell>
                  <DelegationStatus status={item.status} />
                </TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground" title={item.note ?? undefined}>
                  {item.note ?? '—'}
                </TableCell>
                {revokeUrl && (
                  <TableCell className="text-end">
                    {(item.status === 'active' || item.status === 'scheduled') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        aria-label={`إلغاء تفويض ${item.delegateName ?? item.id}`}
                        onClick={() => revoke(item)}
                      >
                        <Trash2 size={14} />
                        إلغاء
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {delegations.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (revokeUrl ? 5 : 4)}
                  className="py-10 text-center text-muted-foreground"
                >
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {confirmation}
    </>
  )
}
