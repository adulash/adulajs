import { useState, type FormEvent, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import axios from 'axios'
import { toast } from 'sonner'
import { Bot, KeyRound, PlugZap, Settings2, Trash2 } from 'lucide-react'
import type { AssistantSettingsView } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { AssistantNotice } from '~/components/assistant/notice'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { failure, json } from '~/components/account/request'

type Props = { settings: AssistantSettingsView }
type Draft = Omit<AssistantSettingsView, 'hasKey' | 'updatedAt'>
const LIMITS: [keyof Draft, string, string][] = [
  ['requestsPerMinute', 'الأسئلة في الدقيقة لكل مستخدم', '1 – 60'],
  ['dailyTokenBudget', 'حصة الرموز اليومية لكل مستخدم', '1000 – 2000000'],
  ['maxOutputTokens', 'أقصى طول للرد (رموز)', '64 – 4096'],
  ['maxToolIterations', 'أقصى خطوات قراءة في السؤال', '0 – 8'],
  ['timeoutSeconds', 'مهلة المزوّد بالثواني', '5 – 60'],
]
const reload = () => router.reload({ only: ['settings', 'assistant'] })

function draftOf(settings: AssistantSettingsView): Draft {
  const { hasKey: _hasKey, updatedAt: _updatedAt, ...draft } = settings
  return draft
}

export default function AdminAssistant({ settings }: Props) {
  const { confirm, confirmation } = useConfirmAction()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const response = await axios.put('/admin/assistant', draft, json)
      setDraft(null)
      toast.success(
        settings.hasKey && !response.data.data.hasKey
          ? 'تم الحفظ، وحُذف المفتاح لأن عنوان المزوّد تغيّر. أدخل المفتاح من جديد.'
          : 'تم حفظ إعداد المساعد.'
      )
      reload()
    } catch (caught) {
      setError(failure(caught, 'تعذر حفظ إعداد المساعد.'))
    } finally {
      setBusy(false)
    }
  }

  const saveKey = async (event: FormEvent) => {
    event.preventDefault()
    if (key === null) return
    setBusy(true)
    setError('')
    try {
      await axios.put('/admin/assistant/key', { key }, json)
      setKey(null)
      toast.success('تم حفظ المفتاح مشفّرًا.')
      reload()
    } catch (caught) {
      setError(failure(caught, 'تعذر حفظ المفتاح.'))
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    try {
      const response = await axios.post('/admin/assistant/test', {}, json)
      const result = response.data.data as { ok: boolean; category: string | null }
      if (result.ok) toast.success('استجاب المزوّد بنجاح.')
      else toast.error(`تعذر الاتصال بالمزوّد (${result.category}).`)
    } catch (caught) {
      toast.error(failure(caught, 'تعذر اختبار الاتصال.'))
    } finally {
      setBusy(false)
    }
  }

  const update = <K extends keyof Draft>(name: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [name]: value } : current))

  return (
    <>
      <Head title="المساعد الذكي" />
      <AdminHeader
        title="المساعد الذكي"
        description="مساعد داخل النظام عبر مزوّد OpenRouter، يقرأ السجلات بصلاحيات المستخدم ويقترح التعديلات دون تنفيذها إلا بموافقته."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot size={16} />
              إعداد المساعد
            </CardTitle>
            <CardDescription>
              يظهر المساعد لمن تمنحه أدوارهم صلاحية «المساعد الذكي / استخدام» على مستوى النظام كله.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 rounded-lg border px-4 py-3 text-sm sm:grid-cols-3">
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">الحالة</dt>
                <dd>
                  {settings.enabled ? <Badge>مفعّل</Badge> : <Badge variant="outline">موقوف</Badge>}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">مفتاح المزوّد</dt>
                <dd data-testid="assistant-key-state">
                  {settings.hasKey ? (
                    <Badge>مُعَدّ</Badge>
                  ) : (
                    <Badge variant="outline">غير مُعَدّ</Badge>
                  )}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">اقتراح التعديلات</dt>
                <dd>{settings.allowWriteProposals ? 'مسموح بموافقة المستخدم' : 'قراءة فقط'}</dd>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <dt className="text-xs text-muted-foreground">النموذج</dt>
                <dd dir="ltr" className="truncate text-end font-mono text-xs">
                  {settings.model || '—'}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">الحصة اليومية لكل مستخدم</dt>
                <dd className="tabular-nums">{settings.dailyTokenBudget.toLocaleString('ar')}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setError('')
                  setDraft(draftOf(settings))
                }}
              >
                <Settings2 size={14} />
                تعديل الإعداد
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setError('')
                  setKey('')
                }}
              >
                <KeyRound size={14} />
                {settings.hasKey ? 'تغيير المفتاح' : 'إدخال المفتاح'}
              </Button>
              {settings.hasKey && (
                <>
                  <Button variant="outline" disabled={busy} onClick={test}>
                    <PlugZap size={14} />
                    اختبار الاتصال
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      confirm({
                        title: 'حذف مفتاح المزوّد؟',
                        description: 'يتوقف المساعد فورًا لكل المستخدمين حتى تُدخل مفتاحًا جديدًا.',
                        action: async () => {
                          await axios.delete('/admin/assistant/key', json)
                          reload()
                        },
                      })
                    }
                  >
                    <Trash2 size={14} />
                    حذف المفتاح
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>البيانات المرسلة إلى المزوّد</CardTitle>
            <CardDescription>
              يرى كل مستخدم هذا التنبيه ويوافق عليه قبل سؤاله الأول.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssistantNotice />
          </CardContent>
        </Card>
      </div>

      <Dialog
        mode="edit"
        open={draft !== null}
        onOpenChange={(open) => !open && !busy && setDraft(null)}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={save} className="space-y-5">
            <DialogHeader>
              <DialogTitle>إعداد المساعد</DialogTitle>
              <DialogDescription>
                تغيير عنوان المزوّد يحذف المفتاح المحفوظ حتى لا يُرسل إلى عنوان آخر.
              </DialogDescription>
            </DialogHeader>
            {draft && (
              <>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="assistant-enabled">تفعيل المساعد</Label>
                  <Switch
                    id="assistant-enabled"
                    checked={draft.enabled}
                    onCheckedChange={(value) => update('enabled', value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assistant-model">معرّف النموذج</Label>
                  <Input
                    id="assistant-model"
                    dir="ltr"
                    required
                    value={draft.model}
                    placeholder="openai/gpt-4o-mini"
                    onChange={(event) => update('model', event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    كما يظهر في قائمة نماذج OpenRouter.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assistant-url">عنوان المزوّد</Label>
                  <Input
                    id="assistant-url"
                    dir="ltr"
                    required
                    value={draft.baseUrl}
                    onChange={(event) => update('baseUrl', event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assistant-prompt">تعليمات المساعد وشخصيته</Label>
                  <Textarea
                    id="assistant-prompt"
                    rows={5}
                    maxLength={4000}
                    value={draft.systemPrompt}
                    placeholder="مثال: أنت مساعد قسم المشتريات، تجيب بإيجاز وبلغة رسمية."
                    onChange={(event) => update('systemPrompt', event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    تُضاف بعد قواعد النظام الثابتة، ولا تغيّر صلاحيات المستخدم.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {LIMITS.map(([name, label, range]) => (
                    <div key={name} className="space-y-2">
                      <Label htmlFor={`assistant-${name}`}>{label}</Label>
                      <Input
                        id={`assistant-${name}`}
                        type="number"
                        dir="ltr"
                        required
                        value={String(draft[name])}
                        onChange={(event) => update(name, Number(event.target.value) as never)}
                      />
                      <p className="text-xs text-muted-foreground tabular-nums">{range}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                  <div className="space-y-1">
                    <Label htmlFor="assistant-writes">السماح باقتراح التعديلات</Label>
                    <p className="text-xs text-muted-foreground">
                      يقترح المساعد إنشاء السجلات أو تعديلها أو حذفها، ولا يُنفَّذ شيء إلا بعد
                      مراجعة المستخدم وموافقته.
                    </p>
                  </div>
                  <Switch
                    id="assistant-writes"
                    checked={draft.allowWriteProposals}
                    onCheckedChange={(value) => update('allowWriteProposals', value)}
                  />
                </div>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={busy}>
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        mode="edit"
        open={key !== null}
        onOpenChange={(open) => !open && !busy && setKey(null)}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={saveKey} className="space-y-5" autoComplete="off">
            <DialogHeader>
              <DialogTitle>مفتاح OpenRouter</DialogTitle>
              <DialogDescription>
                يُحفظ المفتاح مشفّرًا ولا يُعرض مرة أخرى. أنشئه من حساب المؤسسة لدى OpenRouter.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="assistant-key">المفتاح</Label>
              <Input
                id="assistant-key"
                type="password"
                dir="ltr"
                required
                autoComplete="off"
                value={key ?? ''}
                onChange={(event) => setKey(event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setKey(null)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={busy}>
                حفظ المفتاح
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {confirmation}
    </>
  )
}
AdminAssistant.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
