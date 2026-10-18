import { useState, type FormEvent, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { ArrowRight, Ban, KeyRound, UserCog, UserMinus, UserCheck, X } from 'lucide-react'
import type { OrgUnitNode, RoleSummary, UserSummary } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader, useDateTimeFormatter } from '~/components/admin-nav'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { Label } from '~/components/ui/label'
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
  user: UserSummary
  roles: RoleSummary[]
  orgUnits: OrgUnitNode[]
  tokens: TokenSummary[]
}
/** Indents nested units in a flat list so the hierarchy stays readable. */
const unitOption = (unit: OrgUnitNode) => ({
  value: String(unit.id),
  label: `${'· '.repeat(unit.depth - 1)}${unit.name}`,
})

export default function UserShow({ user, roles, orgUnits, tokens }: Props) {
  const formatDateTime = useDateTimeFormatter()
  const { confirm, confirmation } = useConfirmAction()
  const [roleId, setRoleId] = useState(roles[0] ? String(roles[0].id) : '')
  const [roleUnit, setRoleUnit] = useState('')
  const [unitId, setUnitId] = useState('')
  const base = `/admin/users/${user.id}`
  const post = (url: string, data: Record<string, string | number | null> = {}) =>
    router.post(url, data, { preserveScroll: true })
  const assignRole = (event: FormEvent) => {
    event.preventDefault()
    confirm({
      title: 'إسناد الدور؟',
      description: 'ستتغير الصلاحيات المتاحة لهذا المستخدم فورًا.',
      action: () => post(`${base}/roles`, { roleId, orgUnitId: roleUnit || null }),
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
      <AdminHeader title={user.fullName || user.email} description={user.email}>
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
        <Button
          variant="outline"
          onClick={() =>
            confirm({
              title: 'إنهاء جميع الجلسات؟',
              description: 'سيُطلب من هذا المستخدم تسجيل الدخول مجددًا، وتُلغى رموز الوصول الخاصة به.',
              destructive: true,
              action: () => post(`${base}/revoke-sessions`),
            })
          }
        >
          <KeyRound size={16} />
          إنهاء الجلسات
        </Button>
        <Button
          variant="outline"
          disabled={Boolean(user.disabledAt)}
          onClick={() => post(`${base}/impersonate`)}
        >
          <UserCog size={16} />
          انتحال الحساب
        </Button>
      </AdminHeader>
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
                  options={roles.map((role) => ({ value: String(role.id), label: role.name }))}
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
                    <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                      {unit.path}
                    </span>
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
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>رموز الوصول البرمجي</CardTitle>
          <Button
            variant="outline"
            size="sm"
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
      {confirmation}
    </>
  )
}
UserShow.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
