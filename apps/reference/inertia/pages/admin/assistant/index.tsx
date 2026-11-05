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
import { Dialog, DialogClose } from '~/components/ui/dialog'
import { LongDialogContent } from '~/components/ui/long-dialog'
import { failure, json } from '~/components/account/request'

type Props = { settings: AssistantSettingsView }
// The provider address is not an owner setting: OpenRouter is the default and a custom
// address (tests, a proxy) is set on the server (ADR 052).
type Draft = Omit<AssistantSettingsView, 'hasKey' | 'updatedAt' | 'baseUrl'>
const LIMITS: [keyof Draft, string, string][] = [
  ['requestsPerMinute', 'الأسئلة في الدقيقة لكل مستخدم', '1 – 60'],
  ['dailyTokenBudget', 'حصة الرموز اليومية لكل مستخدم', '1000 – 2000000'],
  ['maxOutputTokens', 'أقصى طول للرد (رموز)', '64 – 4096'],
  ['maxToolIterations', 'أقصى خطوات قراءة في السؤال', '0 – 8'],
  ['timeoutSeconds', 'مهلة المزوّد بالثواني', '5 – 60'],
]
const reload = () => router.reload({ only: ['settings', 'assistant'] })

function draftOf(settings: AssistantSettingsView): Draft {
  const { hasKey: _hasKey, updatedAt: _updatedAt, baseUrl: _baseUrl, ...draft } = settings
  return draft
}

export default function AdminAssistant({ settings }: Props) {
  const { confirm, confirmation } = useConfirmAction()
  const [draft, setDraft] = useState<Draft | null>(null)
  // The values the dialog opened with: closing asks first only when they changed.
  const [initial, setInitial] = useState<Draft | null>(null)
  // The new key, write-only: typed here, sent once, never read back.
  const [key, setKey] = useState('')
  const [changingKey, setChangingKey] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const openSettings = () => {
    setError('')
    setKey('')
    setChangingKey(false)
    setDraft(draftOf(settings))
    setInitial(draftOf(settings))
  }

  // Typing and then restoring a value counts as clean; a typed key is a change.
  const dirty =
    draft !== null && (JSON.stringify(draft) !== JSON.stringify(initial) || key.trim() !== '')

  const closeSettings = () => {
    setDraft(null)
    setKey('')
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const newKey = key.trim()
    if (draft.enabled && !settings.hasKey && !newKey) {
      setError('أدخل مفتاح OpenRouter قبل تفعيل المساعد.')
      return
    }
    setBusy(true)
    setError('')
    // Two requests, the key first so enabling never runs ahead of it. When the key is
    // stored but the rest is refused, the page reloads to show the stored key and says so.
    let keySaved = false
    try {
      if (newKey) {
        await axios.put('/admin/assistant/key', { key: newKey }, json)
        keySaved = true
      }
      await axios.put('/admin/assistant', draft, json)
      closeSettings()
      toast.success(newKey ? 'تم حفظ الإعداد والمفتاح مشفّرًا.' : 'تم حفظ إعداد المساعد.')
      reload()
    } catch (caught) {
      if (keySaved) {
        setKey('')
        setChangingKey(false)
        setError(`حُفظ المفتاح، وتعذر حفظ بقية الإعداد: ${failure(caught, 'خطأ غير متوقع.')}`)
        reload()
      } else setError(failure(caught, 'تعذر حفظ إعداد المساعد.'))
    } finally {
      setBusy(false)
    }
  }

  // Outside the settings dialog: deleting takes effect at once and the server also turns
  // the assistant off, so it is never mixed with the dialog's unsaved changes.
  const removeKey = () =>
    confirm({
      title: 'حذف مفتاح OpenRouter؟',
      description: 'يتوقف المساعد فورًا لكل المستخدمين حتى تُدخل مفتاحًا جديدًا.',
      destructive: true,
      label: 'حذف المفتاح',
      action: async () => {
        try {
          await axios.delete('/admin/assistant/key', json)
          toast.success('تم حذف المفتاح وإيقاف المساعد.')
          reload()
        } catch (caught) {
          toast.error(failure(caught, 'تعذر حذف المفتاح.'))
        }
      },
    })

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
                <dt className="text-xs text-muted-foreground">مفتاح OpenRouter</dt>
                <dd data-testid="assistant-key-state">
                  {settings.hasKey ? (
                    <Badge>مفتاح محفوظ</Badge>
                  ) : (
                    <Badge variant="outline">لا يوجد مفتاح</Badge>
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
              <Button variant={settings.hasKey ? 'outline' : 'default'} onClick={openSettings}>
                <Settings2 size={14} />
                {settings.hasKey ? 'تعديل الإعداد' : 'إعداد المساعد'}
              </Button>
              {settings.hasKey && (
                <>
                  <Button variant="outline" disabled={busy} onClick={test}>
                    <PlugZap size={14} />
                    اختبار الاتصال
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={removeKey}>
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
        onOpenChange={(open) => !open && !busy && closeSettings()}
      >
        <LongDialogContent
          title="إعداد المساعد"
          description="مفتاح OpenRouter والنموذج وحدود الاستخدام. يُحفظ المفتاح مشفّرًا ولا يُعرض مرة أخرى."
          footer={
            <>
              {/* Through the dialog, so «إلغاء» asks first exactly like Escape when dirty. */}
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  إلغاء
                </Button>
              </DialogClose>
              {/* The footer sits outside the scrolling body, so it submits the form by id. */}
              <Button type="submit" form="assistant-settings" disabled={busy}>
                حفظ
              </Button>
            </>
          }
        >
          <form
            id="assistant-settings"
            onSubmit={save}
            className="space-y-5"
            autoComplete="off"
            data-dirty={dirty ? 'true' : 'false'}
          >
            {draft && (
              <>
                <div className="space-y-2">
                  {/* Labels the field only while it is shown; otherwise it names the group. */}
                  <Label
                    htmlFor={settings.hasKey && !changingKey ? undefined : 'assistant-key'}
                    id="assistant-key-label"
                  >
                    مفتاح OpenRouter
                  </Label>
                  {settings.hasKey && !changingKey ? (
                    <div
                      role="group"
                      aria-labelledby="assistant-key-label"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <Badge>مفتاح محفوظ</Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => setChangingKey(true)}
                      >
                        <KeyRound size={14} />
                        تغيير المفتاح
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Input
                        id="assistant-key"
                        type="password"
                        dir="ltr"
                        autoComplete="new-password"
                        spellCheck={false}
                        placeholder="sk-or-v1-…"
                        value={key}
                        onChange={(event) => setKey(event.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {settings.hasKey
                          ? 'أدخل المفتاح الجديد، أو اتركه فارغًا لإبقاء المفتاح المحفوظ.'
                          : 'أنشئه من حساب المؤسسة لدى OpenRouter. يُحفظ مشفّرًا ولا يُعرض مرة أخرى.'}
                      </p>
                    </>
                  )}
                </div>
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
          </form>
        </LongDialogContent>
      </Dialog>

      {confirmation}
    </>
  )
}
AdminAssistant.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
