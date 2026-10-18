import { useEffect, useId, useRef, useState, type ComponentProps } from 'react'
import { useHttp } from '@inertiajs/react'
import axios from 'axios'
import { format } from 'date-fns'
import {
  CalendarDays,
  Check,
  ChevronsUpDown,
  Paperclip,
  Plus,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import type { CalendarSystem, ResourceEditor, ResourceField as Field } from 'adula'
import { Button } from '~/components/ui/button'
import { Calendar } from '~/components/ui/calendar'
import { HijriCalendar } from '~/components/ui/hijri-calendar'
import { calendarInput, calendarIso } from '~/components/ui/calendar_date'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useMessages } from '~/components/ui/messages'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  CURRENCY_LABEL,
  fileSize,
  moneyDisplay,
  moneyInput,
  parseMoney,
  toLatinDigits,
  type AttachmentValue,
  type Option,
} from '~/components/ui/resource-value'

export type RelationSource = { url: string; searchable: boolean }
export type InlineDefinition = ResourceEditor['inline'][string]
export type InlineRow = {
  key: string
  id?: number
  version?: number
  values: Record<string, string>
  deleted?: boolean
  dirty?: boolean
}
export type FieldProps = {
  field: Field
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  error?: string
  options?: Option[]
  relation?: RelationSource
  attachment?: AttachmentValue | null
  /** Resource name; attachment uploads are claimed against it. */
  resource?: string
  /** Accessible name when the visible label lives elsewhere, e.g. inline rows. */
  label?: string
}
export function ResourceSelect({
  value,
  onChange,
  options,
  placeholder,
  required,
  disabled,
  className = 'h-10 w-full',
  ...trigger
}: Pick<
  ComponentProps<typeof SelectTrigger>,
  'id' | 'aria-label' | 'aria-invalid' | 'aria-describedby'
> & {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  required?: boolean
  disabled?: boolean
  /** Trigger size and width; forms keep the default, toolbars pass a compact size. */
  className?: string
}) {
  const { t } = useMessages()
  const empty = placeholder ?? t('اختر قيمة')
  // Encode values so an empty selection cannot collide with a business lookup key.
  return (
    <Select
      value={`value:${value}`}
      onValueChange={(next) => onChange(next.slice(6))}
      required={required}
      disabled={disabled}
    >
      <SelectTrigger {...trigger} className={className} aria-required={required}>
        <SelectValue placeholder={empty} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="value:">{empty}</SelectItem>
        {options
          .filter((option) => String(option.value) !== '')
          .map((option) => (
            <SelectItem key={option.value} value={`value:${option.value}`}>
              {option.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

export function ResourceField(props: FieldProps) {
  const { field, id, error } = props
  const { label } = useMessages()
  return (
    <div
      className={`min-w-0 space-y-2 ${['text', 'json'].includes(field.type) ? 'md:col-span-2' : ''}`}
    >
      {/* The marker stays outside the label so the field's accessible name is the label alone. */}
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label(field.label)}</Label>
        {field.required && (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </div>
      <FieldControl {...props} />
      {error && (
        <p role="alert" id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function FieldControl(props: FieldProps) {
  const { field, id, value, onChange, disabled, error, label } = props
  const { t } = useMessages()
  const shared = {
    id,
    disabled,
    'required': field.required,
    'aria-label': label,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
  }
  switch (field.type) {
    case 'belongsTo':
    case 'user':
      return <RelationCombobox {...props} />
    case 'lookup':
      return (
        <ResourceSelect
          {...shared}
          value={value}
          onChange={onChange}
          options={props.options ?? []}
        />
      )
    case 'boolean':
      return (
        <div className="flex h-10 items-center gap-3">
          <Switch
            {...shared}
            required={undefined}
            checked={value === 'true'}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
          />
          <span className="text-sm text-muted-foreground">
            {value === 'true' ? t('نعم') : t('لا')}
          </span>
        </div>
      )
    case 'attachment':
      return <AttachmentControl {...props} />
    case 'text':
      return (
        <Textarea
          {...shared}
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'json':
      return <JsonControl {...props} />
    case 'money':
      return <MoneyControl {...props} />
    case 'date':
      return <DateControl {...props} />
    case 'datetime':
      return <DatetimeControl {...props} />
    case 'integer':
      return (
        <Input
          {...shared}
          type="number"
          step={1}
          inputMode="numeric"
          dir="ltr"
          className="h-10"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    default:
      return (
        <Input
          {...shared}
          type="text"
          className="h-10"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}

function MoneyControl({ id, value, onChange, disabled, error, field, label }: FieldProps) {
  const { t } = useMessages()
  let preview = ''
  try {
    if (value) preview = moneyDisplay(parseMoney(value))
  } catch {
    preview = ''
  }
  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          dir="ltr"
          placeholder="0.00"
          className="h-10 pe-16 text-end tabular-nums"
          value={value}
          disabled={disabled}
          required={field.required}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            try {
              if (value) onChange(moneyInput(parseMoney(value)))
            } catch {
              // Keep the typed text so the submit error can point at it.
            }
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">
          {t(CURRENCY_LABEL)}
        </span>
      </div>
      {preview && (
        <p className="text-xs text-muted-foreground" dir="ltr">
          {preview} {t(CURRENCY_LABEL)}
        </p>
      )}
    </div>
  )
}

function DateControl({ id, value, onChange, disabled, error, field, label }: FieldProps) {
  const { calendar: preference } = useUiPreferences()
  const { t, label: localized } = useMessages()
  const name = label ?? localized(field.label)
  const [entryCalendar, setEntryCalendar] = useState<CalendarSystem>('gregory')
  const calendar = preference === 'both' ? entryCalendar : preference
  const [open, setOpen] = useState(false)
  let normalized = toLatinDigits(value)
  try {
    if (value.startsWith('hijri:')) normalized = calendarIso(value.slice(6), 'islamic-umalqura')
  } catch {
    normalized = ''
  }
  const displayed =
    calendar === 'islamic-umalqura'
      ? value.startsWith('hijri:')
        ? value.slice(6)
        : calendarInput(value, calendar)
      : normalized
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T00:00:00`)
    : undefined
  const valid = selected !== undefined && !Number.isNaN(selected.getTime())
  return (
    <div className="space-y-1">
      {preference === 'both' && (
        <div
          className="flex gap-1"
          role="group"
          aria-label={t('تقويم الإدخال: {field}', { field: name })}
        >
          <Button
            type="button"
            size="sm"
            variant={calendar === 'gregory' ? 'secondary' : 'ghost'}
            aria-pressed={calendar === 'gregory'}
            onClick={() => setEntryCalendar('gregory')}
          >
            {t('إدخال ميلادي')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={calendar === 'islamic-umalqura' ? 'secondary' : 'ghost'}
            aria-pressed={calendar === 'islamic-umalqura'}
            onClick={() => setEntryCalendar('islamic-umalqura')}
          >
            {t('إدخال هجري')}
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          dir="ltr"
          placeholder={calendar === 'islamic-umalqura' ? '1447-09-01' : '2026-01-31'}
          className="h-10 tabular-nums"
          value={displayed}
          disabled={disabled}
          required={field.required}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) =>
            onChange(
              calendar === 'islamic-umalqura' && event.target.value
                ? `hijri:${event.target.value}`
                : event.target.value
            )
          }
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              disabled={disabled}
              aria-label={t('التقويم: {field}', { field: name })}
            >
              <CalendarDays />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            {calendar === 'islamic-umalqura' ? (
              <HijriCalendar
                value={valid ? normalized : ''}
                onSelect={(iso) => {
                  onChange(iso)
                  setOpen(false)
                }}
              />
            ) : (
              <Calendar
                mode="single"
                selected={valid ? selected : undefined}
                defaultMonth={valid ? selected : undefined}
                onSelect={(date) => {
                  onChange(date ? format(date, 'yyyy-MM-dd') : '')
                  setOpen(false)
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
      {calendar === 'islamic-umalqura' && (
        <p className="text-xs text-muted-foreground">
          {t('هجري · أم القرى')}{' '}
          {valid && <span dir="ltr">{t('({date} ميلادي)', { date: normalized })}</span>}
        </p>
      )}
      {preference === 'both' && calendar === 'gregory' && valid && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t('الموافق هجريًا:')}{' '}
          <span dir="ltr">{calendarInput(normalized, 'islamic-umalqura')}</span> {t('هـ')}
        </p>
      )}
    </div>
  )
}

function DatetimeControl(props: FieldProps) {
  const { calendar } = useUiPreferences()
  const { t, label } = useMessages()
  if (calendar === 'gregory')
    return (
      <Input
        id={props.id}
        type="datetime-local"
        dir="ltr"
        className="h-10"
        value={props.value}
        disabled={props.disabled}
        required={props.field.required}
        aria-label={props.label}
        aria-invalid={Boolean(props.error)}
        onChange={(event) => props.onChange(event.target.value)}
      />
    )
  const [date, time = '00:00'] = props.value.split('T')
  return (
    <div className="space-y-2">
      <DateControl
        {...props}
        value={date}
        onChange={(next) => props.onChange(next ? `${next}T${time}` : '')}
      />
      <Input
        type="time"
        dir="ltr"
        aria-label={t('الوقت: {field}', { field: props.label ?? label(props.field.label) })}
        value={time}
        disabled={props.disabled}
        onChange={(event) => props.onChange(`${date}T${event.target.value}`)}
      />
    </div>
  )
}

function JsonControl({ id, value, onChange, disabled, error, field, label }: FieldProps) {
  const { t } = useMessages()
  const [invalid, setInvalid] = useState('')
  const check = () => {
    if (!value.trim()) return setInvalid('')
    try {
      JSON.parse(value)
      setInvalid('')
    } catch {
      setInvalid(t('أدخل بيانات JSON صحيحة'))
    }
  }
  return (
    <div className="space-y-2">
      <Textarea
        id={id}
        dir="ltr"
        rows={6}
        spellCheck={false}
        className="font-mono text-xs"
        value={value}
        disabled={disabled}
        required={field.required}
        aria-label={label}
        aria-invalid={error || invalid ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={check}
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !value.trim()}
          onClick={() => {
            try {
              onChange(JSON.stringify(JSON.parse(value), null, 2))
              setInvalid('')
            } catch {
              setInvalid(t('أدخل بيانات JSON صحيحة'))
            }
          }}
        >
          {t('تنسيق JSON')}
        </Button>
        {invalid && !error && (
          <p role="alert" className="text-xs text-destructive">
            {invalid}
          </p>
        )}
      </div>
    </div>
  )
}

/** Uploads on selection so the saved record only references an already-owned attachment id. */
function AttachmentControl({
  id,
  value,
  onChange,
  disabled,
  error,
  field,
  label,
  attachment,
  resource,
}: FieldProps) {
  const { t, label: localized } = useMessages()
  const [current, setCurrent] = useState<AttachmentValue | null>(attachment ?? null)
  const [progress, setProgress] = useState<number | null>(null)
  const [failure, setFailure] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const upload = async (file: File) => {
    setFailure('')
    setProgress(0)
    const body = new FormData()
    body.append('file', file)
    if (resource) body.append('resource', resource)
    body.append('field', field.key)
    try {
      const response = await axios.post<{ data: AttachmentValue }>('/attachments', body, {
        headers: { Accept: 'application/json' },
        withXSRFToken: true,
        onUploadProgress: (event) =>
          setProgress(event.total ? Math.round((event.loaded / event.total) * 100) : 50),
      })
      setCurrent(response.data.data)
      onChange(String(response.data.data.id))
    } catch (caught) {
      setFailure(
        axios.isAxiosError(caught)
          ? (caught.response?.data?.error?.message ?? t('تعذر رفع الملف. حاول مجدداً.'))
          : t('تعذر الاتصال بالخادم.')
      )
    } finally {
      setProgress(null)
      if (input.current) input.current.value = ''
    }
  }
  const shown = value && current && String(current.id) === value ? current : null
  return (
    <div className="space-y-2">
      <input
        ref={input}
        id={id}
        type="file"
        className="sr-only"
        disabled={disabled || progress !== null}
        aria-label={label}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
      />
      {shown ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-white px-3 py-2 text-sm">
          <Paperclip size={15} className="text-muted-foreground" />
          <a
            href={shown.url}
            download={shown.name}
            className="text-primary underline-offset-4 hover:underline"
          >
            {shown.name}
          </a>
          <span className="text-xs text-muted-foreground">{fileSize(shown.size, t)}</span>
          <span className="ms-auto flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => input.current?.click()}
            >
              <Upload size={14} />
              {t('استبدال')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="text-destructive"
              onClick={() => onChange('')}
            >
              <X size={14} />
              {t('إزالة')}
            </Button>
          </span>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={disabled || progress !== null}
          onClick={() => input.current?.click()}
        >
          <Upload size={15} />
          {progress === null ? t('اختيار ملف') : t('جارٍ الرفع {progress}%', { progress })}
        </Button>
      )}
      {progress !== null && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t('رفع {field}', { field: label ?? localized(field.label) })}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {failure && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}
    </div>
  )
}

type OptionPage = { data: Option[]; nextCursor: string | null }
/** Server-side search through the authorized options route; keyset "more" keeps large relations usable. */
function RelationCombobox({
  id,
  value,
  onChange,
  disabled,
  error,
  field,
  label,
  options = [],
  relation,
}: FieldProps) {
  const { t, label: localized } = useMessages()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [loaded, setLoaded] = useState<Option[]>(options)
  const [cursor, setCursor] = useState<string | null>(null)
  const [fetched, setFetched] = useState(false)
  const [failure, setFailure] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const http = useHttp<Record<string, never>, OptionPage>({})
  const listId = useId()
  const current =
    loaded.find((option) => option.value === value) ??
    options.find((option) => option.value === value)
  const load = async (more: boolean, term = search) => {
    if (!relation) return
    setFailure('')
    const url = new URL(relation.url, window.location.origin)
    if (term && relation.searchable) url.searchParams.set('search', term)
    if (more && cursor) url.searchParams.set('cursor', cursor)
    try {
      const page = await http.get(url.pathname + url.search)
      if (!page) return
      setFetched(true)
      setCursor(page.nextCursor)
      setLoaded((previous) => {
        const keep = more ? previous : previous.filter((option) => option.value === value)
        return [
          ...new Map([...keep, ...page.data].map((option) => [option.value, option])).values(),
        ]
      })
    } catch {
      setFailure(t('تعذر تحميل الخيارات'))
    }
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  const searchable = Boolean(relation?.searchable)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next && relation && !fetched) void load(false, '')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          role="combobox"
          variant="outline"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={disabled}
          className={`h-10 w-full justify-between font-normal ${current ? '' : 'text-muted-foreground'}`}
        >
          <span className="truncate">
            {current?.label ??
              (value ? `#${value}` : field.type === 'user' ? t('اختر مستخدماً') : t('اختر سجلاً'))}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command shouldFilter={!searchable}>
          <CommandInput
            placeholder={
              field.type === 'user'
                ? t('ابحث بالاسم')
                : searchable
                  ? t('ابحث في السجلات المرتبطة')
                  : t('تصفية الخيارات')
            }
            aria-label={t('البحث في {field}', { field: label ?? localized(field.label) })}
            value={search}
            onValueChange={(term) => {
              setSearch(term)
              if (!searchable) return
              clearTimeout(timer.current)
              timer.current = setTimeout(() => void load(false, term), 300)
            }}
          />
          <CommandList id={listId}>
            <CommandEmpty>
              {http.processing ? t('جارٍ البحث...') : t('لا توجد سجلات مطابقة')}
            </CommandEmpty>
            <CommandGroup>
              {value && !field.required && (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange('')
                    setOpen(false)
                  }}
                >
                  <X />
                  {t('بدون اختيار')}
                </CommandItem>
              )}
              {loaded.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label]}
                  onSelect={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  <Check className={option.value === value ? 'opacity-100' : 'opacity-0'} />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {cursor && (
              <div className="border-t p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  disabled={http.processing}
                  onClick={() => void load(true)}
                >
                  {http.processing ? t('جارٍ التحميل...') : t('المزيد')}
                </Button>
              </div>
            )}
            {failure && (
              <p role="alert" className="p-2 text-xs text-destructive">
                {failure}
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

let rowSequence = 0
export function newInlineRow(fields: Field[]): InlineRow {
  rowSequence += 1
  return {
    key: `new-${rowSequence}`,
    values: Object.fromEntries(
      fields.map((field) => [field.key, field.type === 'boolean' ? 'false' : ''])
    ),
    dirty: true,
  }
}

/** Inline hasMany rows: new rows, versioned updates and explicit `_delete` markers in one editable table. */
export function InlineRows({
  field,
  inline,
  rows,
  onChange,
  errors = {},
  sectionError,
  disabled,
  resource,
}: {
  field: Field
  inline: InlineDefinition
  rows: InlineRow[]
  onChange: (rows: InlineRow[]) => void
  errors?: Record<string, Record<string, string>>
  sectionError?: string
  disabled?: boolean
  resource: string
}) {
  const update = (key: string, patch: Partial<InlineRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  const editable = (row: InlineRow, key: string) =>
    row.id === undefined
      ? inline.createFields.includes(key)
      : Boolean(inline.permissions[String(row.id)]?.update) &&
        (inline.updateFields[String(row.id)] ?? []).includes(key)
  const { t, label } = useMessages()
  const live = rows.filter((row) => !row.deleted)
  return (
    <section aria-label={label(field.label)} className="rounded-xl border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-7 py-4">
        <div>
          <h2 className="text-sm font-semibold">{label(field.label)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {live.length ? t('{count} بند', { count: live.length }) : t('لا توجد بنود بعد')}
            {inline.hasMore && ` · ${t('تظهر أول 100 بند فقط')}`}
          </p>
        </div>
        {inline.canCreate && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onChange([...rows, newInlineRow(inline.fields)])}
          >
            <Plus size={15} />
            {t('إضافة بند')}
          </Button>
        )}
      </div>
      {sectionError && (
        <p role="alert" className="border-b px-7 py-3 text-sm text-destructive">
          {sectionError}
        </p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="w-12 px-4 py-3 text-start font-medium">#</th>
                {inline.fields.map((child) => (
                  <th key={child.key} className="px-3 py-3 text-start font-medium">
                    {label(child.label)}
                    {child.required && (
                      <span className="text-destructive" aria-hidden="true">
                        {' '}
                        *
                      </span>
                    )}
                  </th>
                ))}
                <th className="w-24 px-4 py-3 text-start font-medium">
                  <span className="sr-only">{t('الإجراء')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const number = index + 1
                const rowErrors = errors[row.key] ?? {}
                return (
                  <tr
                    key={row.key}
                    aria-label={t('بند {number}', { number })}
                    className={`border-b align-top last:border-0 ${row.deleted ? 'bg-destructive/5 opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{number}</td>
                    {inline.fields.map((child) => (
                      <td key={child.key} className="min-w-40 px-3 py-2">
                        <FieldControl
                          field={child}
                          id={`${field.key}-${row.key}-${child.key}`}
                          label={t('{field} للبند {number}', { field: label(child.label), number })}
                          value={row.values[child.key] ?? ''}
                          disabled={disabled || row.deleted || !editable(row, child.key)}
                          error={rowErrors[child.key]}
                          resource={resource}
                          relation={
                            child.type === 'belongsTo' || child.type === 'user'
                              ? {
                                  url: `/resources/${(field as { resource?: string }).resource}/options/${child.key}`,
                                  searchable: child.type === 'user',
                                }
                              : undefined
                          }
                          onChange={(value) =>
                            update(row.key, {
                              values: { ...row.values, [child.key]: value },
                              dirty: true,
                            })
                          }
                        />
                        {rowErrors[child.key] && (
                          <p role="alert" className="mt-1 text-xs text-destructive">
                            {rowErrors[child.key]}
                          </p>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-2">
                      {row.id === undefined ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={disabled}
                          aria-label={t('إزالة البند {number}', { number })}
                          onClick={() => onChange(rows.filter((entry) => entry.key !== row.key))}
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      ) : inline.permissions[String(row.id)]?.delete ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={disabled}
                          aria-label={
                            row.deleted
                              ? t('التراجع عن حذف البند {number}', { number })
                              : t('حذف البند {number}', { number })
                          }
                          onClick={() => update(row.key, { deleted: !row.deleted })}
                        >
                          {row.deleted ? <Undo2 /> : <Trash2 className="text-destructive" />}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
