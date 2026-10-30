import { useState, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import axios from 'axios'
import { AlertCircle, Eye, History, Pencil, Plus } from 'lucide-react'
import type { PrintTemplateDetail, PrintTemplateSummary, PrintTemplateVersion } from 'adula'
import Workspace from '~/layouts/workspace'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import { ResourceSelect } from '~/components/ui/resource-field'
import { Alert, AlertDescription } from '~/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

type Column = { key: string; label: string; type: string }
type ResourceNames = {
  name: string
  label: string
  fields: Column[]
  lines: { key: string; label: string; columns: Column[] }[]
}
type Props = {
  templates: PrintTemplateSummary[]
  resources: ResourceNames[]
  helpers: string[]
  timeZone: string
}
const chip = 'mx-1 inline-block whitespace-nowrap rounded bg-muted px-1'

/** Version times in the application time zone, as printed footers show them. */
function versionTime(value: string, timeZone: string) {
  return new Date(value).toLocaleString('ar-u-nu-latn-ca-gregory', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  })
}
type Draft = {
  resource: string
  key: string
  label: string
  body: string
  paper: string
  orientation: string
  header: string
  footer: string
  active: boolean
  /** The version an edit started from; the server refuses the save if it moved on. */
  expectedVersion?: number
}

const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }
const paperOptions = [
  { value: 'A4', label: 'A4' },
  { value: 'A5', label: 'A5' },
  { value: 'Letter', label: 'Letter' },
]
const orientationOptions = [
  { value: 'portrait', label: 'طولي' },
  { value: 'landscape', label: 'عرضي' },
]
const orientationLabel = (value: string) => (value === 'landscape' ? 'عرضي' : 'طولي')

function starter(resource: ResourceNames | undefined) {
  if (!resource) return ''
  const fields = resource.fields
    .slice(0, 4)
    .map((field) => `  <tr><th>{{label "${field.key}"}}</th><td>{{field.${field.key}}}</td></tr>`)
    .join('\n')
  const group = resource.lines[0]
  // The same columns head the table and fill each row.
  const columns = group?.columns.filter((column) => column.type !== 'belongsTo').slice(0, 3) ?? []
  const lines = group
    ? `
<h2>{{label "${group.key}"}}</h2>
<table class="lines">
  <thead><tr>${columns
        .map((column) => `<th>{{label "${group.key}.${column.key}"}}</th>`)
        .join('')}</tr></thead>
  <tbody>{{#each lines.${group.key}}}<tr>${columns
        .map((column) => `<td>{{row.${column.key}}}</td>`)
        .join('')}</tr>{{/each}}</tbody>
</table>`
    : ''
  return `<header class="doc">\n  <div><h1>{{template}}</h1><p>{{company}} · {{resource}} #{{id}}</p></div>\n  <div>{{logo}}</div>\n</header>\n<table class="fields">\n${fields}\n</table>${lines}`
}

function errorMessage(error: unknown) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response
    ?.data
  return data?.error?.message ?? 'تعذر إكمال الطلب. حاول مجددًا.'
}

export default function PrintTemplatesIndex({ templates, resources, helpers, timeZone }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewRecord, setPreviewRecord] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [history, setHistory] = useState<{
    template: PrintTemplateSummary
    versions: PrintTemplateVersion[] | null
  } | null>(null)
  // Kept apart from `history` so the content stays while the Dialog animates closed.
  const [historyOpen, setHistoryOpen] = useState(false)
  const names = resources.find((resource) => resource.name === draft?.resource)
  const update = (patch: Partial<Draft>) => setDraft((current) => current && { ...current, ...patch })
  const openCreate = () => {
    const resource = resources[0]
    setEditing(false)
    setError(null)
    setPreviewHtml(null)
    setPreviewRecord('')
    setDraft({
      resource: resource?.name ?? '',
      key: '',
      label: '',
      body: starter(resource),
      paper: 'A4',
      orientation: 'portrait',
      header: '',
      footer: '',
      active: true,
    })
  }
  const openEdit = async (template: PrintTemplateSummary) => {
    setError(null)
    setListError(null)
    setPreviewHtml(null)
    setPreviewRecord('')
    let detail: PrintTemplateDetail
    try {
      const response = await axios.get<{ data: PrintTemplateDetail }>(
        `/admin/print-templates/${template.resource}/${template.key}`,
        json
      )
      detail = response.data.data
    } catch (failure) {
      setListError(errorMessage(failure))
      return
    }
    setEditing(true)
    setDraft({
      resource: detail.resource,
      key: detail.key,
      label: detail.label,
      body: detail.body,
      paper: detail.paper,
      orientation: detail.orientation,
      header: detail.header,
      footer: detail.footer,
      active: detail.active,
      expectedVersion: Number(detail.version),
    })
  }
  const openHistory = async (template: PrintTemplateSummary) => {
    setListError(null)
    setHistory({ template, versions: null })
    setHistoryOpen(true)
    try {
      const response = await axios.get<{ data: PrintTemplateVersion[] }>(
        `/admin/print-templates/${template.resource}/${template.key}/versions`,
        json
      )
      setHistory({ template, versions: response.data.data })
    } catch (failure) {
      setHistoryOpen(false)
      setHistory(null)
      setListError(errorMessage(failure))
    }
  }
  const preview = async () => {
    if (!draft) return
    setPreviewing(true)
    setError(null)
    try {
      const response = await axios.post<{ data: { html: string; recordId: number } }>(
        '/admin/print-templates/preview',
        { ...draft, recordId: previewRecord || undefined },
        json
      )
      setPreviewHtml(response.data.data.html)
      setPreviewRecord(String(response.data.data.recordId))
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPreviewing(false)
    }
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      if (editing)
        await axios.put(`/admin/print-templates/${draft.resource}/${draft.key}`, draft, json)
      else await axios.post('/admin/print-templates', draft, json)
      setDraft(null)
      router.reload({ only: ['templates'] })
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <Head title="قوالب الطباعة" />
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">قوالب الطباعة</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            تخطيطات طباعة لكل كيان. كل حفظ ينشئ نسخة جديدة، ويُسجَّل رقم النسخة مع كل طباعة.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!resources.length}>
          <Plus size={15} />
          قالب جديد
        </Button>
      </div>
      {listError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle />
          <AlertDescription>{listError}</AlertDescription>
        </Alert>
      )}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                الكيان
              </th>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                القالب
              </th>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                الورق
              </th>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                النسخة
              </th>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                الحالة
              </th>
              <th scope="col" className="px-5 py-3">
                <span className="sr-only">إجراءات</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                  لا توجد قوالب طباعة بعد. تبقى الطباعة العامة متاحة لكل سجل.
                </td>
              </tr>
            )}
            {templates.map((template) => (
              <tr key={`${template.resource}.${template.key}`} className="border-b last:border-0">
                <td className="px-5 py-3">{template.resourceLabel}</td>
                <td className="px-5 py-3">
                  <p className="font-medium">{template.label}</p>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {template.key}
                  </p>
                </td>
                <td className="px-5 py-3">
                  {template.paper} · {orientationLabel(template.orientation)}
                </td>
                <td className="px-5 py-3 tabular-nums" dir="ltr">
                  {template.source === 'code' ? template.version : `v${template.version}`}
                </td>
                <td className="px-5 py-3">
                  {template.source === 'code' ? (
                    <Badge variant="secondary">معرّف في الكود</Badge>
                  ) : template.active ? (
                    <Badge>مفعّل</Badge>
                  ) : (
                    <Badge variant="outline">موقوف</Badge>
                  )}
                </td>
                <td className="px-5 py-3">
                  {template.source === 'custom' && (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`تعديل ${template.label}`}
                        onClick={() => void openEdit(template)}
                      >
                        <Pencil size={14} />
                        تعديل
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`سجل نسخ ${template.label}`}
                        onClick={() => void openHistory(template)}
                      >
                        <History size={14} />
                        النسخ
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={draft !== null} onOpenChange={(value) => !value && setDraft(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل قالب الطباعة' : 'قالب طباعة جديد'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'يُحفظ التعديل نسخةً جديدة وتبقى النسخ السابقة كما هي.'
                : 'اكتب تخطيط المستند بالوسوم المسموحة والمتغيرات بين {{ }}.'}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <form id="print-template-form" className="grid gap-6 lg:grid-cols-2" onSubmit={save}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="print-template-resource">الكيان</Label>
                    <ResourceSelect
                      id="print-template-resource"
                      aria-label="الكيان"
                      value={draft.resource}
                      disabled={editing}
                      options={resources.map((resource) => ({
                        value: resource.name,
                        label: resource.label,
                      }))}
                      onChange={(resource) =>
                        update({
                          resource,
                          body: starter(resources.find((entry) => entry.name === resource)),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="print-template-key">المفتاح</Label>
                    <Input
                      id="print-template-key"
                      dir="ltr"
                      value={draft.key}
                      disabled={editing}
                      maxLength={64}
                      placeholder="delivery_note"
                      onChange={(event) => update({ key: event.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="print-template-label">اسم القالب</Label>
                  <Input
                    id="print-template-label"
                    value={draft.label}
                    maxLength={200}
                    onChange={(event) => update({ label: event.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="print-template-paper">مقاس الورق</Label>
                    <ResourceSelect
                      id="print-template-paper"
                      aria-label="مقاس الورق"
                      value={draft.paper}
                      options={paperOptions}
                      onChange={(paper) => update({ paper })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="print-template-orientation">الاتجاه</Label>
                    <ResourceSelect
                      id="print-template-orientation"
                      aria-label="الاتجاه"
                      value={draft.orientation}
                      options={orientationOptions}
                      onChange={(orientation) => update({ orientation })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="print-template-header">الترويسة</Label>
                  <Input
                    id="print-template-header"
                    value={draft.header}
                    maxLength={500}
                    onChange={(event) => update({ header: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="print-template-body">متن القالب</Label>
                  <Textarea
                    id="print-template-body"
                    dir="auto"
                    rows={14}
                    className="text-sm leading-6"
                    value={draft.body}
                    onChange={(event) => update({ body: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="print-template-footer">التذييل</Label>
                  <Input
                    id="print-template-footer"
                    value={draft.footer}
                    maxLength={500}
                    onChange={(event) => update({ footer: event.target.value })}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="print-template-active"
                    checked={draft.active}
                    onCheckedChange={(active) => update({ active })}
                  />
                  <Label htmlFor="print-template-active">متاح للطباعة من صفحة السجل</Label>
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/40 p-4 text-xs leading-6">
                  <p className="mb-1 font-medium text-foreground">المتغيرات المتاحة</p>
                  <p className="text-muted-foreground">
                    الحقول:{' '}
                    {names?.fields.map((field) => (
                      <code key={field.key} dir="ltr" className={chip}>
                        {`{{field.${field.key}}}`}
                      </code>
                    ))}
                  </p>
                  {names?.lines.map((group) => (
                    <p key={group.key} className="text-muted-foreground">
                      {group.label}:{' '}
                      <code dir="ltr" className={chip}>
                        {`{{#each lines.${group.key}}}…{{/each}}`}
                      </code>
                      {group.columns.map((column) => (
                        <code key={column.key} dir="ltr" className={chip}>
                          {`{{row.${column.key}}}`}
                        </code>
                      ))}
                    </p>
                  ))}
                  <p className="text-muted-foreground">
                    الدوال:{' '}
                    {helpers.map((helper) => (
                      <code key={helper} dir="ltr" className={chip}>
                        {helper}
                      </code>
                    ))}{' '}
                    · القيم:{' '}
                    <code dir="ltr" className={chip}>
                      {'{{id}} {{company}} {{logo}} {{status}} {{printedAt}}'}
                    </code>
                  </p>
                  <p className="text-muted-foreground">
                    تُهرَّب كل القيم، وتُحذف الوسوم والخصائص غير المسموحة عند الحفظ. لا يظهر حقل لا
                    يملك القارئ صلاحية قراءته.
                  </p>
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="print-template-record">رقم سجل المعاينة</Label>
                    <Input
                      id="print-template-record"
                      dir="ltr"
                      inputMode="numeric"
                      placeholder="أحدث سجل متاح"
                      value={previewRecord}
                      onChange={(event) => setPreviewRecord(event.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={previewing}
                    onClick={() => void preview()}
                  >
                    <Eye size={15} />
                    {previewing ? 'جارٍ التحضير…' : 'معاينة'}
                  </Button>
                </div>
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {previewHtml ? (
                  <iframe
                    title="معاينة قالب الطباعة"
                    sandbox=""
                    srcDoc={previewHtml}
                    className="h-[420px] w-full rounded-lg border bg-white"
                  />
                ) : (
                  <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                    اضغط «معاينة» لعرض المسودة على سجل تملك صلاحية قراءته.
                  </p>
                )}
              </div>
            </form>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="print-template-form" disabled={saving}>
              {saving ? 'جارٍ الحفظ…' : editing ? 'حفظ نسخة جديدة' : 'إنشاء القالب'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>نسخ القالب</DialogTitle>
            <DialogDescription>{history?.template.label}</DialogDescription>
          </DialogHeader>
          {!history?.versions ? (
            <p className="text-sm text-muted-foreground">جارٍ تحميل النسخ…</p>
          ) : (
            <ol className="space-y-3">
              {history.versions.map((version) => (
                <li key={version.version} className="rounded-lg border p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary" dir="ltr">
                      v{version.version}
                    </Badge>
                    <span className="font-medium">{version.label}</span>
                    <span className="text-muted-foreground">
                      {version.createdBy ?? '—'} ·{' '}
                      <span dir="ltr">{versionTime(version.createdAt, timeZone)}</span>
                    </span>
                  </div>
                  <pre
                    dir="ltr"
                    className="max-h-40 overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap"
                  >
                    {version.body}
                  </pre>
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
PrintTemplatesIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
