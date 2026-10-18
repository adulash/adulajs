import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { AtSign, Bell, BellOff, MessageSquare, Pencil, Tag, Trash2, X } from 'lucide-react'
import type { MentionCandidate, RecordCollaborationState, ResourceDescription } from 'adula'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useMessages } from '~/components/ui/messages'
import { formatDatetime } from '~/components/ui/resource-value'

const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }

function failure(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && error.response?.data?.error?.message
    ? String(error.response.data.error.message)
    : fallback
}

function shown(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Comments with mentions, following, tags and field history for one record.
 * The server re-authorizes the record on every request; this panel only renders
 * what the current user may read.
 */
export function RecordCollaboration({
  resource,
  id,
}: {
  resource: ResourceDescription
  id: number | string
}) {
  const { calendar } = useUiPreferences()
  const base = `/resources/${resource.name}/${id}`
  const [state, setState] = useState<RecordCollaborationState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<MentionCandidate[]>([])
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null)
  const [tagText, setTagText] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await axios.get<RecordCollaborationState>(`${base}/collaboration`, json)
      setState(response.data)
    } catch (caught) {
      setError(failure(caught, 'تعذر تحميل التعليقات.'))
    }
  }, [base])
  useEffect(() => {
    void load()
  }, [load])

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      return true
    } catch (caught) {
      setError(failure(caught, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }
  const { label } = useMessages()
  const fieldLabel = (key: string) => {
    const field = resource.fields.find((entry) => entry.key === key)
    return field ? label(field.label) : key
  }

  if (!state)
    return (
      <section aria-label="التعاون حول السجل" className="rounded-xl border bg-white p-7">
        <p className="text-xs text-muted-foreground" role="status">
          {error || 'جارٍ تحميل التعليقات…'}
        </p>
      </section>
    )

  return (
    <section aria-label="التعاون حول السجل" className="rounded-xl border bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b px-7 py-4">
        <MessageSquare size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">التعاون حول السجل</h2>
        <span className="text-xs text-muted-foreground">{state.followers} متابع</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ms-auto"
          disabled={busy}
          onClick={() =>
            run(
              () => axios.put(`${base}/follow`, { following: !state.following }, json),
              'تعذر تحديث المتابعة.'
            )
          }
        >
          {state.following ? <BellOff size={14} /> : <Bell size={14} />}
          {state.following ? 'إلغاء المتابعة' : 'متابعة السجل'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b px-7 py-3">
        <Tag size={14} className="text-muted-foreground" />
        {tagText === null ? (
          <>
            {state.tags.length ? (
              state.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">بلا وسوم</span>
            )}
            {state.canTag && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTagText(state.tags.join('، '))}
              >
                تعديل الوسوم
              </Button>
            )}
          </>
        ) : (
          <form
            className="flex flex-1 flex-wrap items-center gap-2"
            onSubmit={async (event) => {
              event.preventDefault()
              const tags = tagText
                .split(/[,،]/)
                .map((tag) => tag.trim())
                .filter(Boolean)
              if (await run(() => axios.put(`${base}/tags`, { tags }, json), 'تعذر حفظ الوسوم.'))
                setTagText(null)
            }}
          >
            <Input
              aria-label="الوسوم مفصولة بفواصل"
              className="max-w-sm flex-1"
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={busy}>
              حفظ الوسوم
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setTagText(null)}>
              إلغاء
            </Button>
          </form>
        )}
      </div>
      {error && (
        <p role="alert" className="border-b bg-red-50 px-7 py-3 text-xs text-red-800">
          {error}
        </p>
      )}
      <Tabs defaultValue="comments" className="px-7 py-5">
        <TabsList>
          <TabsTrigger value="comments">التعليقات ({state.comments.length})</TabsTrigger>
          <TabsTrigger value="changes">سجل التغييرات ({state.changes.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="comments" className="space-y-4 pt-4">
          {state.comments.length === 0 && (
            <p className="text-xs text-muted-foreground">لا توجد تعليقات بعد.</p>
          )}
          <ol className="space-y-3">
            {state.comments.map((comment) => (
              <li key={comment.id} className="rounded-lg border px-4 py-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {comment.authorName ?? `مستخدم #${comment.authorId}`}
                  </span>
                  <time dateTime={comment.createdAt} className="tabular-nums">
                    {formatDatetime(comment.createdAt, calendar)}
                  </time>
                  {comment.editedAt && <span>(معدّل)</span>}
                  {comment.own && editing?.id !== comment.id && (
                    <span className="ms-auto flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="تعديل التعليق"
                        onClick={() => setEditing({ id: comment.id, body: comment.body })}
                      >
                        <Pencil size={13} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="حذف التعليق"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => axios.delete(`${base}/comments/${comment.id}`, json),
                            'تعذر حذف التعليق.'
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </Button>
                    </span>
                  )}
                </div>
                {editing?.id === comment.id ? (
                  <form
                    className="space-y-2"
                    onSubmit={async (event) => {
                      event.preventDefault()
                      if (
                        await run(
                          () =>
                            axios.patch(
                              `${base}/comments/${comment.id}`,
                              { body: editing.body },
                              json
                            ),
                          'تعذر تعديل التعليق.'
                        )
                      )
                        setEditing(null)
                    }}
                  >
                    <Textarea
                      aria-label="نص التعليق المعدّل"
                      value={editing.body}
                      onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                    />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={busy}>
                        حفظ
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(null)}
                      >
                        إلغاء
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="text-sm whitespace-pre-wrap break-words">{comment.body}</p>
                )}
                {comment.mentions.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    إشارة إلى: {comment.mentions.map((user) => user.name).join('، ')}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {state.canComment && (
            <form
              className="space-y-2"
              onSubmit={async (event) => {
                event.preventDefault()
                if (
                  await run(
                    () =>
                      axios.post(
                        `${base}/comments`,
                        { body, mentions: mentions.map((user) => user.id) },
                        json
                      ),
                    'تعذر إضافة التعليق.'
                  )
                ) {
                  setBody('')
                  setMentions([])
                }
              }}
            >
              <Textarea
                aria-label="تعليق جديد"
                placeholder="اكتب تعليقاً…"
                value={body}
                maxLength={5000}
                onChange={(event) => setBody(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <MentionPicker
                  base={base}
                  onPick={(user) =>
                    setMentions((current) =>
                      current.some((entry) => entry.id === user.id) ? current : [...current, user]
                    )
                  }
                />
                {mentions.map((user) => (
                  <Badge key={user.id} variant="outline" className="gap-1">
                    @{user.name}
                    <button
                      type="button"
                      aria-label={`إزالة الإشارة إلى ${user.name}`}
                      onClick={() =>
                        setMentions((current) => current.filter((entry) => entry.id !== user.id))
                      }
                    >
                      <X size={12} />
                    </button>
                  </Badge>
                ))}
                <Button type="submit" size="sm" className="ms-auto" disabled={busy || !body.trim()}>
                  إضافة تعليق
                </Button>
              </div>
            </form>
          )}
        </TabsContent>
        <TabsContent value="changes" className="pt-4">
          {state.changes.length === 0 ? (
            <p className="text-xs text-muted-foreground">لا توجد تغييرات مسجلة على الحقول.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-start font-medium">
                      الحقل
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-medium">
                      قبل
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-medium">
                      بعد
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-medium">
                      بواسطة
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.changes.map((change) => (
                    <tr key={change.id} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{fieldLabel(change.field)}</td>
                      <td className="px-4 py-2 text-red-800 line-through">
                        {shown(change.before)}
                      </td>
                      <td className="px-4 py-2 text-emerald-800">{shown(change.after)}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {change.actorName ?? '—'} ·{' '}
                        <time dateTime={change.createdAt}>
                          {formatDatetime(change.createdAt, calendar)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}

function MentionPicker({
  base,
  onPick,
}: {
  base: string
  onPick: (user: MentionCandidate) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<MentionCandidate[]>([])
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(async () => {
      try {
        const response = await axios.get<{ data: MentionCandidate[] }>(`${base}/mentions`, {
          ...json,
          params: { search },
        })
        setUsers(response.data.data)
      } catch {
        setUsers([])
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [open, search, base])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <AtSign size={14} />
          إشارة إلى زميل
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="ابحث بالاسم…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>لا يوجد زملاء يملكون صلاحية عرض السجل.</CommandEmpty>
            {users.map((user) => (
              <CommandItem
                key={user.id}
                value={String(user.id)}
                onSelect={() => {
                  onPick(user)
                  setOpen(false)
                }}
              >
                {user.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
