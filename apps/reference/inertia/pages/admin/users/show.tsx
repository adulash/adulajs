import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { Head, router, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import {
  ArrowRight,
  Ban,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  UserCog,
  UserMinus,
  UserCheck,
  X,
} from 'lucide-react'
import type { OrgUnitNode, RoleSummary, UserSummary } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader, useDateTimeFormatter } from '~/components/admin-nav'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { ResourceSelect } from '~/components/ui/resource-field'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/** Token metadata from the server; the secret is never sent. */
type TokenSummary = {
  id: number
  name: string | null
  access: 'read' | 'write'
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}
type Props = {
  /** The account this page shows; the signed-in account is the shared `account` prop. */
  target: UserSummary
  roles: RoleSummary[]
  orgUnits: OrgUnitNode[]
  tokens: TokenSummary[]
  /** Status only: the secret and recovery codes never leave the server. */
  twoFactor: { enabled: boolean; enabledAt: string | null; recoveryRemaining: number }
  /** Roles granting full administration (`manage all`); assigning one asks a dedicated confirmation. */
  privilegedRoleIds: number[]
}
/** Indents nested units in a flat list so the hierarchy stays readable. */
const unitOption = (unit: OrgUnitNode) => ({
  value: String(unit.id),
  label: `${'· '.repeat(unit.depth - 1)}${unit.name}`,
})

/** Bounds the server enforces on the impersonation reason. */
const REASON_MIN = 10
const REASON_MAX = 500

/**
 * Starting impersonation asks for a written reason, recorded in the activity log with the
 * start; the server refuses a missing or too short one and the dialog keeps the input.
 */
function ImpersonationDialog({
  open,
  onOpenChange,
  url,
  name,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string
  name: string
}) {
  const { flash } = usePage()
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  // Only an error answering this dialog's own request is shown in it.
  const [attempted, setAttempted] = useState(false)
  const length = [...reason.trim()].length
  const valid = length >= REASON_MIN && length <= REASON_MAX
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    setAttempted(true)
    router.post(
      url,
      { reason: reason.trim() },
      {
        preserveScroll: true,
        preserveState: true,
        onStart: () => setSending(true),
        onFinish: () => setSending(false),
      }
    )
  }
  return (
    <Dialog mode="edit" open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>انتحال حساب {name}</DialogTitle>
          <DialogDescription>
            ستتصفح النظام بصلاحيات هذا المستخدم حتى تنهي الانتحال. يُسجَّل السبب ووقت البدء
            والانتهاء وعنوان الجهاز في سجل النشاط.
          </DialogDescription>
        </DialogHeader>
        <form id="impersonation-form" onSubmit={submit} className="space-y-2">
          <Label htmlFor="impersonation-reason">سبب الانتحال</Label>
          <Textarea
            id="impersonation-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={REASON_MIN}
            maxLength={REASON_MAX}
            rows={3}
            required
            autoFocus
            aria-describedby="impersonation-reason-hint"
          />
          <p id="impersonation-reason-hint" className="text-xs text-muted-foreground">
            اكتب لماذا تحتاج إلى التصفح باسمه، من {REASON_MIN} إلى {REASON_MAX} حرف (
            <span className="tabular-nums">{length}</span>).
          </p>
          {attempted && typeof flash.error === 'string' && (
            <p role="alert" className="text-sm text-destructive">
              {flash.error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button type="submit" form="impersonation-form" disabled={!valid || sending}>
            <UserCog size={16} />
            بدء الانتحال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function UserShow({
  target: user,
  roles,
  orgUnits,
  tokens,
  twoFactor,
  privilegedRoleIds,
}: Props) {
  const self = usePage<{ account?: { id: number } }>().props.account?.id === user.id
  const formatDateTime = useDateTimeFormatter()
  const { confirm, confirmation } = useConfirmAction()
  const [impersonating, setImpersonating] = useState(false)
  // No role is preselected: the bootstrap administrator role sorts first and would make
  // granting full administration a single click.
  const [roleId, setRoleId] = useState('')
  const privileged = new Set(privilegedRoleIds)
  const unitNames = new Map(orgUnits.map((unit) => [String(unit.id), unit.name]))
  /** A unit's parents by name (its path holds the ids from the root down), for example «الإدارة › المبيعات». */
  const ancestry = (path: string) =>
    path
      .split('.')
      .slice(0, -1)
      .map((segment) => unitNames.get(segment))
      .filter(Boolean)
      .join(' › ')
  const [roleUnit, setRoleUnit] = useState('')
  const [unitId, setUnitId] = useState('')
  const base = `/admin/users/${user.id}`
  const post = (url: string, data: Record<string, string | number | null> = {}) =>
    router.post(url, data, { preserveScroll: true })
  const assignRole = (event: FormEvent) => {
    event.preventDefault()
    if (!roleId) return
    const action = () =>
      router.post(
        `${base}/roles`,
        { roleId, orgUnitId: roleUnit || null },
        { preserveScroll: true, onSuccess: () => setRoleId('') }
      )
    const role = roles.find((candidate) => String(candidate.id) === roleId)
    if (privileged.has(Number(roleId)))
      confirm({
        title: 'منح الإدارة الكاملة؟',
        description: `الدور «${role?.name ?? ''}» يمنح إدارة كل شيء: قراءة كل البيانات وتغييرها، وإدارة المستخدمين والأدوار والإعدادات. لا تُسنده إلا لمن يتولى إدارة النظام.`,
        destructive: true,
        label: 'منح الإدارة الكاملة',
        action,
      })
    else
      confirm({
        title: 'إسناد الدور؟',
        description: 'ستتغير الصلاحيات المتاحة لهذا المستخدم فورًا.',
        label: 'إسناد الدور',
        action,
      })
  }
  const assignUnit = (event: FormEvent) => {
    event.preventDefault()
    if (unitId) post(`${base}/org-units`, { orgUnitId: unitId })
  }
  const available = orgUnits.filter((unit) => !user.orgUnits.some((own) => own.id === unit.id))
  return (
    <>
      <Head title={user.fullName || user.email} />
      <Link
        href="/admin/users"
        className="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground"
      >
        <ArrowRight size={15} />
        العودة إلى المستخدمين
      </Link>
      <AdminHeader title={user.fullName || user.email} description={user.email} />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        {user.disabledAt ? (
          <Badge variant="destructive">معطّل منذ {formatDateTime(user.disabledAt)}</Badge>
        ) : (
          <Badge>نشط</Badge>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الأدوار</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الدور</TableHead>
                  <TableHead>الوحدة</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.roles.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell>{assignment.role}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {assignment.orgUnit ?? 'كل الجهة'}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`إزالة الدور ${assignment.role}`}
                        onClick={() =>
                          confirm({
                            title: 'إزالة الدور؟',
                            description: `سيُسحب دور ${assignment.role} من هذا المستخدم. لا يمكن سحب الإدارة من حسابك الحالي أو إزالة آخر مدير نشط.`,
                            destructive: true,
                            action: () =>
                              router.delete(`${base}/roles/${assignment.id}`, {
                                preserveScroll: true,
                              }),
                          })
                        }
                      >
                        <X size={15} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {user.roles.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      لا أدوار مسندة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <form onSubmit={assignRole} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-1">
                <Label htmlFor="assign-role">الدور</Label>
                <ResourceSelect
                  id="assign-role"
                  value={roleId}
                  placeholder="اختر دوراً"
                  options={roles.map((role) => ({
                    value: String(role.id),
                    label: privileged.has(role.id) ? `${role.name} (إدارة كاملة)` : role.name,
                  }))}
                  onChange={setRoleId}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="assign-role-unit">مقيّد بوحدة (اختياري)</Label>
                <ResourceSelect
                  id="assign-role-unit"
                  value={roleUnit}
                  placeholder="كل الجهة"
                  options={orgUnits.map(unitOption)}
                  onChange={setRoleUnit}
                />
              </div>
              <Button type="submit" className="self-end" disabled={!roleId}>
                إسناد الدور
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>الوحدات التنظيمية</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ul className="space-y-2">
              {user.orgUnits.map((unit) => (
                <li
                  key={unit.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span>
                    {unit.name}
                    {ancestry(unit.path) && (
                      <span className="ms-2 text-xs text-muted-foreground">
                        {ancestry(unit.path)}
                      </span>
                    )}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`إزالة من ${unit.name}`}
                    onClick={() =>
                      router.delete(`${base}/org-units/${unit.id}`, { preserveScroll: true })
                    }
                  >
                    <X size={15} />
                  </Button>
                </li>
              ))}
              {user.orgUnits.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  لا عضويات؛ الكيانات المقيدة بالنطاق مخفية عن هذا المستخدم.
                </li>
              )}
            </ul>
            <form onSubmit={assignUnit} className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-1">
                <Label htmlFor="assign-unit">الوحدة</Label>
                <ResourceSelect
                  id="assign-unit"
                  value={unitId}
                  placeholder="اختر وحدة"
                  options={available.map(unitOption)}
                  onChange={setUnitId}
                />
              </div>
              <Button type="submit" className="self-end" disabled={!unitId}>
                إضافة إلى الوحدة
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>رموز الوصول البرمجي</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>الصلاحية</TableHead>
                <TableHead>أُنشئ</TableHead>
                <TableHead>آخر استخدام</TableHead>
                <TableHead>ينتهي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell>{token.name ?? 'بلا اسم'}</TableCell>
                  <TableCell>
                    <Badge variant={token.access === 'write' ? 'default' : 'secondary'}>
                      {token.access === 'write' ? 'قراءة وكتابة' : 'قراءة فقط'}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDateTime(token.createdAt)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : 'لم يُستخدم'}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {token.expiresAt ? formatDateTime(token.expiresAt) : 'بلا انتهاء'}
                  </TableCell>
                </TableRow>
              ))}
              {tokens.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    لا رموز وصول لهذا المستخدم.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck size={16} />
            التحقق بخطوتين
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-sm">
            <dt className="text-muted-foreground">الحالة</dt>
            <dd>
              {twoFactor.enabled ? (
                <Badge>مفعّل</Badge>
              ) : (
                <Badge variant="secondary">غير مفعّل</Badge>
              )}
            </dd>
            {twoFactor.enabled && (
              <>
                <dt className="text-muted-foreground">فُعّل في</dt>
                <dd className="tabular-nums">{formatDateTime(twoFactor.enabledAt)}</dd>
                <dt className="text-muted-foreground">رموز الاسترداد المتبقية</dt>
                <dd className="tabular-nums">{twoFactor.recoveryRemaining} من 10</dd>
              </>
            )}
          </dl>
          {twoFactor.enabled && self && (
            <p className="mt-4 text-xs text-muted-foreground">
              هذا حسابك؛ أدِر التحقق بخطوتين من صفحة الملف الشخصي.
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="mt-6 border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert size={16} />
            إجراءات حساسة
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            تُنهي هذه الإجراءات وصول المستخدم أو تمنحك صلاحياته، وتُسجَّل جميعها في سجل النشاط.
          </p>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <DangerRow
            description={
              user.disabledAt
                ? 'يعيد للمستخدم إمكانية الدخول بأدواره الحالية.'
                : 'يمنع المستخدم من الدخول وينهي وصوله. لا يمكن تعطيل آخر مدير نشط.'
            }
          >
            {user.disabledAt ? (
              <Button variant="outline" onClick={() => post(`${base}/enable`)}>
                <UserCheck size={16} />
                تفعيل الحساب
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() =>
                  confirm({
                    title: 'تعطيل الحساب؟',
                    description: 'سيفقد المستخدم الوصول إلى النظام. لا يمكن تعطيل آخر مدير نشط.',
                    destructive: true,
                    action: () => post(`${base}/disable`),
                  })
                }
              >
                <UserMinus size={16} />
                تعطيل الحساب
              </Button>
            )}
          </DangerRow>
          <DangerRow description="يُطلب منه تسجيل الدخول مجددًا على كل الأجهزة، وتُلغى رموز الوصول الخاصة به.">
            <Button
              variant="outline"
              onClick={() =>
                confirm({
                  title: 'إنهاء جميع الجلسات؟',
                  description:
                    'سيُطلب من هذا المستخدم تسجيل الدخول مجددًا، وتُلغى رموز الوصول الخاصة به.',
                  destructive: true,
                  action: () => post(`${base}/revoke-sessions`),
                })
              }
            >
              <KeyRound size={16} />
              إنهاء الجلسات
            </Button>
          </DangerRow>
          <DangerRow description="تتوقف رموز الوصول البرمجي لهذا المستخدم فورًا، ولا يمكن التراجع.">
            <Button
              variant="outline"
              disabled={tokens.length === 0}
              onClick={() =>
                confirm({
                  title: 'إلغاء جميع رموز الوصول؟',
                  description: `ستتوقف ${tokens.length} من الرموز عن العمل فورًا، ولا يمكن التراجع.`,
                  destructive: true,
                  action: () => post(`${base}/revoke-tokens`),
                })
              }
            >
              <Ban size={16} />
              إلغاء جميع الرموز
            </Button>
          </DangerRow>
          {twoFactor.enabled && !self && (
            <DangerRow description="لجهاز مفقود: يحذف تطبيق المصادقة ورموز الاسترداد وينهي جلساته. تحقّق من هويته أولًا.">
              <Button
                variant="outline"
                onClick={() =>
                  confirm({
                    title: 'إعادة ضبط التحقق بخطوتين؟',
                    description:
                      'يُحذف تطبيق المصادقة ورموز الاسترداد لهذا المستخدم، وتنتهي جميع جلساته ورموز الوصول البرمجي الخاصة به فورًا. سيدخل بعدها بكلمة المرور وحدها ثم يفعّل التحقق من جديد. استخدمها فقط بعد التأكد من هويته.',
                    destructive: true,
                    label: 'إعادة الضبط وإنهاء الجلسات',
                    action: () => post(`${base}/reset-two-factor`),
                  })
                }
              >
                <ShieldOff size={16} />
                إعادة ضبط التحقق
              </Button>
            </DangerRow>
          )}
          {!self && (
            <DangerRow description="تتصفح النظام بصلاحياته لتشخيص مشكلة. يُطلب سبب مكتوب، ويُسجَّل البدء والمدة.">
              <Button
                variant="outline"
                disabled={Boolean(user.disabledAt)}
                onClick={() => setImpersonating(true)}
              >
                <UserCog size={16} />
                انتحال الحساب
              </Button>
            </DangerRow>
          )}
        </CardContent>
      </Card>
      <ImpersonationDialog
        open={impersonating}
        onOpenChange={setImpersonating}
        url={`${base}/impersonate`}
        name={user.fullName || user.email}
      />
      {confirmation}
    </>
  )
}

/** One access-ending action with the line that explains its effect. */
function DangerRow({ description, children }: { description: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <p className="max-w-xl text-sm text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}
UserShow.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
