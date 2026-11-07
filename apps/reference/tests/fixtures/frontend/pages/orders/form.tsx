import { Head, router } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { useId, useState, type ReactElement } from 'react'
import axios from 'axios'
import { Check, FileText, Paperclip, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { Label } from '~/components/ui/label'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { RecordFooter, ResourceSurface } from '~/components/ui/resource-surface'
import { ResourceSelect } from '~/components/ui/resource-field'
import Workspace from '~/layouts/workspace'
import type { ResourceEditor } from 'adula'
type Line = {
  id?: number
  version?: number
  description: string
  quantity: string
  dirty?: boolean
  _delete?: boolean
}
type Uploaded = { id: number; name: string; size: number; mimeType: string; url: string }
const bytes = (size: number) =>
  size >= 1_000_000
    ? `${(size / 1_000_000).toFixed(1)} MB`
    : size >= 1_000
      ? `${Math.round(size / 1_000)} KB`
      : `${size} B`

export default function OrderForm({ editor }: { editor: ResourceEditor }) {
  const attachmentKeys = editor.fields
    .filter((field) => field.type === 'attachment')
    .map((field) => field.key)
  const [attachments, setAttachments] = useState<Record<string, Uploaded | null>>(() =>
    Object.fromEntries(
      attachmentKeys.map((key) => [key, (editor.record?.[key] as Uploaded | null) ?? null])
    )
  )
  const [uploading, setUploading] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(editor.record ?? {})
        .filter(([key]) => !attachmentKeys.includes(key))
        .map(([key, value]) => {
          if (key === 'total' && value !== null) {
            const amount = BigInt(String(value))
            const abs = amount < 0n ? -amount : amount
            return [
              key,
              `${amount < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`,
            ]
          }
          return [key, value === null ? '' : String(value)]
        })
    )
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const formId = useId()
  const [lines, setLines] = useState<Line[]>(() =>
    (editor.inline.lines?.rows ?? []).map((row) => ({
      id: Number(row.id),
      version: row.version === undefined ? undefined : Number(row.version),
      description: String(row.description ?? ''),
      quantity: String(row.quantity ?? ''),
    }))
  )
  const update = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }))
  // Files are stored as soon as they are chosen; the form only submits the returned id.
  const upload = async (key: string, file: File | undefined) => {
    if (!file) return
    setUploading(key)
    setErrors((current) => ({ ...current, [key]: '' }))
    const form = new FormData()
    form.append('resource', 'orders')
    form.append('field', key)
    form.append('file', file)
    try {
      const response = await axios.post('/attachments', form, {
        headers: { Accept: 'application/json' },
        withXSRFToken: true,
      })
      setAttachments((current) => ({ ...current, [key]: response.data.data as Uploaded }))
      toast.success('تم رفع الملف')
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [key]: axios.isAxiosError(error)
          ? error.response?.data?.error?.message || 'تعذر رفع الملف. حاول مجدداً.'
          : 'تعذر الاتصال بالخادم. حاول مجدداً.',
      }))
    } finally {
      setUploading(null)
    }
  }
  const title = editor.mode === 'create' ? 'طلب جديد' : `تعديل ${editor.record?.number}`
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFailure('')
    setErrors({})
    const payload: Record<string, unknown> = {}
    for (const field of editor.fields) {
      if (field.type === 'attachment') {
        payload[field.key] = attachments[field.key]?.id ?? null
        continue
      }
      if (field.type === 'hasMany') {
        const changed = lines.filter((line) => line.id === undefined || line.dirty || line._delete)
        if (changed.length)
          payload[field.key] = changed.map((line) => ({
            ...(line.id !== undefined ? { id: line.id, version: line.version } : {}),
            ...(line._delete
              ? { _delete: true }
              : { description: line.description, quantity: Number(line.quantity) }),
          }))
        continue
      }
      if (field.type === 'money' && values[field.key]) {
        const value = values[field.key]
          .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
          .replace('٫', '.')
        if (!/^-?\d+(\.\d{1,2})?$/.test(value)) {
          setErrors({ [field.key]: 'أدخل مبلغاً صحيحاً بخانتين عشريتين كحد أقصى' })
          setBusy(false)
          return
        }
        const [whole, cents = ''] = value.replace('-', '').split('.')
        payload[field.key] = String(
          (BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0'))) * (value.startsWith('-') ? -1n : 1n)
        )
      } else if (field.key in values)
        payload[field.key] =
          values[field.key] === ''
            ? null
            : field.type === 'belongsTo' || field.type === 'integer'
              ? Number(values[field.key])
              : values[field.key]
    }
    if (editor.scoped) payload.orgUnitId = Number(values.orgUnitId || editor.orgUnits[0]?.value)
    if (editor.record?.version !== undefined) payload.version = editor.record.version
    try {
      await axios.request({
        method: editor.mode === 'create' ? 'post' : 'patch',
        url: `/resources/orders${editor.record ? `/${editor.record.id}` : ''}`,
        data: payload,
        headers: { Accept: 'application/json' },
        withXSRFToken: true,
      })
      toast.success('تم حفظ الطلب')
      router.visit('/resources/orders')
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const response = error.response?.data
        if (Array.isArray(response?.errors))
          setErrors(
            Object.fromEntries(
              response.errors.map((entry: { field: string; message: string }) => [
                entry.field,
                entry.message,
              ])
            )
          )
        setFailure(response?.error?.message || 'تعذر حفظ الطلب. راجع البيانات وحاول مجدداً.')
      } else setFailure('تعذر الاتصال بالخادم. حاول مجدداً.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Head title={title} />
      <ResourceSurface
        title={title}
        description="أكمل التفاصيل الأساسية، ثم احفظ الطلب كمسودة."
        backHref="/resources/orders"
      >
        <form
          id={formId}
          onSubmit={submit}
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_270px]"
        >
          <div className="space-y-6">
            {failure && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
            <section className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-7 py-5">
                <h2 className="text-sm font-semibold">تفاصيل الطلب</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  المعلومات التي تحتاجها للمتابعة اليومية
                </p>
              </div>
              <div className="grid gap-x-6 gap-y-6 p-7 md:grid-cols-2">
                {editor.scoped && (
                  <div className="space-y-2">
                    <Label htmlFor="orgUnitId">
                      الوحدة التنظيمية<span className="text-destructive">*</span>
                    </Label>
                    <ResourceSelect
                      id="orgUnitId"
                      value={String(values.orgUnitId || editor.orgUnits[0]?.value || '')}
                      onChange={(value) => update('orgUnitId', value)}
                      required
                      options={editor.orgUnits}
                    />
                  </div>
                )}
                {editor.fields
                  .filter((field) => field.type !== 'hasMany')
                  .map((field) => (
                    <div
                      key={field.key}
                      className={`space-y-2 ${field.type === 'text' ? 'md:col-span-2' : ''}`}
                    >
                      <Label htmlFor={field.key}>
                        {field.label.ar}
                        {field.required && <span className="text-destructive">*</span>}
                      </Label>
                      {editor.options[field.key] ? (
                        <ResourceSelect
                          id={field.key}
                          value={values[field.key] || ''}
                          required={field.required}
                          onChange={(value) => update(field.key, value)}
                          placeholder={`اختر ${field.label.ar}`}
                          options={editor.options[field.key]}
                        />
                      ) : field.type === 'text' ? (
                        <Textarea
                          id={field.key}
                          rows={3}
                          value={values[field.key] || ''}
                          onChange={(event) => update(field.key, event.target.value)}
                        />
                      ) : field.type === 'attachment' ? (
                        <div className="space-y-2">
                          {attachments[field.key] && (
                            <div className="flex flex-wrap items-center gap-3 rounded-md border border-input bg-background/60 px-3 py-2 text-sm">
                              <Paperclip size={15} className="shrink-0 text-muted-foreground" />
                              <a
                                href={attachments[field.key]!.url}
                                className="font-medium text-primary underline-offset-4 hover:underline"
                              >
                                {attachments[field.key]!.name}
                              </a>
                              <span className="text-xs text-muted-foreground" dir="ltr">
                                {bytes(attachments[field.key]!.size)}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="ms-auto"
                                onClick={() =>
                                  setAttachments((current) => ({ ...current, [field.key]: null }))
                                }
                                aria-label={`إزالة ${field.label.ar}`}
                              >
                                إزالة
                              </Button>
                            </div>
                          )}
                          <Input
                            id={field.key}
                            type="file"
                            disabled={uploading === field.key}
                            onChange={(event) => {
                              void upload(field.key, event.target.files?.[0])
                              event.target.value = ''
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            {uploading === field.key
                              ? 'جارٍ رفع الملف...'
                              : attachments[field.key]
                                ? 'اختر ملفاً آخر لاستبدال الملف الحالي.'
                                : 'يُرفع الملف فور اختياره، ويُربط بالطلب عند الحفظ.'}
                          </p>
                        </div>
                      ) : (
                        <Input
                          id={field.key}
                          type={
                            field.type === 'date'
                              ? 'date'
                              : field.type === 'integer'
                                ? 'number'
                                : 'text'
                          }
                          dir={field.type === 'money' || field.type === 'date' ? 'ltr' : undefined}
                          inputMode={field.type === 'money' ? 'decimal' : undefined}
                          value={values[field.key] || ''}
                          required={field.required}
                          onChange={(event) => update(field.key, event.target.value)}
                        />
                      )}
                      {errors[field.key] && (
                        <p className="text-xs text-destructive" role="alert">
                          {errors[field.key]}
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            </section>
            {editor.inline.lines && (
              <section className="rounded-xl border border-border bg-card p-7">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">بنود الطلب</h2>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!editor.inline.lines.canCreate || lines.length >= 100}
                    onClick={() =>
                      setLines((current) => [...current, { description: '', quantity: '1' }])
                    }
                  >
                    إضافة بند
                  </Button>
                </div>
                {!lines.length && (
                  <p className="text-xs text-muted-foreground">
                    أضف البنود المطلوبة، أو احتفظ بالطلب دون بنود.
                  </p>
                )}
                {editor.inline.lines.hasMore && (
                  <p className="mb-4 text-xs text-muted-foreground">
                    تظهر أول 100 بند. البنود الأخرى محفوظة دون تغيير.
                  </p>
                )}
                {lines.map((line, index) =>
                  line._delete ? (
                    <p key={index} className="mb-3 text-xs text-muted-foreground">
                      سيُحذف البند «{line.description}» عند الحفظ.
                    </p>
                  ) : (
                    <div className="mb-3 flex gap-3" key={index}>
                      <Input
                        aria-label={`وصف البند ${index + 1}`}
                        placeholder="وصف البند"
                        value={line.description}
                        disabled={
                          line.id !== undefined &&
                          !editor.inline.lines.permissions[String(line.id)]?.update
                        }
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((entry, at) =>
                              at === index
                                ? { ...entry, description: event.target.value, dirty: true }
                                : entry
                            )
                          )
                        }
                        required
                      />
                      <Input
                        aria-label={`كمية البند ${index + 1}`}
                        className="w-24"
                        type="number"
                        min={1}
                        value={line.quantity}
                        disabled={
                          line.id !== undefined &&
                          !editor.inline.lines.permissions[String(line.id)]?.update
                        }
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((entry, at) =>
                              at === index
                                ? { ...entry, quantity: event.target.value, dirty: true }
                                : entry
                            )
                          )
                        }
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={
                          line.id !== undefined &&
                          !editor.inline.lines.permissions[String(line.id)]?.delete
                        }
                        onClick={() =>
                          setLines((current) =>
                            line.id === undefined
                              ? current.filter((_, at) => at !== index)
                              : current.map((entry, at) =>
                                  at === index ? { ...entry, _delete: true } : entry
                                )
                          )
                        }
                        aria-label={`حذف البند ${index + 1}`}
                      >
                        حذف
                      </Button>
                    </div>
                  )
                )}
              </section>
            )}
            {/* The record dialog's fixed footer; the save button names the form it submits. */}
            <RecordFooter>
              <Button type="button" variant="outline" className="ms-auto" asChild>
                <Link href="/resources/orders">إلغاء</Link>
              </Button>
              <Button type="submit" form={formId} disabled={busy}>
                <Save size={16} />
                {busy ? 'جارٍ الحفظ...' : 'حفظ الطلب'}
              </Button>
            </RecordFooter>
          </div>
          <aside className="rounded-xl border border-border bg-card p-6">
            <FileText className="mb-4 text-primary" size={26} strokeWidth={1.4} />
            <h2 className="text-sm font-semibold">قبل الحفظ</h2>
            <p className="mt-3 text-xs leading-7 text-muted-foreground">
              سيبقى الطلب في حالة المسودة، ويمكنك مراجعة تفاصيله وتعديلها.
            </p>
            <div className="mt-6 flex items-start gap-2 border-t border-border pt-5 text-xs leading-6 text-muted-foreground">
              <Check size={16} className="mt-1 shrink-0 text-primary" />
              تحدد الوحدة التنظيمية من يمكنه الوصول إلى هذا الطلب.
            </div>
          </aside>
        </form>
      </ResourceSurface>
    </>
  )
}
OrderForm.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
