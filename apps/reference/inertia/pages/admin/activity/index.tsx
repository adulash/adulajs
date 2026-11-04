import { useState, type FormEvent, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import axios from 'axios'
import { Filter } from 'lucide-react'
import type { ActivityPage } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader, useDateTimeFormatter } from '~/components/admin-nav'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { ResourceSelect } from '~/components/ui/resource-field'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

type Filters = { resource: string; action: string; actorId: string; from: string; to: string }
/** One changed field, already formatted by the server; values are null when withheld. */
type FieldChange = {
  field: string
  label: string
  before: string | null
  after: string | null
  withheld?: true
}
/** A stored activity row with the names the server adds for reading. */
type Row = ActivityPage['data'][number] & {
  resourceLabel: string
  actionLabel: string
  recordTitle: string | null
  actorName: string | null
  fieldChanges: FieldChange[]
}
type Page = { data: Row[]; nextCursor: string | null }
type Props = {
  activity: Page
  facets: {
    resources: string[]
    actions: string[]
    labels: { resources: Record<string, string>; actions: Record<string, string> }
    actors: { id: number; name: string }[]
  }
  filters: Filters
}

/** Old rows and events without field differences: the stored keys, briefly. */
function StoredChanges({ changes }: { changes: Record<string, unknown> | null }) {
  const entries = Object.entries(changes ?? {}).filter(
    ([key, value]) => key !== 'fields' && value !== null && value !== undefined
  )
  const fields = Array.isArray(changes?.fields) ? (changes.fields as unknown[]).map(String) : []
  if (!entries.length && !fields.length) return <span className="text-muted-foreground">—</span>
  return (
    <div className="space-y-1">
      {fields.length > 0 && <p className="text-xs">الحقول: {fields.join('، ')}</p>}
      {entries.length > 0 && (
        <code className="line-clamp-2 max-w-md text-xs" dir="ltr">
          {JSON.stringify(Object.fromEntries(entries))}
        </code>
      )}
    </div>
  )
}

/** «label: before ← after» for each changed field, in reading order. */
function FieldChanges({ changes }: { changes: FieldChange[] }) {
  return (
    <ul className="space-y-1 text-xs">
      {changes.map((change) => (
        <li key={change.field}>
          <span className="font-medium">{change.label}:</span>{' '}
          {change.withheld ? (
            <span className="text-muted-foreground">قيمة محمية</span>
          ) : (
            <>
              <span className="text-muted-foreground">{change.before ?? '—'}</span>
              {' ← '}
              <span>{change.after ?? '—'}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function ActivityIndex({ activity, facets, filters }: Props) {
  const formatDateTime = useDateTimeFormatter()
  const [draft, setDraft] = useState<Filters>(filters)
  const [rows, setRows] = useState(activity.data)
  const [cursor, setCursor] = useState(activity.nextCursor)
  const [loading, setLoading] = useState(false)
  const set = (key: keyof Filters, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const apply = (event: FormEvent) => {
    event.preventDefault()
    const query = Object.fromEntries(Object.entries(draft).filter(([, value]) => value))
    router.get('/admin/activity', query, { preserveState: false })
  }
  const more = async () => {
    if (!cursor) return
    setLoading(true)
    try {
      const response = await axios.get<Page>('/admin/activity', {
        params: { ...filters, cursor },
        headers: { Accept: 'application/json' },
      })
      setRows((current) => [...current, ...response.data.data])
      setCursor(response.data.nextCursor)
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <Head title="سجل النشاط" />
      <AdminHeader
        title="سجل النشاط"
        description="كل تغيير على السجلات والإدارة يُكتب داخل معاملته."
      />
      <form
        onSubmit={apply}
        className="mb-6 grid gap-3 rounded-xl border border-border bg-white p-5 md:grid-cols-6"
      >
        <div className="space-y-1">
          <Label htmlFor="filter-resource">الكيان</Label>
          <ResourceSelect
            id="filter-resource"
            className="h-9 w-full"
            value={draft.resource}
            placeholder="الكل"
            options={facets.resources.map((resource) => ({
              value: resource,
              label: facets.labels.resources[resource] ?? resource,
            }))}
            onChange={(value) => set('resource', value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-action">الإجراء</Label>
          <ResourceSelect
            id="filter-action"
            className="h-9 w-full"
            value={draft.action}
            placeholder="الكل"
            options={facets.actions.map((action) => ({
              value: action,
              label: facets.labels.actions[action] ?? action,
            }))}
            onChange={(value) => set('action', value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-actor">المنفّذ</Label>
          <ResourceSelect
            id="filter-actor"
            className="h-9 w-full"
            value={draft.actorId}
            placeholder="الكل"
            options={facets.actors.map((actor) => ({ value: String(actor.id), label: actor.name }))}
            onChange={(value) => set('actorId', value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-from">من تاريخ</Label>
          <Input
            id="filter-from"
            type="date"
            value={draft.from}
            onChange={(event) => set('from', event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-to">إلى تاريخ</Label>
          <Input
            id="filter-to"
            type="date"
            value={draft.to}
            onChange={(event) => set('to', event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" className="self-end">
          <Filter size={15} />
          تصفية
        </Button>
      </form>
      <section className="overflow-hidden rounded-xl border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الوقت</TableHead>
              <TableHead>الكيان</TableHead>
              <TableHead>السجل</TableHead>
              <TableHead>الإجراء</TableHead>
              <TableHead>المنفّذ</TableHead>
              <TableHead>التغييرات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {formatDateTime(row.createdAt)}
                </TableCell>
                <TableCell>{row.resourceLabel}</TableCell>
                <TableCell>
                  {row.recordTitle ?? ''}
                  {row.recordId !== null && (
                    <span className="ms-2 text-xs text-muted-foreground tabular-nums" dir="ltr">
                      #{row.recordId}
                    </span>
                  )}
                </TableCell>
                <TableCell>{row.actionLabel}</TableCell>
                <TableCell className="text-xs">
                  {row.actorName ?? row.actor ?? row.actorId}
                </TableCell>
                <TableCell>
                  {row.fieldChanges.length > 0 ? (
                    <FieldChanges changes={row.fieldChanges} />
                  ) : (
                    <StoredChanges changes={row.changes as Record<string, unknown> | null} />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  لا نشاط مطابق.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {cursor && (
          <div className="border-t border-border p-4 text-center">
            <Button variant="outline" onClick={more} disabled={loading}>
              {loading ? 'جارٍ التحميل…' : 'تحميل المزيد'}
            </Button>
          </div>
        )}
      </section>
    </>
  )
}
ActivityIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
