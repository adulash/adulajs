import { useEffect, useState } from 'react'
import { router } from '@inertiajs/react'
import axios from 'axios'
import { Download, FileUp } from 'lucide-react'
import type { ImportBatchRecord as ImportBatch, ImportMode } from 'adula'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }
const SKIP = '__skip__'
type Step = 'upload' | 'mapping' | 'validating' | 'report'

/** Counts of a finished dry run: what the real import would create, update and refuse. */
export function ImportSummary({ batch }: { batch: ImportBatch }) {
  return (
    <p className="text-sm tabular-nums">
      سيُضاف {batch.created}
      {batch.mode === 'upsert' && ` · سيُحدَّث ${batch.updated}`} · أخطاء {batch.failed}
    </p>
  )
}

/** The per-row dry-run report of a validated batch. */
export function ImportReport({ batch }: { batch: ImportBatch }) {
  if (!batch.report.length)
    return <p className="text-sm text-muted-foreground">لا يوجد تقرير صفوف لهذه الدفعة.</p>
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border">
      <Table aria-label="تقرير التحقق">
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">الصف</TableHead>
            <TableHead className="w-28">النتيجة</TableHead>
            <TableHead>الملاحظة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batch.report.map((entry) => (
            <TableRow key={entry.row}>
              <TableCell className="tabular-nums">{entry.row}</TableCell>
              <TableCell>
                {entry.ok ? (
                  <Badge variant={entry.action === 'update' ? 'secondary' : 'outline'}>
                    {entry.action === 'update' ? 'تحديث' : 'إضافة'}
                  </Badge>
                ) : (
                  <Badge variant="destructive">خطأ</Badge>
                )}
              </TableCell>
              <TableCell className="text-xs whitespace-normal">{entry.message ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Upload a file, map its columns to writable fields, choose add-only or add-or-update,
 * optionally validate every row without saving, then queue the import.
 */
export function ResourceImport({
  resource,
  label,
  accept = '.csv,text/csv',
}: {
  resource: string
  label: string
  /** File picker filter; add the extensions of registered import adapters. */
  accept?: string
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<ImportMode>('create')
  const [matchField, setMatchField] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reset = () => {
    setStep('upload')
    setFile(null)
    setBatch(null)
    setMapping({})
    setMode('create')
    setMatchField('')
    setError('')
  }
  const failure = (caught: unknown, fallback: string) =>
    setError(
      axios.isAxiosError(caught) && caught.response?.data?.error?.message
        ? String(caught.response.data.error.message)
        : fallback
    )
  // The worker validates in the background; follow the batch until its report is ready.
  useEffect(() => {
    if (step !== 'validating' || !batch) return
    const timer = setInterval(async () => {
      try {
        const response = await axios.get<{ data: ImportBatch }>(`/imports/${batch.id}`, json)
        const next = response.data.data
        setBatch(next)
        if (next.status === 'validated') setStep('report')
        if (next.status === 'failed') {
          setError('تعذر التحقق من الملف.')
          setStep('mapping')
        }
      } catch (caught) {
        failure(caught, 'تعذر قراءة حالة التحقق.')
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [step, batch?.id])
  const unique = batch?.targets.filter((target) => target.unique) ?? []
  const upload = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await axios.post<{ data: ImportBatch }>(
        `/resources/${resource}/imports`,
        form,
        json
      )
      setBatch(response.data.data)
      setMapping(response.data.data.mapping)
      setStep('mapping')
    } catch (caught) {
      failure(caught, 'تعذر قراءة الملف.')
    } finally {
      setBusy(false)
    }
  }
  const run = async (dryRun: boolean) => {
    if (!batch) return
    setBusy(true)
    setError('')
    try {
      const response = await axios.post<{ data: ImportBatch }>(
        `/imports/${batch.id}/start`,
        { mapping, mode, matchField: mode === 'upsert' ? matchField : undefined, dryRun },
        json
      )
      if (dryRun) {
        setBatch(response.data.data)
        setStep('validating')
        return
      }
      setOpen(false)
      reset()
      router.visit('/imports')
    } catch (caught) {
      failure(caught, dryRun ? 'تعذر بدء التحقق.' : 'تعذر بدء الاستيراد.')
    } finally {
      setBusy(false)
    }
  }
  const description = {
    upload: 'ملف CSV بترميز UTF-8، صفه الأول عناوين الأعمدة، حتى 5000 صف. نزّل القالب لتبدأ بالأعمدة الصحيحة.',
    mapping: `طابِق أعمدة الملف (${batch?.total ?? 0} صفاً) مع الحقول، ثم تحقق دون حفظ أو ابدأ الاستيراد.`,
    validating: `جارٍ التحقق من الصفوف دون حفظ: ${batch?.processed ?? 0} من ${batch?.total ?? 0}.`,
    report: 'نتيجة التحقق لكل صف. لم يُحفظ شيء بعد؛ ابدأ الاستيراد أو ارجع لتعديل المطابقة.',
  }[step]
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileUp size={16} />
        استيراد CSV
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) reset()
        }}
      >
        <DialogContent dir="rtl" className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>استيراد إلى {label}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {step === 'upload' && (
            <form id="import-upload" className="space-y-3" onSubmit={upload}>
              <div className="space-y-2">
                <Label htmlFor="import-file">الملف</Label>
                <Input
                  id="import-file"
                  type="file"
                  accept={accept}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </div>
              <Button type="button" variant="link" size="sm" className="px-0" asChild>
                <a href={`/resources/${resource}/imports/template`} download>
                  <Download size={14} />
                  تنزيل قالب CSV
                </a>
              </Button>
            </form>
          )}
          {step === 'mapping' && batch && (
            <form
              id="import-mapping"
              className="max-h-[60vh] space-y-4 overflow-y-auto"
              onSubmit={(event) => {
                event.preventDefault()
                void run(false)
              }}
            >
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">نمط الاستيراد</legend>
                <RadioGroup
                  value={mode}
                  onValueChange={(value) => setMode(value as ImportMode)}
                  className="flex flex-wrap gap-6"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="import-mode-create" value="create" />
                    <Label htmlFor="import-mode-create">إضافة فقط</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      id="import-mode-upsert"
                      value="upsert"
                      disabled={unique.length === 0}
                    />
                    <Label htmlFor="import-mode-upsert">إضافة أو تحديث</Label>
                  </div>
                </RadioGroup>
                {unique.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    التحديث يحتاج حقلاً فريداً، ولا يوجد حقل فريد قابل للاستيراد هنا.
                  </p>
                )}
              </fieldset>
              {mode === 'upsert' && (
                <div className="grid grid-cols-2 items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">حقل المطابقة</p>
                    <p className="text-xs text-muted-foreground">
                      يُحدَّث السجل الذي يحمل القيمة نفسها، ويُضاف الباقي. الخلية الفارغة تُبقي القيمة المحفوظة.
                    </p>
                  </div>
                  <Select value={matchField} onValueChange={setMatchField}>
                    <SelectTrigger aria-label="حقل المطابقة">
                      <SelectValue placeholder="اختر حقلاً فريداً" />
                    </SelectTrigger>
                    <SelectContent>
                      {unique.map((target) => (
                        <SelectItem key={target.key} value={target.key}>
                          {target.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-3 border-t pt-4">
                {batch.headers.map((header, index) => (
                  <div key={index} className="grid grid-cols-2 items-center gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{header || `عمود ${index + 1}`}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        مثال: {batch.sample[0]?.[index] || '—'}
                      </p>
                    </div>
                    <Select
                      value={mapping[String(index)] ?? SKIP}
                      onValueChange={(value) =>
                        setMapping((current) => {
                          const next = { ...current }
                          if (value === SKIP) delete next[String(index)]
                          else next[String(index)] = value
                          return next
                        })
                      }
                    >
                      <SelectTrigger aria-label={`حقل العمود ${header || index + 1}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>تجاهل العمود</SelectItem>
                        {batch.targets.map((target) => (
                          <SelectItem key={target.key} value={target.key}>
                            {target.label}
                            {target.required ? ' *' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </form>
          )}
          {step === 'validating' && batch && (
            <div
              role="progressbar"
              aria-label="تقدم التحقق"
              aria-valuemin={0}
              aria-valuemax={batch.total}
              aria-valuenow={batch.processed}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${batch.total ? (batch.processed / batch.total) * 100 : 0}%` }}
              />
            </div>
          )}
          {step === 'report' && batch && (
            <div className="space-y-3">
              <ImportSummary batch={batch} />
              <ImportReport batch={batch} />
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            {step === 'upload' && (
              <Button type="submit" form="import-upload" disabled={busy || !file}>
                رفع الملف
              </Button>
            )}
            {step === 'mapping' && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || (mode === 'upsert' && !matchField)}
                  onClick={() => void run(true)}
                >
                  تحقق دون حفظ
                </Button>
                <Button
                  type="submit"
                  form="import-mapping"
                  disabled={busy || (mode === 'upsert' && !matchField)}
                >
                  بدء الاستيراد
                </Button>
              </>
            )}
            {step === 'report' && (
              <>
                <Button type="button" variant="outline" onClick={() => setStep('mapping')}>
                  تعديل المطابقة
                </Button>
                <Button type="button" disabled={busy} onClick={() => void run(false)}>
                  بدء الاستيراد
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
