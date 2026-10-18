import { useState, type FormEvent, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { ArrowRight, Check, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react'
import type { MatrixField, MatrixSubject, RoleDetail, RoleMatrix, RoleRule } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Badge } from '~/components/ui/badge'
import { Checkbox } from '~/components/ui/checkbox'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { ResourceSelect } from '~/components/ui/resource-field'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

type Props = { role: RoleDetail; matrix: RoleMatrix }
type Predicate = { field: string; operator: string; value: string }
type Scalar = string | number | boolean | null

export const ACTION_LABELS: Record<string, string> = {
  view: 'عرض',
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  submit: 'اعتماد',
  cancel: 'إلغاء',
  amend: 'تعديل معتمد',
  manage: 'إدارة كاملة',
  invite: 'دعوة مستخدم',
}
const OPERATORS: [string, string][] = [
  ['$eq', 'يساوي'],
  ['$ne', 'لا يساوي'],
  ['$in', 'ضمن قائمة'],
  ['$lt', 'أصغر من'],
  ['$gt', 'أكبر من'],
  ['$like', 'يشبه'],
]
const NUMERIC = new Set(['integer', 'belongsTo', 'user'])
/** Replaced by the signed-in user's id when rules are evaluated. */
const CURRENT_USER = '$actor.id'

function convert(field: MatrixField | undefined, operator: string, raw: string): Scalar | Scalar[] {
  const one = (text: string): Scalar => {
    const value = text.trim()
    if (value === 'null') return null
    if (value === CURRENT_USER && field?.actor) return CURRENT_USER
    if (field?.type === 'boolean') return value === 'true'
    if (field && NUMERIC.has(field.type)) return Number(value)
    return value
  }
  return operator === '$in' ? raw.split(',').map(one) : one(raw)
}
function toPredicates(conditions: RoleRule['conditions']): Predicate[] {
  return Object.entries(conditions ?? {}).flatMap(([field, condition]) =>
    condition !== null && typeof condition === 'object'
      ? Object.entries(condition).map(([operator, value]) => ({
          field,
          operator,
          value: Array.isArray(value) ? value.join(',') : String(value),
        }))
      : [{ field, operator: '$eq', value: String(condition) }]
  )
}
const subjectLabel = (matrix: RoleMatrix, name: string) =>
  matrix.subjects.find((subject) => subject.name === name)?.label.ar ?? name

function RuleEditor({
  role,
  rule,
  subject,
  onClose,
}: {
  role: RoleDetail
  rule: RoleRule
  subject: MatrixSubject
  onClose: () => void
}) {
  const { confirm, confirmation } = useConfirmAction()
  const [predicates, setPredicates] = useState<Predicate[]>(toPredicates(rule.conditions))
  const [fields, setFields] = useState<string[]>(rule.fields ?? [])
  const editable = subject.conditionFields.length > 0
  const update = (index: number, patch: Partial<Predicate>) =>
    setPredicates((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const save = (event: FormEvent) => {
    event.preventDefault()
    const conditions: Record<string, Record<string, Scalar | Scalar[]>> = {}
    for (const predicate of predicates) {
      if (!predicate.field) continue
      conditions[predicate.field] = {
        ...(conditions[predicate.field] ?? {}),
        [predicate.operator]: convert(
          subject.conditionFields.find((field) => field.key === predicate.field),
          predicate.operator,
          predicate.value
        ),
      }
    }
    confirm({
      title: 'حفظ تغييرات الصلاحية؟',
      description:
        'تُطبّق هذه التغييرات على جميع مستخدمي الدور فورًا. راجع الشروط والحقول قبل المتابعة.',
      action: () =>
        router.put(
          `/admin/roles/${role.id}/rules`,
          {
            subject: rule.subject,
            action: rule.action,
            inverted: rule.inverted,
            conditions,
            fields,
          },
          {
            preserveScroll: true,
            preserveState: true,
            onSuccess: (page) => {
              if (!(page as unknown as { flash?: { error?: string } }).flash?.error) onClose()
            },
          }
        ),
    })
  }
  return (
    <>
      <Dialog mode={editable ? 'edit' : 'view'} open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={save} className="space-y-6">
            <DialogHeader>
              <DialogTitle>
                {rule.inverted ? 'منع' : 'سماح'}: {subject.label.ar} / {ACTION_LABELS[rule.action]}
              </DialogTitle>
              <DialogDescription>
                {editable
                  ? 'الشروط تُقيّد القاعدة بسجلات محددة، وقائمة الحقول تحصرها في حقول بعينها.'
                  : 'الشروط والحقول تتطلب اختيار كيان محدد بدلاً من كل الكيانات.'}
              </DialogDescription>
            </DialogHeader>
            {editable && (
              <>
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold">الشروط</legend>
                  {predicates.map((predicate, index) => (
                    <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                      <ResourceSelect
                        aria-label={`حقل الشرط ${index + 1}`}
                        value={predicate.field}
                        onChange={(field) =>
                          update(index, {
                            field,
                            // Only user fields and the creator/updater take the current user.
                            ...(predicate.value === CURRENT_USER &&
                            !subject.conditionFields.find((entry) => entry.key === field)?.actor
                              ? { value: '' }
                              : {}),
                          })
                        }
                        options={subject.conditionFields.map((field) => ({
                          value: field.key,
                          label: field.label.ar,
                        }))}
                        placeholder="اختر حقلاً"
                      />
                      <ResourceSelect
                        aria-label={`عامل الشرط ${index + 1}`}
                        value={predicate.operator}
                        onChange={(operator) => update(index, { operator })}
                        options={OPERATORS.map(([value, label]) => ({ value, label }))}
                      />
                      {(() => {
                        const field = subject.conditionFields.find(
                          (entry) => entry.key === predicate.field
                        )
                        const current = predicate.value === CURRENT_USER
                        return (
                          <div className="flex gap-1">
                            <Input
                              aria-label={`قيمة الشرط ${index + 1}`}
                              value={current ? 'المستخدم الحالي' : predicate.value}
                              readOnly={current}
                              placeholder={
                                predicate.operator === '$in' ? 'قيم مفصولة بفواصل' : 'القيمة'
                              }
                              onChange={(event) => update(index, { value: event.target.value })}
                            />
                            {field?.actor && predicate.operator !== '$in' && (
                              <Button
                                type="button"
                                size="icon"
                                variant={current ? 'default' : 'outline'}
                                aria-pressed={current}
                                aria-label={`المستخدم الحالي للشرط ${index + 1}`}
                                title="المستخدم الحالي: يُستبدل بمعرّف من يستخدم النظام"
                                onClick={() => update(index, { value: current ? '' : CURRENT_USER })}
                              >
                                <UserRound size={15} />
                              </Button>
                            )}
                          </div>
                        )
                      })()}
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`إزالة الشرط ${index + 1}`}
                        onClick={() => setPredicates((rows) => rows.filter((_, i) => i !== index))}
                      >
                        <X size={15} />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPredicates((rows) => [...rows, { field: '', operator: '$eq', value: '' }])
                    }
                  >
                    <Plus size={14} />
                    إضافة شرط
                  </Button>
                </fieldset>
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold">الحقول المسموح بها</legend>
                  <p className="text-xs text-muted-foreground">
                    اتركها فارغة لتشمل القاعدة كل الحقول.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {subject.fields.map((field) => (
                      <label key={field.key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={fields.includes(field.key)}
                          onCheckedChange={(checked) =>
                            setFields((current) =>
                              checked
                                ? [...current, field.key]
                                : current.filter((key) => key !== field.key)
                            )
                          }
                        />
                        {field.label.ar}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                إلغاء
              </Button>
              {editable && <Button type="submit">حفظ القاعدة</Button>}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {confirmation}
    </>
  )
}

export default function RoleShow({ role, matrix }: Props) {
  const { confirm, confirmation } = useConfirmAction()
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(role.name)
  const [key, setKey] = useState(role.key ?? '')
  const [editing, setEditing] = useState<RoleRule | null>(null)
  const ruleFor = (subject: string, action: string, inverted: boolean) =>
    role.rules.find(
      (rule) => rule.subject === subject && rule.action === action && rule.inverted === inverted
    )
  const options = {
    preserveScroll: true,
    preserveState: true,
    onStart: () => setBusy(true),
    onFinish: () => setBusy(false),
  }
  const removeRule = (rule: RoleRule) =>
    confirm({
      title: 'حذف الصلاحية؟',
      description: `سيُحذف ${rule.inverted ? 'المنع' : 'السماح'}: ${subjectLabel(matrix, rule.subject)} / ${ACTION_LABELS[rule.action]}. يتأثر جميع مستخدمي الدور فورًا. لا يسمح النظام بإزالة آخر مدير أو صلاحيات إدارتك الحالية.`,
      destructive: true,
      label: 'تأكيد حذف الصلاحية',
      action: () => router.delete(`/admin/roles/${role.id}/rules/${rule.id}`, options),
    })
  const toggle = (subject: string, action: string, inverted: boolean) => {
    const existing = ruleFor(subject, action, inverted)
    if (existing) removeRule(existing)
    else
      confirm({
        title: inverted ? 'إضافة منع؟' : 'إضافة صلاحية؟',
        description: `${subjectLabel(matrix, subject)} / ${ACTION_LABELS[action]}. ${inverted ? 'المنع يتقدم على السماح وقد يمنع مستخدمي الدور من الوصول.' : 'سيحصل مستخدمو الدور على هذا الإجراء.'}`,
        destructive: inverted,
        action: () =>
          router.put(`/admin/roles/${role.id}/rules`, { subject, action, inverted }, options),
      })
  }
  const rename = (event: FormEvent) => {
    event.preventDefault()
    router.patch(`/admin/roles/${role.id}`, { name }, options)
  }
  const assignKey = (event: FormEvent) => {
    event.preventDefault()
    confirm({
      title: 'تعيين المفتاح الثابت؟',
      description: `تشير تدفقات العمل والتطبيقات إلى الدور بالمفتاح ${key}. لا يمكن تغييره بعد تعيينه، ويبقى تغيير الاسم ممكنًا.`,
      action: () => router.patch(`/admin/roles/${role.id}`, { key }, options),
    })
  }
  const cell = (active: boolean, kind: 'allow' | 'deny') =>
    `grid size-7 place-items-center rounded-md border transition-colors ${
      active
        ? kind === 'allow'
          ? 'border-primary bg-primary text-white'
          : 'border-destructive bg-destructive text-white'
        : 'border-border text-muted-foreground hover:bg-background'
    }`
  const editingSubject = editing
    ? matrix.subjects.find((subject) => subject.name === editing.subject)
    : undefined
  return (
    <>
      <Head title={role.name} />
      <Link
        href="/admin/roles"
        className="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground"
      >
        <ArrowRight size={15} />
        العودة إلى الأدوار
      </Link>
      <AdminHeader title={role.name} description={`${role.users} مستخدم يحمل هذا الدور`} />
      <Alert className="mb-6">
        <AlertTitle>حماية الوصول الإداري مفعّلة</AlertTitle>
        <AlertDescription>
          كل تغيير للصلاحيات يتطلب تأكيدًا. لا يمكن إزالة آخر مدير نشط أو سحب إدارة النظام من حسابك
          الحالي.
        </AlertDescription>
      </Alert>
      <form
        onSubmit={rename}
        className="mb-6 grid gap-3 rounded-xl border border-border bg-white p-5 md:grid-cols-[1fr_160px_auto]"
      >
        <div className="space-y-1">
          <Label htmlFor="role-name">اسم الدور</Label>
          <Input
            id="role-name"
            value={name}
            disabled={role.name === 'administrator' || busy}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="role-level">مستوى الصلاحية</Label>
          <ResourceSelect
            id="role-level"
            aria-label="مستوى الصلاحية"
            value={String(role.permissionLevel)}
            disabled={busy}
            options={Array.from({ length: 10 }, (_, level) => ({
              value: String(level),
              label: String(level),
            }))}
            onChange={(value) =>
              confirm({
                title: 'تغيير مستوى الصلاحية؟',
                description: 'سيؤثر هذا التغيير على الحقول المتاحة لجميع مستخدمي الدور.',
                action: () =>
                  router.patch(
                    `/admin/roles/${role.id}`,
                    { permissionLevel: Number(value) },
                    options
                  ),
              })
            }
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          className="self-end"
          disabled={role.name === 'administrator' || busy}
        >
          حفظ الاسم
        </Button>
      </form>
      <form
        onSubmit={assignKey}
        className="mb-6 grid gap-3 rounded-xl border border-border bg-white p-5 md:grid-cols-[1fr_auto]"
      >
        <div className="space-y-1">
          <Label htmlFor="role-key">المفتاح الثابت</Label>
          <Input
            id="role-key"
            dir="ltr"
            placeholder="project_manager"
            pattern="[a-z][a-z0-9_]*"
            value={key}
            disabled={Boolean(role.key) || busy}
            onChange={(event) => setKey(event.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            {role.key
              ? 'تشير تدفقات العمل إلى الدور بهذا المفتاح، لذلك يبقى ثابتًا عند تغيير الاسم.'
              : 'عيّن مفتاحًا لتشير إليه تدفقات العمل بدل الاسم القابل للتغيير. يُعيَّن مرة واحدة.'}
          </p>
        </div>
        {!role.key && (
          <Button type="submit" variant="outline" className="self-start md:mt-6" disabled={busy}>
            تعيين المفتاح
          </Button>
        )}
      </form>
      <section className="mb-8 overflow-hidden rounded-xl border border-border bg-white">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">مصفوفة الصلاحيات</h2>
          <span className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="grid size-4 place-items-center rounded bg-primary text-white">
                <Check size={10} />
              </span>
              سماح
            </span>
            <span className="flex items-center gap-1">
              <span className="grid size-4 place-items-center rounded bg-destructive text-white">
                <X size={10} />
              </span>
              منع (يتقدم على السماح)
            </span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الكيان</TableHead>
                {matrix.actions.map((action) => (
                  <TableHead key={action} className="text-center">
                    {ACTION_LABELS[action] ?? action}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.subjects.map((subject) => (
                <TableRow key={subject.name}>
                  <TableCell className="font-medium">{subject.label.ar}</TableCell>
                  {matrix.actions.map((action) => {
                    if (!subject.actions.includes(action))
                      return (
                        <TableCell key={action} className="text-center text-muted-foreground">
                          —
                        </TableCell>
                      )
                    const allow = ruleFor(subject.name, action, false)
                    const deny = ruleFor(subject.name, action, true)
                    return (
                      <TableCell key={action} className="text-center">
                        <span className="inline-flex gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            disabled={busy}
                            aria-pressed={Boolean(allow)}
                            aria-label={`سماح: ${subject.label.ar} / ${ACTION_LABELS[action]}`}
                            className={cell(Boolean(allow), 'allow')}
                            onClick={() => toggle(subject.name, action, false)}
                          >
                            <Check size={14} />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            disabled={busy}
                            aria-pressed={Boolean(deny)}
                            aria-label={`منع: ${subject.label.ar} / ${ACTION_LABELS[action]}`}
                            className={cell(Boolean(deny), 'deny')}
                            onClick={() => toggle(subject.name, action, true)}
                          >
                            <X size={14} />
                          </Button>
                        </span>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold">القواعد وشروطها</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            أضف شروطاً أو احصر القاعدة في حقول محددة؛ تُرفض الشروط غير المدعومة صراحةً.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الكيان</TableHead>
              <TableHead>الإجراء</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>الشروط</TableHead>
              <TableHead>الحقول</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {role.rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>{subjectLabel(matrix, rule.subject)}</TableCell>
                <TableCell>{ACTION_LABELS[rule.action] ?? rule.action}</TableCell>
                <TableCell>
                  {rule.inverted ? <Badge variant="destructive">منع</Badge> : <Badge>سماح</Badge>}
                </TableCell>
                <TableCell>
                  <code className="text-xs" dir="ltr">
                    {rule.conditions
                      ? JSON.stringify(rule.conditions).replaceAll(
                          JSON.stringify(CURRENT_USER),
                          'المستخدم الحالي'
                        )
                      : '—'}
                  </code>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {rule.fields?.map((field) => (
                      <Badge key={field} variant="outline">
                        {field}
                      </Badge>
                    )) ?? <span className="text-muted-foreground">كل الحقول</span>}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`${rule.subject === 'all' ? 'تفاصيل' : 'تحرير'} قاعدة ${subjectLabel(matrix, rule.subject)} / ${ACTION_LABELS[rule.action]}`}
                      onClick={() => setEditing(rule)}
                    >
                      <Pencil size={15} />
                      {rule.subject === 'all' ? 'تفاصيل' : 'تحرير'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={busy}
                      aria-label={`حذف قاعدة ${subjectLabel(matrix, rule.subject)} / ${ACTION_LABELS[rule.action]}`}
                      onClick={() => removeRule(rule)}
                    >
                      <Trash2 size={15} />
                      حذف
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {role.rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  لا قواعد بعد؛ فعّل خلية في المصفوفة أعلاه.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
      {editing && editingSubject && (
        <RuleEditor
          role={role}
          rule={editing}
          subject={editingSubject}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmation}
    </>
  )
}
RoleShow.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
