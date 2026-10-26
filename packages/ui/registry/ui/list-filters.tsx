import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import axios from 'axios'
import { ChevronDown, X } from 'lucide-react'
import type { CalendarPreference, ResourceField, ResourceList, SerializedRecord } from 'adula'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { FieldControl } from '~/components/ui/resource-field'
import { useMessages, type Translate } from '~/components/ui/messages'
import {
  CURRENCY_LABEL,
  PERCENT_LABEL,
  fieldOptions,
  formatDate,
  formatDatetime,
  inputValue,
  moneyDisplay,
  optionLabel,
  parseValue,
  relationLabel,
  type Option,
} from '~/components/ui/resource-value'
import { decimalDisplay, decimalScale } from '~/components/ui/field_values'
import {
  FILTER_IN_LIMIT,
  choiceFilter,
  chosenValues,
  filterAllowed,
  filterMode,
  inclusiveDatetime,
  normalizeFilter,
  singleChoice,
  type FieldFilter,
} from '~/components/ui/list_query'

/** Labels of chosen related records, remembered so chips stay readable after a reload. */
export type FilterLabels = Record<string, Record<string, string>>

/**
 * A bound or value as the user reads it: lookup or option label, record title, formatted
 * date, amount, decimal or percent.
 */
export function filterValueLabel(
  field: ResourceField,
  value: string,
  context: {
    options?: Option[]
    related?: SerializedRecord[]
    labels?: Record<string, string>
    calendar: CalendarPreference
    t: Translate
    /** The interface language of option labels and number formats; Arabic by default. */
    language?: string
  }
) {
  const language = context.language ?? 'ar'
  switch (field.type) {
    case 'lookup':
      return context.options?.find((option) => option.value === value)?.label ?? value
    case 'enum':
    case 'multiSelect':
      return optionLabel(field, value, language)
    case 'boolean':
      return value === 'true' ? context.t('نعم') : context.t('لا')
    case 'belongsTo':
    case 'user':
    case 'manyToMany': {
      const row = context.related?.find((item) => String(item.id) === value)
      return context.labels?.[value] ?? (row ? relationLabel(row, value) : `#${value}`)
    }
    case 'money':
      return `${moneyDisplay(value)} ${context.t(CURRENCY_LABEL)}`
    case 'decimal':
      return decimalDisplay(value, decimalScale(field), language)
    case 'percent':
      return `${decimalDisplay(value, decimalScale(field), language)}${context.t(PERCENT_LABEL)}`
    case 'date':
      return formatDate(value, context.calendar)
    case 'datetime':
      return formatDatetime(value, context.calendar)
    default:
      return value
  }
}

/** The chip text of one active filter, without the field label. */
export function describeFilter(filter: FieldFilter, value: (raw: string) => string, t: Translate) {
  switch (filter.op) {
    case 'eq':
      return value(filter.value)
    case 'in':
      return filter.values.map(value).join(t('، '))
    case 'range':
      if (filter.gte && filter.lte)
        return t('من {from} إلى {to}', {
          from: value(filter.gte),
          to: value(filter.lte),
        })
      return filter.gte
        ? t('من {from}', { from: value(filter.gte) })
        : t('إلى {to}', { to: value(filter.lte ?? '') })
    case 'empty':
      return filter.empty ? t('فارغ') : t('غير فارغ')
  }
}

/**
 * One field's filter: «أيٌّ من» for lookups, options, text and related records, «يحتوي على»
 * one option or linked record for multiSelect and manyToMany, «من / إلى» for numbers,
 * amounts, decimals, percents and dates, نعم/لا for booleans and «فارغ / غير فارغ» for
 * every field. Changes stay a draft until «تطبيق».
 */
export function FilterControl({
  resource,
  field,
  filter,
  options,
  related,
  labels,
  onRemember,
  onApply,
}: {
  resource: string
  field: ResourceField
  filter?: FieldFilter
  options?: Option[]
  related?: SerializedRecord[]
  labels?: Record<string, string>
  onRemember?: (choices: Option[]) => void
  onApply: (filter: FieldFilter | null) => void
}) {
  const { t, label, locale } = useMessages()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<FieldFilter | null>(filter ?? null)
  const [error, setError] = useState('')
  const mode = filterMode(field.type)
  const name = label(field.label)
  const id = `filter-${field.key}`
  const count = filter?.op === 'in' ? filter.values.length : filter ? 1 : 0
  const apply = (next: FieldFilter | null) => {
    setError('')
    if (next?.op === 'in' && next.values.length > FILTER_IN_LIMIT) {
      setError(t('يمكن اختيار {count} قيمة كحد أقصى.', { count: FILTER_IN_LIMIT }))
      return
    }
    if (next && !filterAllowed(field.type, next)) {
      setError(t('لا يدعم هذا الحقل هذا النوع من التصفية.'))
      return
    }
    setOpen(false)
    onApply(normalizeFilter(next))
  }
  const empty = draft?.op === 'empty' ? draft.empty : null
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setDraft(filter ?? null)
          setError('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('تصفية {field}', { field: name })}
          className={`h-9 gap-2 text-xs font-normal ${filter ? 'border-primary/60' : ''}`}
        >
          {name}
          {count > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 tabular-nums">
              {count}
            </Badge>
          )}
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="border-b px-3 py-2 text-xs font-medium">
          {t('تصفية {field}', { field: name })}
        </div>
        <div className="p-3">
          {mode === 'boolean' ? (
            <div role="group" aria-label={name} className="flex gap-2">
              {(['true', 'false'] as const).map((value) => {
                const on = draft?.op === 'eq' && draft.value === value
                return (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    aria-pressed={on}
                    className="flex-1"
                    onClick={() => setDraft(on ? null : { op: 'eq', value })}
                  >
                    {value === 'true' ? t('نعم') : t('لا')}
                  </Button>
                )
              })}
            </div>
          ) : mode === 'range' ? (
            <RangeInputs
              field={field}
              filter={draft?.op === 'range' ? draft : undefined}
              onChange={(next) => setDraft(next)}
              onError={setError}
            />
          ) : mode === 'choice' && LISTED.has(field.type) ? (
            <ChoiceList
              resource={resource}
              field={field}
              values={chosenValues(draft ?? undefined)}
              options={
                field.type === 'enum' || field.type === 'multiSelect'
                  ? fieldOptions(field, locale)
                  : options
              }
              related={related}
              labels={labels}
              onRemember={onRemember}
              onChange={(values) => setDraft(choiceFilter(field.type, values))}
            />
          ) : mode === 'choice' ? (
            <TextValues
              name={name}
              values={chosenValues(draft ?? undefined)}
              onChange={(values) => setDraft({ op: 'in', values })}
            />
          ) : (
            <Input
              aria-label={t('قيمة {field}', { field: name })}
              className="h-9 text-xs"
              value={draft?.op === 'eq' ? draft.value : ''}
              onChange={(event) => setDraft({ op: 'eq', value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  apply(draft)
                }
              }}
            />
          )}
          <div
            role="group"
            aria-label={t('القيم الفارغة')}
            className="mt-3 flex gap-2 border-t pt-3"
          >
            {[true, false].map((value) => (
              <Button
                key={String(value)}
                type="button"
                size="sm"
                variant={empty === value ? 'secondary' : 'ghost'}
                aria-pressed={empty === value}
                className="h-7 flex-1 text-xs"
                onClick={() => setDraft(empty === value ? null : { op: 'empty', empty: value })}
              >
                {value ? t('فارغ') : t('غير فارغ')}
              </Button>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-between gap-2 border-t px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => apply(null)}>
            {t('إزالة التصفية')}
          </Button>
          <Button type="button" size="sm" onClick={() => apply(draft)}>
            {t('تطبيق')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Choice fields whose values come from a list: lookups, options or related records. */
const LISTED = new Set(['lookup', 'enum', 'multiSelect', 'belongsTo', 'user', 'manyToMany'])
/** Related records searched through the target resource's list route. */
const REMOTE = new Set(['belongsTo', 'user', 'manyToMany'])

/**
 * Inclusive bounds; dates use the field's own control, so the calendar preference applies.
 * Numbers accept Arabic-Indic digits and the Arabic decimal separator (parseValue).
 */
function RangeInputs({
  field,
  filter,
  onChange,
  onError,
}: {
  field: ResourceField
  filter?: FieldFilter & { op: 'range' }
  onChange: (filter: FieldFilter | null) => void
  onError: (message: string) => void
}) {
  const { t, label } = useMessages()
  const [text, setText] = useState({
    gte: filter?.gte ? inputValue(field, filter.gte) : '',
    lte: filter?.lte ? inputValue(field, filter.lte) : '',
  })
  const bound = (raw: string, side: 'gte' | 'lte') => {
    const parsed = parseValue(field, field.type === 'datetime' ? inclusiveDatetime(raw, side) : raw)
    return parsed === null || parsed === undefined ? undefined : String(parsed)
  }
  const change = (side: 'gte' | 'lte', raw: string) => {
    const next = { ...text, [side]: raw }
    setText(next)
    try {
      onError('')
      onChange({ op: 'range', gte: bound(next.gte, 'gte'), lte: bound(next.lte, 'lte') })
    } catch (error) {
      // Keep partial input; the previous valid bounds stay in the draft.
      onError(error instanceof Error ? t(error.message) : t('قيمة غير صالحة'))
    }
  }
  const name = label(field.label)
  const dated = field.type === 'date' || field.type === 'datetime'
  return (
    <div className="grid gap-3">
      {(['gte', 'lte'] as const).map((side) => {
        const caption = side === 'gte' ? t('من') : t('إلى')
        const id = `filter-${field.key}-${side}`
        return (
          <label key={side} htmlFor={id} className="grid gap-1 text-xs text-muted-foreground">
            {caption}
            {dated ? (
              <FieldControl
                field={field}
                id={id}
                value={text[side]}
                label={t('{bound} · {field}', { bound: caption, field: name })}
                onChange={(raw) => change(side, raw)}
              />
            ) : (
              <Input
                id={id}
                dir="ltr"
                inputMode={field.type === 'integer' ? 'numeric' : 'decimal'}
                className="h-9 text-xs tabular-nums"
                value={text[side]}
                onChange={(event) => change(side, event.target.value)}
              />
            )}
          </label>
        )
      })}
    </div>
  )
}

/**
 * «أيٌّ من»: lookup or field options, or related records searched through the server. A
 * multiSelect or manyToMany filter is «يحتوي على» one option or record.
 */
function ChoiceList({
  resource,
  field,
  values,
  options,
  related = [],
  labels = {},
  onRemember,
  onChange,
}: {
  resource: string
  field: ResourceField
  values: string[]
  options?: Option[]
  related?: SerializedRecord[]
  labels?: Record<string, string>
  onRemember?: (choices: Option[]) => void
  onChange: (values: string[]) => void
}) {
  const { t, label } = useMessages()
  const remote = REMOTE.has(field.type)
  const single = singleChoice(field.type)
  const [term, setTerm] = useState('')
  const [found, setFound] = useState<Option[] | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const listId = useId()
  const load = async (search: string) => {
    setBusy(true)
    try {
      let choices: Option[]
      if (field.type === 'user') {
        const users = await axios.get<{ data: Option[] }>(
          `/resources/${resource}/options/${field.key}`,
          {
            params: { purpose: 'filter', ...(search ? { search } : {}) },
            headers: { Accept: 'application/json' },
          }
        )
        choices = users.data.data
      } else {
        const target = (field as ResourceField & { resource?: string }).resource
        const response = await axios.get<ResourceList>(`/resources/${target}`, {
          params: {
            limit: 50,
            estimate: 'false',
            ...(search ? { search } : {}),
          },
          headers: { Accept: 'application/json' },
        })
        choices = response.data.data.map((row) => ({
          value: String(row.id),
          label: relationLabel(row, row.id),
        }))
      }
      setFound(choices)
      onRemember?.(choices)
    } catch {
      setFound([])
    } finally {
      setBusy(false)
    }
  }
  // The list mounts when the popover opens; related records load once per opening.
  const first = useRef(load)
  useEffect(() => {
    if (remote) void first.current('')
  }, [remote])
  const known = new Map<string, string>()
  for (const row of related) known.set(String(row.id), relationLabel(row, row.id))
  for (const [value, text] of Object.entries(labels)) known.set(value, text)
  const base = remote ? (found ?? []) : (options ?? [])
  // Chosen values stay listed even when the current search does not return them.
  const listed = [
    ...values
      .filter((value) => !base.some((option) => option.value === value))
      .map((value) => ({ value, label: known.get(value) ?? `#${value}` })),
    ...base.filter((option) => String(option.value) !== ''),
  ]
  const toggle = (value: string) =>
    onChange(
      values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
    )
  return (
    <div className="grid gap-2">
      <span className="text-xs text-muted-foreground">
        {single ? t('يحتوي على') : t('أيٌّ من')}
      </span>
      <Command shouldFilter={!remote} className="rounded-md border">
        <CommandInput
          placeholder={remote ? t('ابحث في السجلات المرتبطة') : t('ابحث في الخيارات')}
          aria-label={t('البحث في {field}', { field: label(field.label) })}
          value={term}
          onValueChange={(next) => {
            setTerm(next)
            if (!remote) return
            clearTimeout(timer.current)
            timer.current = setTimeout(() => void load(next), 300)
          }}
        />
        <CommandList id={listId} className="max-h-56">
          <CommandEmpty>{busy ? t('جارٍ البحث...') : t('لا توجد خيارات مطابقة')}</CommandEmpty>
          <CommandGroup>
            {listed.map((option) => {
              const on = values.includes(option.value)
              return (
                <CommandItem
                  key={option.value}
                  value={remote ? option.value : `${option.label} ${option.value}`}
                  aria-checked={on}
                  onSelect={() => toggle(option.value)}
                >
                  <Checkbox
                    checked={on}
                    tabIndex={-1}
                    aria-hidden
                    className="pointer-events-none"
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}

/** «أيٌّ من» for free text: Enter adds a value; each value is removable. */
function TextValues({
  name,
  values,
  onChange,
}: {
  name: string
  values: string[]
  onChange: (values: string[]) => void
}) {
  const { t } = useMessages()
  const [text, setText] = useState('')
  const add = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const value = text.trim()
    if (value && !values.includes(value)) onChange([...values, value])
    setText('')
  }
  return (
    <div className="grid gap-2">
      <span className="text-xs text-muted-foreground">{t('أيٌّ من')}</span>
      <Input
        aria-label={t('قيمة {field}', { field: name })}
        className="h-9 text-xs"
        value={text}
        placeholder={t('اكتب قيمة ثم اضغط Enter')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={add}
      />
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {values.map((value) => (
            <li key={value}>
              <Badge variant="secondary" className="gap-1 font-normal">
                {value}
                <button
                  type="button"
                  aria-label={t('إزالة {value}', { value })}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onChange(values.filter((entry) => entry !== value))}
                >
                  <X size={12} />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
