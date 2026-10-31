import { useState, type FormEvent } from 'react'
import { router } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import axios from 'axios'
import { toast } from 'sonner'
import { RefreshCw, Save } from 'lucide-react'
import type { RecordPermissions, ResourceEditor, ResourceField as Field } from 'adula'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { ResourceActions, failureMessage, isConflict } from '~/components/ui/resource-actions'
import {
  InlineRows,
  ResourceField,
  ResourceSelect,
  type InlineRow,
} from '~/components/ui/resource-field'
import { Label } from '~/components/ui/label'
import { useMessages } from '~/components/ui/messages'
import { inputValue, isAttachment, parseValue } from '~/components/ui/resource-value'
import { hiddenFields, listInput } from '~/components/ui/field_values'

type Failure = { message: string; conflict: boolean }
type RowErrors = Record<string, Record<string, Record<string, string>>>
type ServerError = { field?: string; message: string }

function initialValue(field: Field, value: unknown) {
  if (field.type === 'boolean' && (value === null || value === undefined)) return 'false'
  return inputValue(field, value)
}

export function ResourceForm({
  editor,
  permissions = {},
  onSaved,
  onCancel,
  onAction,
}: {
  editor: ResourceEditor
  permissions?: RecordPermissions
  /** Called with the saved record id instead of visiting its page (record dialogs). */
  onSaved?: (id: number) => void
  /** Replaces the cancel link (record dialogs return to the details). */
  onCancel?: () => void
  /** Called after a record action (submit, delete...) instead of visiting a page. */
  onAction?: (action: string) => void
}) {
  const { t, label } = useMessages()
  const base = `/resources/${editor.name}`
  const scalar = editor.fields.filter((field) => field.type !== 'hasMany')
  const inlineFields = editor.fields.filter(
    (field) => field.type === 'hasMany' && field.inline && editor.inline[field.key]
  )
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      scalar.map((field) => [
        field.key,
        initialValue(field, editor.record?.[field.key] ?? editor.defaults?.[field.key]),
      ])
    )
  )
  const [rows, setRows] = useState<Record<string, InlineRow[]>>(() =>
    Object.fromEntries(
      inlineFields.map((field) => {
        const definition = editor.inline[field.key]
        return [
          field.key,
          definition.rows.map((row) => ({
            key: `row-${row.id}`,
            id: Number(row.id),
            version:
              row.version === undefined || row.version === null ? undefined : Number(row.version),
            values: Object.fromEntries(
              definition.fields.map((child) => [child.key, initialValue(child, row[child.key])])
            ),
          })),
        ]
      })
    )
  )
  const [unit, setUnit] = useState(
    String(editor.record?.orgUnitId ?? editor.orgUnits[0]?.value ?? '')
  )
  const [failure, setFailure] = useState<Failure | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [rowErrors, setRowErrors] = useState<RowErrors>({})
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const multiValued = new Set(
    editor.fields
      .filter((field) => field.type === 'multiSelect' || field.type === 'manyToMany')
      .map((field) => field.key)
  )
  // visibleWhen reads the live form values; siblings outside the form keep their stored
  // value. A field whose sibling is hidden is evaluated with that sibling empty.
  const current = { ...values }
  for (const field of scalar)
    for (const key of Object.keys(field.visibleWhen ?? {}))
      if (!(key in current)) {
        const stored = editor.record?.[key] ?? editor.defaults?.[key]
        current[key] = Array.isArray(stored)
          ? listInput(stored)
          : stored === null || stored === undefined
            ? ''
            : String(stored)
      }
  const hidden = hiddenFields(scalar, current)
  const applies = (field: Field) => !hidden.has(field.key)

  const inlinePayload = (field: Field, collected: RowErrors) => {
    const definition = editor.inline[field.key]
    const list = rows[field.key] ?? []
    const changed = list.filter((row) =>
      row.id === undefined ? !row.deleted : Boolean(row.dirty || row.deleted)
    )
    const payload = changed.map((row) => {
      if (row.deleted) return { id: row.id, version: row.version, _delete: true }
      const allowed =
        row.id === undefined
          ? definition.createFields
          : (definition.updateFields[String(row.id)] ?? [])
      const entry: Record<string, unknown> =
        row.id === undefined ? {} : { id: row.id, version: row.version }
      // A child field whose visibleWhen does not hold in its row is hidden and not submitted.
      const rowHidden = hiddenFields(definition.fields, row.values)
      for (const child of definition.fields) {
        if (!allowed.includes(child.key) || rowHidden.has(child.key)) continue
        const raw = row.values[child.key] ?? ''
        if (raw === '' && !child.required && row.id === undefined) continue
        try {
          const parsed = parseValue(child, raw)
          if (parsed === null && child.required) throw new Error('هذا الحقل مطلوب')
          entry[child.key] = parsed
        } catch (error) {
          collected[field.key] ??= {}
          collected[field.key][row.key] ??= {}
          collected[field.key][row.key][child.key] = t((error as Error).message)
        }
      }
      return entry
    })
    return changed.length ? payload : undefined
  }

  const mapServerErrors = (entries: ServerError[]) => {
    const fieldErrors: Record<string, string> = {}
    const sections: Record<string, string> = {}
    const unknown: string[] = []
    for (const entry of entries) {
      const key = entry.field ?? ''
      if (scalar.some((field) => field.key === key)) {
        fieldErrors[key] = entry.message
        continue
      }
      const section = inlineFields.find((field) =>
        editor.inline[field.key].fields.some(
          (child) => child.key === key || key.endsWith(`.${child.key}`)
        )
      )
      if (section) {
        const child = editor.inline[section.key].fields.find(
          (candidate) => candidate.key === key || key.endsWith(`.${candidate.key}`)
        )
        // Nested validators report the child field only, never which row; surface it on the section.
        sections[section.key] = `${child ? label(child.label) : key}: ${entry.message}`
        continue
      }
      unknown.push(key ? `${key}: ${entry.message}` : entry.message)
    }
    setErrors(fieldErrors)
    setSectionErrors(sections)
    return unknown
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    setErrors({})
    setRowErrors({})
    setSectionErrors({})
    const payload: Record<string, unknown> = {}
    const fieldErrors: Record<string, string> = {}
    const collected: RowErrors = {}
    for (const field of editor.fields) {
      if (field.type === 'hasMany') {
        if (!editor.inline[field.key]) continue
        const inline = inlinePayload(field, collected)
        if (inline) payload[field.key] = inline
        continue
      }
      // A field whose visibleWhen does not hold is hidden and not submitted; the server
      // stores null for it whatever was typed before it was hidden.
      if (!applies(field)) continue
      const raw = values[field.key] ?? ''
      const multiple = multiValued.has(field.key)
      // Updates submit the whole form: the resource validator checks the submitted
      // document, and `version` — not a partial payload — protects concurrent edits.
      // A cleared multi-value field is still submitted so its declared default is not applied.
      if (editor.mode === 'create' && raw === '' && !field.required && !multiple) continue
      try {
        const parsed = parseValue(field, raw)
        const empty = parsed === null || (Array.isArray(parsed) && parsed.length === 0)
        if (empty && field.required) throw new Error('هذا الحقل مطلوب')
        payload[field.key] = parsed
      } catch (error) {
        fieldErrors[field.key] = t((error as Error).message)
      }
    }
    if (Object.keys(fieldErrors).length || Object.keys(collected).length) {
      setErrors(fieldErrors)
      setRowErrors(collected)
      setFailure({ message: t('راجع الحقول المحددة ثم أعد المحاولة.'), conflict: false })
      return
    }
    if (editor.scoped && !editor.scopeFrom) payload.orgUnitId = Number(unit)
    if (editor.record?.version !== undefined && editor.record.version !== null)
      payload.version = editor.record.version
    setBusy(true)
    try {
      const response = await axios.request<{ data: { id: number } }>({
        method: editor.mode === 'create' ? 'post' : 'patch',
        url: base + (editor.record ? `/${editor.record.id}` : ''),
        data: payload,
        headers: { Accept: 'application/json' },
        withXSRFToken: true,
      })
      toast.success(
        editor.mode === 'create'
          ? editor.recordLabel
            ? t('تمت إضافة {record}', { record: editor.recordLabel })
            : t('تمت إضافة السجل')
          : t('تم حفظ التعديلات')
      )
      if (onSaved) onSaved(response.data.data.id)
      // The details replace the form in the same dialog instead of closing and reopening.
      else router.visit(`${base}/${response.data.data.id}`, { preserveState: true })
    } catch (error) {
      const unknown =
        axios.isAxiosError(error) && Array.isArray(error.response?.data?.errors)
          ? mapServerErrors(error.response.data.errors as ServerError[])
          : []
      const conflict = isConflict(error)
      setFailure({
        conflict,
        message: conflict
          ? t('تغير السجل منذ فتحه. احتفظ بتعديلاتك ثم أعد تحميل الصفحة.')
          : unknown.length
            ? unknown.join(' · ')
            : failureMessage(error, t('تعذر الحفظ. راجع البيانات وحاول مجدداً.'), t),
      })
    } finally {
      setBusy(false)
    }
  }

  // The required mark sits inside the sentence: «… المعلّمة بـ * مطلوبة».
  const requiredHint = t('الحقول المتاحة بحسب صلاحياتك · الحقول المعلّمة بـ {mark} مطلوبة').split(
    '{mark}'
  )

  return (
    <form onSubmit={submit} noValidate className="max-w-4xl space-y-6" aria-busy={busy}>
      {failure && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{failure.conflict ? t('تعارض في الإصدار') : t('تعذر الحفظ')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {failure.message}
            {failure.conflict && (
              <Button type="button" variant="outline" size="sm" onClick={() => router.reload()}>
                <RefreshCw size={14} />
                {t('إعادة التحميل')}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <section className="rounded-xl border bg-white">
        <div className="border-b px-7 py-5">
          <h2 className="text-sm font-semibold">{t('تفاصيل السجل')}</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {requiredHint[0]}
            <span className="text-destructive">*</span>
            {requiredHint[1]}
          </p>
        </div>
        <div className="grid gap-6 p-7 md:grid-cols-2">
          {editor.scoped && !editor.scopeFrom && (
            <div className="min-w-0 space-y-2">
              <Label htmlFor="orgUnitId" className="flex items-center gap-2 text-sm font-medium">
                {t('الوحدة التنظيمية')}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </Label>
              <ResourceSelect
                id="orgUnitId"
                required
                value={unit}
                disabled={busy}
                onChange={setUnit}
                options={editor.orgUnits}
              />
            </div>
          )}
          {scalar.filter(applies).map((field) => {
            const stored = editor.record?.[field.key]
            return (
              <ResourceField
                // User choices depend on the unit: a new unit reloads them.
                key={field.type === 'user' ? `${field.key}:${unit}` : field.key}
                field={field}
                id={field.key}
                value={values[field.key] ?? ''}
                options={editor.options[field.key]}
                error={errors[field.key]}
                disabled={busy}
                resource={editor.name}
                attachment={field.type === 'attachment' && isAttachment(stored) ? stored : null}
                attachments={
                  field.type === 'attachment' && Array.isArray(stored)
                    ? stored.filter(isAttachment)
                    : undefined
                }
                onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
                relation={
                  field.type === 'belongsTo' || field.type === 'manyToMany'
                    ? {
                        url: `${base}/options/${field.key}${editor.record ? `?id=${editor.record.id}` : ''}`,
                        searchable: editor.relationSearch[field.key] ?? false,
                      }
                    : field.type === 'user'
                      ? {
                          url: `${base}/options/${field.key}?${new URLSearchParams({
                            ...(editor.record ? { id: String(editor.record.id) } : {}),
                            // An inherited unit is resolved on the server from the record.
                            ...(editor.scoped && !editor.scopeFrom && unit
                              ? { orgUnitId: unit }
                              : {}),
                          })}`,
                          searchable: true,
                        }
                      : undefined
                }
              />
            )
          })}
        </div>
      </section>
      {inlineFields.map((field) => (
        <InlineRows
          key={field.key}
          field={field}
          inline={editor.inline[field.key]}
          rows={rows[field.key] ?? []}
          errors={rowErrors[field.key]}
          sectionError={sectionErrors[field.key]}
          disabled={busy}
          resource={editor.name}
          onChange={(next) => setRows((current) => ({ ...current, [field.key]: next }))}
        />
      ))}
      {editor.record?.version !== undefined && editor.record.version !== null && (
        <input type="hidden" name="version" value={String(editor.record.version)} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {editor.record && (
            <ResourceActions
              resource={editor.name}
              id={editor.record.id as number}
              version={editor.record.version ?? undefined}
              permissions={permissions}
              onDone={(action) =>
                onAction
                  ? onAction(action)
                  : router.visit(action === 'delete' ? base : `${base}/${editor.record?.id}`)
              }
            />
          )}
        </div>
        <div className="flex gap-3">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('إلغاء')}
            </Button>
          ) : (
            <Button type="button" variant="outline" asChild>
              <Link href={editor.record ? `${base}/${editor.record.id}` : base}>{t('إلغاء')}</Link>
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            <Save size={16} />
            {busy ? t('جارٍ الحفظ...') : t('حفظ السجل')}
          </Button>
        </div>
      </div>
    </form>
  )
}
