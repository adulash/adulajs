import { useEffect, useState } from 'react'
import { Download, Eye } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { useMessages } from '~/components/ui/messages'

/** The parts of an attachment summary a preview needs (ADR 047). */
export type PreviewFile = {
  name: string
  url: string
  /** Set by the server for allow-listed images, PDF and plain text; other files download. */
  preview?: 'image' | 'pdf' | 'text' | null
}

/** Plain text longer than this is cut in the preview; the download keeps the whole file. */
const TEXT_PREVIEW_LIMIT = 200_000

/** The authorized download route asked for inline display. */
export function previewUrl(file: PreviewFile) {
  return `${file.url}${file.url.includes('?') ? '&' : '?'}preview=1`
}

/** Fetched as text and rendered as text: a previewed file never becomes markup here. */
function TextPreview({ file }: { file: PreviewFile }) {
  const { t } = useMessages()
  const [state, setState] = useState<{ text?: string; cut?: boolean; failed?: boolean }>({})
  useEffect(() => {
    // Read only the start of a large file: decode the stream as UTF-8 and stop at the cap.
    const controller = new AbortController()
    const read = async () => {
      const response = await fetch(previewUrl(file), {
        signal: controller.signal,
        credentials: 'same-origin',
      })
      if (!response.ok || !response.body) throw new Error(String(response.status))
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let text = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          text += decoder.decode()
          break
        }
        text += decoder.decode(value, { stream: true })
        if (text.length > TEXT_PREVIEW_LIMIT) {
          await reader.cancel()
          controller.abort()
          return { text: text.slice(0, TEXT_PREVIEW_LIMIT), cut: true }
        }
      }
      return { text, cut: false }
    }
    let current = true
    read()
      .then((result) => current && setState(result))
      .catch(() => current && setState({ failed: true }))
    return () => {
      current = false
      controller.abort()
    }
  }, [file.url])
  if (state.failed)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('تعذر تحميل المعاينة. يمكنك تنزيل الملف.')}
      </p>
    )
  if (state.text === undefined)
    return <p className="text-sm text-muted-foreground">{t('جارٍ تحميل المعاينة…')}</p>
  return (
    <div className="space-y-2">
      <pre
        dir="auto"
        className="max-h-[65vh] overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap"
      >
        {state.text}
      </pre>
      {state.cut && (
        <p className="text-xs text-muted-foreground">
          {t('تعرض المعاينة بداية الملف فقط. نزّل الملف لقراءته كاملًا.')}
        </p>
      )}
    </div>
  )
}

/** Inline preview of one file in a Dialog: images, PDF in a same-origin frame, text as text. */
export function AttachmentPreviewDialog({
  file,
  open,
  onOpenChange,
}: {
  file: PreviewFile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, dir } = useMessages()
  return (
    <Dialog mode="view" open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pe-6">{file.name}</DialogTitle>
          <DialogDescription>{t('معاينة المرفق. يمكنك تنزيله من الزر أدناه.')}</DialogDescription>
        </DialogHeader>
        {open && file.preview === 'image' && (
          <img
            src={previewUrl(file)}
            alt={file.name}
            className="mx-auto max-h-[65vh] max-w-full rounded-md border object-contain"
          />
        )}
        {open && file.preview === 'pdf' && (
          <iframe
            src={previewUrl(file)}
            title={file.name}
            className="h-[65vh] w-full rounded-md border"
          />
        )}
        {open && file.preview === 'text' && <TextPreview file={file} />}
        <DialogFooter>
          <Button asChild variant="outline">
            <a href={file.url} download={file.name}>
              <Download size={15} />
              {t('تنزيل')}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A preview button for a previewable file; renders nothing for files that only download. */
export function AttachmentPreviewButton({
  file,
  disabled,
}: {
  file: PreviewFile
  disabled?: boolean
}) {
  const { t } = useMessages()
  const [open, setOpen] = useState(false)
  if (!file.preview) return null
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={t('معاينة {name}', { name: file.name })}
        onClick={() => setOpen(true)}
      >
        <Eye size={14} />
        {t('معاينة')}
      </Button>
      <AttachmentPreviewDialog file={file} open={open} onOpenChange={setOpen} />
    </>
  )
}
