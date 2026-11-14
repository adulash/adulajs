import { useState, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { Mail, Pencil, RotateCcw } from 'lucide-react'
import type { MessageTemplate } from 'adula'
import Workspace from '~/layouts/workspace'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import { Dialog, DialogClose } from '~/components/ui/dialog'
import { LongDialogContent } from '~/components/ui/long-dialog'
import { useDialogParam } from '~/components/ui/dialog_param'

type Props = { templates: MessageTemplate[] }

function preview(text: string, variables: readonly string[]) {
  return text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (match, name: string) =>
    variables.includes(name) ? `‹${name}›` : match
  )
}

export default function TemplatesIndex({ templates }: Props) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [mail, setMail] = useState(false)
  const [processing, setProcessing] = useState(false)
  // `?edit=<key>` opens the template's dialog (decision 30); an unknown key is dropped.
  const dialog = useDialogParam(
    'edit',
    (key) => templates.find((template) => template.key === key),
    {
      onOpen: (template: MessageTemplate) => {
        setSubject(template.subject)
        setBody(template.body)
        setMail(template.mail)
      },
    }
  )
  const editing = dialog.item
  const save = (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing) return
    router.put(
      `/admin/templates/${editing.key}`,
      { subject, body, mail },
      {
        preserveScroll: true,
        // The dialog stays mounted while the list refreshes, then closes over it.
        preserveState: true,
        onStart: () => setProcessing(true),
        onFinish: () => setProcessing(false),
        onSuccess: (page) => {
          if (!page.flash?.error) dialog.close()
        },
      }
    )
  }
  return (
    <>
      <Head title="قوالب الرسائل" />
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">قوالب الرسائل</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          نصوص الإشعارات والبريد. التعديل محفوظ لهذا النشر، ويمكن إعادته إلى النص الافتراضي.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                القالب
              </th>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                العنوان
              </th>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                البريد
              </th>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                الحالة
              </th>
              <th scope="col" className="px-5 py-3">
                <span className="sr-only">إجراءات</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.key} className="border-b last:border-0">
                <td className="px-5 py-3">
                  <p className="font-medium">{template.label}</p>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {template.key}
                  </p>
                </td>
                <td className="px-5 py-3">{template.subject}</td>
                <td className="px-5 py-3">
                  {template.mail ? (
                    <span className="flex items-center gap-1 text-success">
                      <Mail size={14} /> يُرسل
                    </span>
                  ) : (
                    <span className="text-muted-foreground">داخل النظام فقط</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <Badge variant={template.customized ? 'default' : 'secondary'}>
                    {template.customized ? 'معدّل' : 'افتراضي'}
                  </Badge>
                </td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`تعديل ${template.label}`}
                      onClick={() => dialog.open(template.key)}
                    >
                      <Pencil size={14} />
                      تعديل
                    </Button>
                    {template.customized && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`استعادة ${template.label}`}
                        onClick={() =>
                          router.delete(`/admin/templates/${template.key}`, {
                            preserveScroll: true,
                          })
                        }
                      >
                        <RotateCcw size={14} />
                        استعادة
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog
        open={editing !== null}
        onOpenChange={(value) => !value && dialog.close()}
        value={{ subject, body, mail }}
      >
        <LongDialogContent
          dir="rtl"
          width="2xl"
          title="تعديل القالب"
          description={editing?.label}
          footer={
            <>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  إلغاء
                </Button>
              </DialogClose>
              <Button type="submit" form="template-form" disabled={processing}>
                حفظ القالب
              </Button>
            </>
          }
        >
          {editing && (
            <form id="template-form" className="space-y-4" onSubmit={save}>
              <div className="space-y-2">
                <Label htmlFor="template-subject">العنوان</Label>
                <Input
                  id="template-subject"
                  value={subject}
                  maxLength={200}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-body">النص</Label>
                <Textarea
                  id="template-body"
                  rows={5}
                  value={body}
                  maxLength={4000}
                  onChange={(event) => setBody(event.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                المتغيرات المتاحة:{' '}
                {editing.variables.map((name) => (
                  <code key={name} dir="ltr" className="mx-1 rounded bg-muted px-1">
                    {`{{${name}}}`}
                  </code>
                ))}
              </p>
              <div className="flex items-center gap-3">
                <Switch id="template-mail" checked={mail} onCheckedChange={setMail} />
                <Label htmlFor="template-mail">إرسال بالبريد أيضاً</Label>
              </div>
              <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
                <p className="mb-1 text-xs text-muted-foreground">معاينة</p>
                <p className="font-semibold">{preview(subject, editing.variables)}</p>
                <p className="whitespace-pre-wrap">{preview(body, editing.variables)}</p>
              </div>
            </form>
          )}
        </LongDialogContent>
      </Dialog>
    </>
  )
}
TemplatesIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
