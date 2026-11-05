import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { router, usePage } from '@inertiajs/react'
import { ImageUp } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { FileInput } from '~/components/ui/file-input'
import { Label } from '~/components/ui/label'
import { Slider } from '~/components/ui/slider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

/** The square the user frames; the saved picture is at most OUTPUT pixels on a side. */
const FRAME = 240
const OUTPUT = 512
const MAX_BYTES = 1024 * 1024
/** Camera photos may be large; the browser re-encodes them, so only the result is bounded. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

type Crop = { zoom: number; x: number; y: number }

/** Keeps the picture covering the whole frame at the current zoom. */
function clamp(image: HTMLImageElement, crop: Crop): Crop {
  const scale = (FRAME / Math.min(image.naturalWidth, image.naturalHeight)) * crop.zoom
  const limitX = Math.max(0, (image.naturalWidth * scale - FRAME) / 2)
  const limitY = Math.max(0, (image.naturalHeight * scale - FRAME) / 2)
  return {
    zoom: crop.zoom,
    x: Math.min(limitX, Math.max(-limitX, crop.x)),
    y: Math.min(limitY, Math.max(-limitY, crop.y)),
  }
}

/** Draws the framed square of the picture onto a canvas `size` pixels wide. */
function draw(canvas: HTMLCanvasElement, image: HTMLImageElement, crop: Crop, size: number) {
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return
  const scale = (FRAME / Math.min(image.naturalWidth, image.naturalHeight)) * crop.zoom
  const side = FRAME / scale
  const sx = image.naturalWidth / 2 - crop.x / scale - side / 2
  const sy = image.naturalHeight / 2 - crop.y / scale - side / 2
  context.imageSmoothingQuality = 'high'
  context.clearRect(0, 0, size, size)
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size)
}

function encode(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))
}

/** WebP where the browser encodes it, else PNG; a smaller size when the file is still too big. */
async function render(image: HTMLImageElement, crop: Crop) {
  const canvas = document.createElement('canvas')
  const largest = Math.min(
    OUTPUT,
    Math.round(Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom)
  )
  for (const size of [largest, 384, 256, 128].filter((side) => side <= largest && side >= 32)) {
    draw(canvas, image, crop, size)
    for (const type of ['image/webp', 'image/png']) {
      const blob = await encode(canvas, type)
      if (blob && blob.type === type && blob.size <= MAX_BYTES) return blob
    }
  }
  return null
}

/**
 * Choose, frame and save a profile picture (ADR 050). The browser crops and re-encodes it to a
 * square of at most 512 pixels; the server checks the result again and removes its metadata.
 */
export function AvatarDialog({
  open,
  onOpenChange,
  action,
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `/account/avatar`, or `/admin/users/:id/avatar` on the user page. */
  action: string
  title: string
}) {
  const { flash } = usePage()
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 })
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const preview = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ pointer: number; x: number; y: number; start: Crop } | null>(null)

  useEffect(() => {
    if (!open) {
      setImage(null)
      setCrop({ zoom: 1, x: 0, y: 0 })
      setProblem(null)
      setAttempted(false)
    }
  }, [open])

  useEffect(() => {
    if (image && preview.current) {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      draw(preview.current, image, crop, Math.round(FRAME * ratio))
    }
  }, [image, crop])

  const update = useCallback((next: Crop) => setCrop(image ? clamp(image, next) : next), [image])

  const choose = (file: File | undefined) => {
    setProblem(null)
    setAttempted(false)
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      setProblem('اختر صورة بصيغة PNG أو JPEG أو WebP.')
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setProblem('حجم الصورة كبير جدًا. اختر صورة لا يتجاوز حجمها ١٥ ميغابايت.')
      return
    }
    const url = URL.createObjectURL(file)
    const loaded = new Image()
    loaded.onload = () => {
      URL.revokeObjectURL(url)
      if (Math.min(loaded.naturalWidth, loaded.naturalHeight) < 32) {
        setProblem('الصورة صغيرة جدًا. اختر صورة لا يقل ضلعها عن ٣٢ بكسل.')
        return
      }
      setCrop({ zoom: 1, x: 0, y: 0 })
      setImage(loaded)
    }
    loaded.onerror = () => {
      URL.revokeObjectURL(url)
      setProblem('تعذّر فتح الصورة. تأكد من أن الملف صورة سليمة.')
    }
    loaded.src = url
  }

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!image) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: crop }
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointer !== event.pointerId) return
    update({
      zoom: state.start.zoom,
      x: state.start.x + event.clientX - state.x,
      y: state.start.y + event.clientY - state.y,
    })
  }
  const pointerUp = () => {
    drag.current = null
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 20 : 5
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[event.key]
    if (!move || !image) return
    event.preventDefault()
    update({ zoom: crop.zoom, x: crop.x + move[0], y: crop.y + move[1] })
  }

  const save = async () => {
    if (!image) return
    setProblem(null)
    const blob = await render(image, crop)
    if (!blob) {
      setProblem('تعذّر تجهيز الصورة بحجم مقبول. جرّب صورة أخرى.')
      return
    }
    const extension = blob.type === 'image/webp' ? 'webp' : 'png'
    setAttempted(true)
    router.post(
      action,
      { avatar: new File([blob], `avatar.${extension}`, { type: blob.type }) },
      {
        forceFormData: true,
        preserveScroll: true,
        preserveState: true,
        onStart: () => setSending(true),
        onFinish: () => setSending(false),
        onSuccess: (page) => {
          if (typeof page.flash?.error !== 'string') onOpenChange(false)
        },
      }
    )
  }

  const serverError = attempted && typeof flash.error === 'string' ? flash.error : null
  return (
    <Dialog mode="edit" open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            اختر صورة ثم اضبط موضعها داخل المربع. تُحفظ الصورة مربعة بحجم لا يتجاوز ٥١٢ بكسل، وتُزال
            منها بيانات الموقع والجهاز.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label id="avatar-file-label" htmlFor="avatar-file">
              ملف الصورة
            </Label>
            <FileInput
              id="avatar-file"
              labelId="avatar-file-label"
              accept={ACCEPTED.join(',')}
              onFilesChange={(files) => choose(files[0])}
              aria-describedby="avatar-file-hint"
            />
            <p id="avatar-file-hint" className="text-xs text-muted-foreground">
              الأنواع المقبولة: PNG وJPEG وWebP.
            </p>
          </div>
          {image && (
            <>
              <div
                role="group"
                tabIndex={0}
                aria-label="موضع الصورة. استخدم الأسهم لتحريكها."
                data-testid="avatar-crop"
                className="mx-auto cursor-grab touch-none overflow-hidden rounded-full border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
                style={{ width: FRAME, height: FRAME }}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
                onKeyDown={keyDown}
              >
                <canvas ref={preview} className="size-full" aria-hidden="true" />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                اسحب الصورة أو استخدم الأسهم لضبط موضعها.
              </p>
              <div className="space-y-2">
                <Label id="avatar-zoom-label">التكبير</Label>
                <Slider
                  aria-labelledby="avatar-zoom-label"
                  min={1}
                  max={3}
                  step={0.05}
                  value={[crop.zoom]}
                  onValueChange={([zoom]) => update({ ...crop, zoom })}
                />
              </div>
            </>
          )}
          {(problem || serverError) && (
            <p role="alert" className="text-sm text-destructive">
              {problem ?? serverError}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button type="button" onClick={save} disabled={!image || sending}>
            <ImageUp size={16} />
            حفظ الصورة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
