import { useState, type FormEvent, type ReactElement } from 'react'
import { Head, router, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { Search } from 'lucide-react'
import type { UserPage } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
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

type Props = { users: UserPage; search: string }

export default function UsersIndex({ users, search }: Props) {
  const { canInviteUsers } = usePage<{ canInviteUsers?: boolean }>().props
  const [term, setTerm] = useState(search)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    router.get('/admin/users', term ? { q: term } : {}, { preserveState: true })
  }
  const next = users.nextCursor
    ? `/admin/users?cursor=${users.nextCursor}${search ? `&q=${encodeURIComponent(search)}` : ''}`
    : null
  return (
    <>
      <Head title="المستخدمون" />
      <AdminHeader title="المستخدمون" description="الأدوار والوحدات وحالة الحساب لكل مستخدم.">
        {canInviteUsers && (
          <Button asChild>
            <Link href="/users/invite">إضافة مستخدم</Link>
          </Button>
        )}
      </AdminHeader>
      <form onSubmit={submit} role="search" className="mb-6 flex flex-wrap gap-2">
        <Input
          aria-label="البحث عن مستخدم"
          placeholder="البريد أو الاسم"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="max-w-sm bg-white"
        />
        <Button type="submit" variant="outline">
          <Search size={16} />
          بحث
        </Button>
      </form>
      <section className="overflow-hidden rounded-xl border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المستخدم</TableHead>
              <TableHead>الأدوار</TableHead>
              <TableHead>الوحدات</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <strong className="block">{user.fullName || '—'}</strong>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {user.email}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {user.roles.length === 0 && (
                      <span className="text-xs text-muted-foreground">بلا أدوار</span>
                    )}
                    {user.roles.map((role) => (
                      <Badge key={role.id} variant="secondary">
                        {role.role}
                        {role.orgUnit ? ` · ${role.orgUnit}` : ''}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {user.orgUnits.map((unit) => (
                      <Badge key={unit.id} variant="outline">
                        {unit.name}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell>
                  {user.disabledAt ? (
                    <Badge variant="destructive">معطّل</Badge>
                  ) : (
                    <Badge>نشط</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/admin/users/${user.id}`}>تفاصيل</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {users.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  لا يوجد مستخدمون مطابقون.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {next && (
          <div className="border-t border-border p-4 text-center">
            <Button asChild variant="outline">
              <Link href={next}>الصفحة التالية</Link>
            </Button>
          </div>
        )}
      </section>
    </>
  )
}
UsersIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
