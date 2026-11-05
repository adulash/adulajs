import { Head, router, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { useState, type ReactElement } from 'react'
import {
  ArrowLeft,
  ArrowDownUp,
  ClipboardList,
  Download,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Badge } from '~/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import Workspace from '~/layouts/workspace'
import type { ResourceList } from 'adula'

type Props = { result: ResourceList; canCreate: boolean; canEdit: boolean; showTotal: boolean }
const date = (value: unknown) =>
  typeof value === 'string'
    ? new Intl.DateTimeFormat('ar', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(value))
    : '—'
function money(value: unknown) {
  if (value === null || value === undefined) return '—'
  const minor = BigInt(String(value))
  const absolute = minor < 0n ? -minor : minor
  return `${minor < 0n ? '-' : ''}${new Intl.NumberFormat('en').format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`
}

export default function Orders({ result, canCreate, canEdit, showTotal }: Props) {
  const page = usePage()
  const query = new URL(page.url, 'http://localhost').searchParams
  const [search, setSearch] = useState(query.get('search') ?? '')
  const navigate = (values: Record<string, string | undefined>) => {
    const next = new URLSearchParams(query)
    next.delete('cursor')
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    router.get(
      `/resources/orders?${next.toString()}`,
      {},
      { preserveState: true, preserveScroll: true }
    )
  }
  const customers = new Map(
    (result.related.customerId ?? []).map((row) => [String(row.id), String(row.name)])
  )
  const csv = () => {
    const quote = (value: unknown) =>
      `"${String(value ?? '')
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`
    const rows = [
      ['رقم الطلب', 'العميل', 'الحالة', ...(showTotal ? ['الإجمالي'] : []), 'تاريخ الإصدار'],
      ...result.data.map((row) => [
        row.number,
        customers.get(String(row.customerId)) ?? '',
        row.docStatus === 1 ? 'معتمد' : row.docStatus === 2 ? 'ملغي' : 'مسودة',
        ...(showTotal ? [money(row.total)] : []),
        row.issuedAt,
      ]),
    ]
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + rows.map((row) => row.map(quote).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'الطلبات.csv'
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <>
      <Head title="الطلبات" />
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <ClipboardList size={15} />
            <span>إدارة الأعمال</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">الطلبات</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            تابع طلباتك من أول مسودة حتى الاعتماد.
          </p>
        </div>
        <div className="flex gap-2 pt-3">
          <Button variant="outline" onClick={csv} disabled={!result.data.length}>
            <Download size={16} />
            تصدير المعروض
          </Button>
          {canCreate && (
            <Button asChild>
              <Link href="/resources/orders/create">
                <Plus size={17} />
                طلب جديد
              </Link>
            </Button>
          )}
        </div>
      </div>
      <section
        className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_2px_10px_color-mix(in_oklab,var(--foreground)_2%,transparent)]"
        aria-label="قائمة الطلبات"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">سجل الطلبات</h2>
            <Badge variant="secondary" className="font-normal tabular-nums">
              {result.data.length} معروض
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {result.meta.estimatedTotal !== undefined
              ? `نحو ${result.meta.estimatedTotal} سجل ضمن نطاقك`
              : 'حسب نطاق صلاحياتك'}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <form
            className="relative w-full max-w-sm"
            onSubmit={(event) => {
              event.preventDefault()
              navigate({ search })
            }}
          >
            <Search
              className="pointer-events-none absolute start-3 top-3 text-muted-foreground"
              size={16}
            />
            <Input
              aria-label="البحث في ملاحظات الطلبات"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث في الملاحظات..."
              className="h-10 bg-background/60 ps-10 text-xs"
            />
          </form>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <SlidersHorizontal size={15} />
            <label htmlFor="order-status-filter">الحالة</label>
            <select
              id="order-status-filter"
              className="rounded-md border border-border bg-card px-3 py-2 text-xs"
              value={query.get('filters[status]') ?? ''}
              onChange={(event) => navigate({ 'filters[status]': event.target.value || undefined })}
            >
              <option value="">جميع الحالات</option>
              <option value="open">مفتوح</option>
              <option value="closed">مغلق</option>
            </select>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-background/70 hover:bg-background/70">
              <TableHead className="ps-6 text-xs">رقم الطلب</TableHead>
              <TableHead className="text-xs">العميل</TableHead>
              <TableHead className="text-xs">دورة المستند</TableHead>
              <TableHead className="text-xs">الحالة</TableHead>
              <TableHead className="text-xs">
                <button
                  className="flex items-center gap-2"
                  onClick={() =>
                    navigate({
                      sort: 'issuedAt',
                      direction: query.get('direction') === 'asc' ? 'desc' : 'asc',
                    })
                  }
                >
                  تاريخ الإصدار
                  <ArrowDownUp size={13} />
                </button>
              </TableHead>
              {showTotal && <TableHead className="text-end text-xs">الإجمالي</TableHead>}
              <TableHead className="pe-6">
                <span className="sr-only">الإجراء</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.map((row) => (
              <TableRow key={String(row.id)} className="h-[72px]">
                <TableCell className="ps-6 font-medium tabular-nums" dir="ltr">
                  {String(row.number)}
                </TableCell>
                <TableCell className="max-w-[260px] whitespace-normal text-xs font-medium">
                  {customers.get(String(row.customerId)) ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={row.docStatus === 1 ? 'default' : 'secondary'}
                    className={`text-[10px] font-medium ${row.docStatus === 2 ? 'bg-destructive/10 text-destructive' : ''}`}
                  >
                    {row.docStatus === 1 ? 'معتمد' : row.docStatus === 2 ? 'ملغي' : 'مسودة'}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.status === 'open' ? 'مفتوح' : row.status === 'closed' ? 'مغلق' : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {date(row.issuedAt)}
                </TableCell>
                {showTotal && (
                  <TableCell className="text-end font-medium tabular-nums">
                    <span dir="ltr">{money(row.total)}</span>
                  </TableCell>
                )}
                <TableCell className="pe-6 text-end">
                  {canEdit && row.docStatus === 0 ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link
                        href={`/resources/orders/${row.id}/edit`}
                        aria-label={`تعديل الطلب ${row.number}`}
                      >
                        تعديل
                        <ArrowLeft size={14} />
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">مقفل</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!result.data.length && (
          <div className="py-20 text-center">
            <ClipboardList
              className="mx-auto mb-4 text-muted-foreground"
              size={32}
              strokeWidth={1.3}
            />
            <p className="text-sm font-medium">لا توجد طلبات مطابقة</p>
            <p className="mt-2 text-xs text-muted-foreground">غيّر البحث أو أضف طلبك الأول.</p>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border px-6 py-4 text-xs text-muted-foreground">
          <span>حتى {result.meta.limit} طلب في الصفحة</span>
          {result.meta.nextCursor ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate({
                  cursor: result.meta.nextCursor!,
                  sort: query.get('sort') || undefined,
                  direction: query.get('direction') || undefined,
                })
              }
            >
              الصفحة التالية
              <ArrowLeft size={14} />
            </Button>
          ) : (
            <span>نهاية النتائج</span>
          )}
        </div>
      </section>
    </>
  )
}
Orders.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
