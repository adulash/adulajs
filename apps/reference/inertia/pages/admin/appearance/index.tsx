import { useState, type FormEvent, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import axios from 'axios'
import { toast } from 'sonner'
import { CalendarRange, Palette, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { FileInput } from '~/components/ui/file-input'
import { Dialog, DialogClose } from '~/components/ui/dialog'
import { LongDialogContent } from '~/components/ui/long-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { failure, json } from '~/components/account/request'
import { checkColor, previewStyle, type AppearanceTheme } from '~/components/appearance'

type Identity = {
  company: string | null
  logoId: number | null
  logoUrl: string | null
  loginTitle: string | null
  loginDescription: string | null
  guestTitle: string | null
  guestDescription: string | null
  primaryColor: string | null
}
type Occasion = {
  id: number
  name: string
  startsOn: string
  endsOn: string
  primaryColor: string | null
  logoId: number | null
  logoUrl: string | null
  banner: string | null
  loginTitle: string | null
  loginDescription: string | null
  status: 'active' | 'upcoming' | 'ended'
}
type Limits = Record<
  | 'company'
  | 'loginTitle'
  | 'loginDescription'
  | 'guestTitle'
  | 'guestDescription'
  | 'name'
  | 'banner',
  number
>
type Props = {
  identity: Identity
  occasions: Occasion[]
  today: string
  defaults: { company: string; logoUrl: string | null }
  limits: Limits
}

type IdentityDraft = {
  company: string
  logoId: number | null
  logoUrl: string | null
  loginTitle: string
  loginDescription: string
  guestTitle: string
  guestDescription: string
  primaryColor: string
}
type OccasionDraft = {
  id: number | null
  name: string
  startsOn: string
  endsOn: string
  primaryColor: string
  logoId: number | null
  logoUrl: string | null
  banner: string
  loginTitle: string
  loginDescription: string
}

const reload = () => router.reload({ only: ['identity', 'occasions', 'today', 'appearance'] })
const STATUS: Record<
  Occasion['status'],
  { label: string; variant: 'default' | 'outline' | 'secondary' }
> = {
  active: { label: 'نشطة اليوم', variant: 'default' },
  upcoming: { label: 'قادمة', variant: 'outline' },
  ended: { label: 'انتهت', variant: 'secondary' },
}

const identityDraft = (identity: Identity): IdentityDraft => ({
  company: identity.company ?? '',
  logoId: identity.logoId,
  logoUrl: identity.logoUrl,
  loginTitle: identity.loginTitle ?? '',
  loginDescription: identity.loginDescription ?? '',
  guestTitle: identity.guestTitle ?? '',
  guestDescription: identity.guestDescription ?? '',
  primaryColor: identity.primaryColor ?? '',
})
const occasionDraft = (occasion: Occasion | null, today: string): OccasionDraft => ({
  id: occasion?.id ?? null,
  name: occasion?.name ?? '',
  startsOn: occasion?.startsOn ?? today,
  endsOn: occasion?.endsOn ?? today,
  primaryColor: occasion?.primaryColor ?? '',
  logoId: occasion?.logoId ?? null,
  logoUrl: occasion?.logoUrl ?? null,
  banner: occasion?.banner ?? '',
  loginTitle: occasion?.loginTitle ?? '',
  loginDescription: occasion?.loginDescription ?? '',
})
/** The request body: the draft without the preview address; empty texts are cleared. */
const body = <T extends { logoUrl: string | null; id?: number | null }>(draft: T) => {
  const { logoUrl: _logoUrl, id: _id, ...rest } = draft
  return rest
}

async function uploadLogo(file: File) {
  const form = new FormData()
  form.append('logo', file)
  const response = await axios.post('/admin/appearance/logos', form, {
    headers: { Accept: 'application/json' },
  })
  return response.data.data as { id: number; url: string }
}

export default function AdminAppearance({ identity, occasions, today, defaults, limits }: Props) {
  const { confirm, confirmation } = useConfirmAction()
  const [editing, setEditing] = useState<IdentityDraft | null>(null)
  const [occasion, setOccasion] = useState<OccasionDraft | null>(null)
  const active = occasions.find((item) => item.status === 'active') ?? null
  const customised = Object.entries(identity).some(
    ([key, value]) => key !== 'logoUrl' && value !== null
  )

  const reset = () =>
    confirm({
      title: 'استعادة الهوية الافتراضية؟',
      description:
        'يُحذف الاسم والشعار والنصوص واللون المحفوظة هنا، ويعود النظام إلى هوية المشروع الافتراضية. تبقى المناسبات كما هي.',
      destructive: true,
      label: 'استعادة الافتراضي',
      action: async () => {
        try {
          await axios.delete('/admin/appearance', json)
          toast.success('عادت الهوية الافتراضية.')
          reload()
        } catch (caught) {
          toast.error(failure(caught, 'تعذرت استعادة الهوية الافتراضية.'))
        }
      },
    })

  const removeOccasion = (item: Occasion) =>
    confirm({
      title: `حذف مناسبة «${item.name}»؟`,
      description: 'تُحذف المناسبة وشعارها، ويظهر النظام بهويته الأساسية في أيامها.',
      destructive: true,
      label: 'حذف المناسبة',
      action: async () => {
        try {
          await axios.delete(`/admin/appearance/occasions/${item.id}`, json)
          toast.success('حُذفت المناسبة.')
          reload()
        } catch (caught) {
          toast.error(failure(caught, 'تعذر حذف المناسبة.'))
        }
      },
    })

  return (
    <>
      <Head title="المظهر والهوية" />
      <AdminHeader
        title="المظهر والهوية"
        description="اسم الشركة وشعارها ونصوص صفحة الدخول واللون الأساسي، ومظهر مؤقت للمناسبات يعود بعدها النظام إلى هويته تلقائيًا."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette size={16} />
              الهوية الأساسية
            </CardTitle>
            <CardDescription>
              تظهر في صفحات الدخول والزوار وفي النظام والمستندات المطبوعة.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl
              className="grid gap-3 rounded-lg border px-4 py-3 text-sm sm:grid-cols-2"
              data-testid="appearance-identity"
            >
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">اسم الشركة</dt>
                <dd>{identity.company ?? defaults.company}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">الشعار</dt>
                <dd>
                  {identity.logoUrl || defaults.logoUrl ? (
                    <img
                      src={identity.logoUrl ?? defaults.logoUrl ?? ''}
                      alt={`شعار ${identity.company ?? defaults.company}`}
                      className="h-10 w-auto max-w-40 object-contain"
                    />
                  ) : (
                    'لا يوجد'
                  )}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">اللون الأساسي</dt>
                <dd className="flex items-center gap-2">
                  {identity.primaryColor ? (
                    <>
                      <span
                        aria-hidden
                        className="size-4 rounded-sm border"
                        style={{ background: identity.primaryColor }}
                      />
                      <span dir="ltr" className="font-mono text-xs">
                        {identity.primaryColor}
                      </span>
                    </>
                  ) : (
                    'لون النظام الافتراضي'
                  )}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">عنوان صفحة الدخول</dt>
                <dd>{identity.loginTitle ?? 'النص الافتراضي'}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setEditing(identityDraft(identity))}>
                <Pencil size={14} />
                تعديل الهوية
              </Button>
              {customised && (
                <Button variant="outline" onClick={reset}>
                  <RotateCcw size={14} />
                  استعادة الافتراضي
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarRange size={16} />
              مظهر اليوم
            </CardTitle>
            <CardDescription>
              تُطبَّق المناسبة في أيامها بتوقيت النظام، وتعود الهوية الأساسية بعدها دون أي إجراء.
            </CardDescription>
          </CardHeader>
          <CardContent data-testid="appearance-today">
            {active ? (
              <div className="space-y-1 text-sm">
                <Badge>{active.name}</Badge>
                <p className="text-muted-foreground">
                  حتى نهاية يوم <span dir="ltr">{active.endsOn}</span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                الهوية الأساسية، ولا مناسبة نشطة اليوم.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>المناسبات</CardTitle>
            <CardDescription>
              مظهر مؤقت بتاريخ بداية ونهاية، مثل اليوم الوطني. لا تتداخل مناسبتان في يوم واحد.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => setOccasion(occasionDraft(null, today))}>
            <Plus size={14} />
            إضافة مناسبة
          </Button>
        </CardHeader>
        <CardContent>
          {occasions.length === 0 ? (
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              لا توجد مناسبات بعد.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المناسبة</TableHead>
                  <TableHead>الفترة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>
                    <span className="sr-only">الإجراءات</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {occasions.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell dir="ltr" className="text-end tabular-nums">
                      {item.startsOn} – {item.endsOn}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS[item.status].variant}>
                        {STATUS[item.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`تعديل ${item.name}`}
                          onClick={() => setOccasion(occasionDraft(item, today))}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`حذف ${item.name}`}
                          onClick={() => removeOccasion(item)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <IdentityDialog
          initial={editing}
          defaults={defaults}
          limits={limits}
          onClose={() => setEditing(null)}
        />
      )}
      {occasion && (
        <OccasionDialog
          initial={occasion}
          identity={identity}
          defaults={defaults}
          limits={limits}
          onClose={() => setOccasion(null)}
        />
      )}
      {confirmation}
    </>
  )
}

AdminAppearance.layout = (page: ReactElement) => <Workspace>{page}</Workspace>

/** A colour picker and its hex value, with the contrast result read aloud. */
function ColorField({
  id,
  label,
  value,
  optional,
  onChange,
}: {
  id: string
  label: string
  value: string
  optional?: boolean
  onChange: (value: string) => void
}) {
  const check = value ? checkColor(value) : null
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label={`${label}: منتقي اللون`}
          className="w-14 p-1"
          value={check?.ok ? value.toLowerCase() : '#000000'}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          id={id}
          dir="ltr"
          placeholder={optional ? 'دون تغيير' : '#006c35'}
          value={value}
          maxLength={7}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        {value && (
          <Button type="button" variant="outline" onClick={() => onChange('')}>
            {optional ? 'دون تغيير' : 'اللون الافتراضي'}
          </Button>
        )}
      </div>
      <p
        role="status"
        data-testid={`${id}-contrast`}
        className={`text-xs ${check && !check.ok ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {!check
          ? optional
            ? 'يبقى لون الهوية الأساسية.'
            : 'يبقى لون النظام الافتراضي.'
          : check.ok
            ? `التباين ${check.light}:1 في الوضع الفاتح و${check.dark}:1 في الوضع الداكن، ويبلغ معيار WCAG AA.`
            : check.reason}
      </p>
    </div>
  )
}

/** Uploads a logo at once, so the preview shows it; saving the form keeps it. */
function LogoField({
  id,
  logoUrl,
  onChange,
}: {
  id: string
  logoUrl: string | null
  onChange: (logo: { id: number; url: string } | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="space-y-2">
      <Label htmlFor={id} id={`${id}-label`}>
        الشعار
      </Label>
      {logoUrl && (
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="الشعار المختار" className="h-10 w-auto max-w-40 object-contain" />
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>
            إزالة الشعار
          </Button>
        </div>
      )}
      <FileInput
        id={id}
        labelId={`${id}-label`}
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onFilesChange={async (files) => {
          const file = files[0]
          if (!file) return
          setBusy(true)
          setError('')
          try {
            onChange(await uploadLogo(file))
          } catch (caught) {
            setError(failure(caught, 'تعذر رفع الشعار.'))
          } finally {
            setBusy(false)
          }
        }}
      />
      <p
        className={`text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}
        role={error ? 'alert' : undefined}
      >
        {error || 'PNG أو JPEG أو WebP حتى ١ ميغابايت. يُصغَّر إلى ١٠٢٤×٥١٢ بكسل عند الحاجة.'}
      </p>
    </div>
  )
}

/** The login page as it will look, in the light and the dark theme. */
function Preview({
  company,
  logoUrl,
  title,
  description,
  banner,
  theme,
}: {
  company: string
  logoUrl: string | null
  title: string
  description: string
  banner: string
  theme: AppearanceTheme | null
}) {
  return (
    <section aria-label="معاينة مباشرة" className="space-y-3" data-testid="appearance-preview">
      <p className="text-sm font-medium">معاينة مباشرة</p>
      {(['light', 'dark'] as const).map((mode) => (
        <div
          key={mode}
          data-mode={mode}
          className={`${mode === 'dark' ? 'dark' : ''} space-y-3 rounded-lg border bg-background p-4 text-foreground`}
          style={previewStyle(theme?.[mode] ?? null)}
        >
          <p className="text-xs text-muted-foreground">
            {mode === 'light' ? 'الوضع الفاتح' : 'الوضع الداكن'}
          </p>
          {banner && (
            <p className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground">
              {banner}
            </p>
          )}
          <div className="flex items-center gap-2">
            {logoUrl && <img src={logoUrl} alt="" className="h-8 w-auto max-w-24 object-contain" />}
            <span className="text-sm font-semibold">{company}</span>
          </div>
          <div className="space-y-1">
            <p className="font-semibold">{title || 'تسجيل الدخول'}</p>
            <p className="text-xs text-muted-foreground">
              {description || 'أدخل بريدك وكلمة المرور للمتابعة.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" tabIndex={-1}>
              تسجيل الدخول
            </Button>
            <span className="text-sm text-primary">نسيت كلمة المرور؟</span>
          </div>
        </div>
      ))}
    </section>
  )
}

function useSave(onClose: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (request: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError('')
    try {
      await request()
      toast.success(success)
      onClose()
      reload()
    } catch (caught) {
      setError(failure(caught, 'تعذر الحفظ.'))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function IdentityDialog({
  initial,
  defaults,
  limits,
  onClose,
}: {
  initial: IdentityDraft
  defaults: Props['defaults']
  limits: Limits
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const { busy, error, run } = useSave(onClose)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const set = <K extends keyof IdentityDraft>(key: K, value: IdentityDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const check = draft.primaryColor ? checkColor(draft.primaryColor) : null
  const save = (event: FormEvent) => {
    event.preventDefault()
    void run(() => axios.put('/admin/appearance', body(draft), json), 'حُفظت الهوية.')
  }
  return (
    <Dialog mode="edit" open onOpenChange={(open) => !open && !busy && onClose()}>
      <LongDialogContent
        title="تعديل الهوية"
        description="ما تحفظه هنا يظهر لكل المستخدمين والزوار، ما لم تكن مناسبة نشطة تغيّره."
        width="xl"
        footer={
          <>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                إلغاء
              </Button>
            </DialogClose>
            <Button type="submit" form="appearance-identity-form" disabled={busy}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
          <form
            id="appearance-identity-form"
            onSubmit={save}
            className="space-y-5"
            autoComplete="off"
            data-dirty={dirty ? 'true' : 'false'}
          >
            <div className="space-y-2">
              <Label htmlFor="appearance-company">اسم الشركة</Label>
              <Input
                id="appearance-company"
                value={draft.company}
                maxLength={limits.company}
                placeholder={defaults.company}
                onChange={(event) => set('company', event.target.value)}
              />
            </div>
            <LogoField
              id="appearance-logo"
              logoUrl={draft.logoUrl}
              onChange={(logo) =>
                setDraft((current) => ({
                  ...current,
                  logoId: logo?.id ?? null,
                  logoUrl: logo?.url ?? null,
                }))
              }
            />
            <ColorField
              id="appearance-color"
              label="اللون الأساسي"
              value={draft.primaryColor}
              onChange={(value) => set('primaryColor', value)}
            />
            <div className="space-y-2">
              <Label htmlFor="appearance-login-title">عنوان صفحة الدخول</Label>
              <Input
                id="appearance-login-title"
                value={draft.loginTitle}
                maxLength={limits.loginTitle}
                placeholder="تسجيل الدخول"
                onChange={(event) => set('loginTitle', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appearance-login-description">وصف صفحة الدخول</Label>
              <Textarea
                id="appearance-login-description"
                rows={2}
                value={draft.loginDescription}
                maxLength={limits.loginDescription}
                onChange={(event) => set('loginDescription', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appearance-guest-title">عنوان الصفحة الرئيسية للزوار</Label>
              <Input
                id="appearance-guest-title"
                value={draft.guestTitle}
                maxLength={limits.guestTitle}
                onChange={(event) => set('guestTitle', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appearance-guest-description">وصف الصفحة الرئيسية للزوار</Label>
              <Textarea
                id="appearance-guest-description"
                rows={2}
                value={draft.guestDescription}
                maxLength={limits.guestDescription}
                onChange={(event) => set('guestDescription', event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
          <Preview
            company={draft.company || defaults.company}
            logoUrl={draft.logoUrl ?? (draft.logoId ? null : defaults.logoUrl)}
            title={draft.loginTitle}
            description={draft.loginDescription}
            banner=""
            theme={check?.ok ? check.theme : null}
          />
        </div>
      </LongDialogContent>
    </Dialog>
  )
}

function OccasionDialog({
  initial,
  identity,
  defaults,
  limits,
  onClose,
}: {
  initial: OccasionDraft
  identity: Identity
  defaults: Props['defaults']
  limits: Limits
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const { busy, error, run } = useSave(onClose)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const set = <K extends keyof OccasionDraft>(key: K, value: OccasionDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const color = draft.primaryColor || identity.primaryColor || ''
  const check = color ? checkColor(color) : null
  const save = (event: FormEvent) => {
    event.preventDefault()
    void run(
      () =>
        initial.id
          ? axios.put(`/admin/appearance/occasions/${initial.id}`, body(draft), json)
          : axios.post('/admin/appearance/occasions', body(draft), json),
      'حُفظت المناسبة.'
    )
  }
  return (
    <Dialog mode="edit" open onOpenChange={(open) => !open && !busy && onClose()}>
      <LongDialogContent
        title={initial.id ? `تعديل مناسبة «${initial.name}»` : 'إضافة مناسبة'}
        description="تُطبَّق من بداية يوم البداية حتى نهاية يوم النهاية بتوقيت النظام، ثم تعود الهوية الأساسية تلقائيًا."
        width="xl"
        footer={
          <>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                إلغاء
              </Button>
            </DialogClose>
            <Button type="submit" form="appearance-occasion-form" disabled={busy}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
          <form
            id="appearance-occasion-form"
            onSubmit={save}
            className="space-y-5"
            autoComplete="off"
            data-dirty={dirty ? 'true' : 'false'}
          >
            <div className="space-y-2">
              <Label htmlFor="occasion-name">اسم المناسبة</Label>
              <Input
                id="occasion-name"
                required
                value={draft.name}
                maxLength={limits.name}
                placeholder="اليوم الوطني"
                onChange={(event) => set('name', event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="occasion-starts">من يوم</Label>
                <Input
                  id="occasion-starts"
                  type="date"
                  dir="ltr"
                  required
                  value={draft.startsOn}
                  onChange={(event) => set('startsOn', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="occasion-ends">إلى يوم</Label>
                <Input
                  id="occasion-ends"
                  type="date"
                  dir="ltr"
                  required
                  value={draft.endsOn}
                  onChange={(event) => set('endsOn', event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="occasion-banner">رسالة المناسبة</Label>
              <Input
                id="occasion-banner"
                value={draft.banner}
                maxLength={limits.banner}
                placeholder="كل عام والوطن بخير"
                onChange={(event) => set('banner', event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                شريط قصير في صفحات الزوار وأعلى النظام طوال أيام المناسبة.
              </p>
            </div>
            <ColorField
              id="occasion-color"
              label="لون المناسبة"
              optional
              value={draft.primaryColor}
              onChange={(value) => set('primaryColor', value)}
            />
            <LogoField
              id="occasion-logo"
              logoUrl={draft.logoUrl}
              onChange={(logo) =>
                setDraft((current) => ({
                  ...current,
                  logoId: logo?.id ?? null,
                  logoUrl: logo?.url ?? null,
                }))
              }
            />
            <div className="space-y-2">
              <Label htmlFor="occasion-login-title">عنوان صفحة الدخول في المناسبة</Label>
              <Input
                id="occasion-login-title"
                value={draft.loginTitle}
                maxLength={limits.loginTitle}
                onChange={(event) => set('loginTitle', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="occasion-login-description">وصف صفحة الدخول في المناسبة</Label>
              <Textarea
                id="occasion-login-description"
                rows={2}
                value={draft.loginDescription}
                maxLength={limits.loginDescription}
                onChange={(event) => set('loginDescription', event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
          <Preview
            company={identity.company ?? defaults.company}
            logoUrl={draft.logoUrl ?? identity.logoUrl ?? defaults.logoUrl}
            title={draft.loginTitle || identity.loginTitle || ''}
            description={draft.loginDescription || identity.loginDescription || ''}
            banner={draft.banner}
            theme={check?.ok ? check.theme : null}
          />
        </div>
      </LongDialogContent>
    </Dialog>
  )
}
