import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { calendarInput, calendarIso, calendarDisplay } from '~/components/ui/calendar_date'

const months = [
  'محرم',
  'صفر',
  'ربيع الأول',
  'ربيع الآخر',
  'جمادى الأولى',
  'جمادى الآخرة',
  'رجب',
  'شعبان',
  'رمضان',
  'شوال',
  'ذو القعدة',
  'ذو الحجة',
]
const pad = (value: number) => String(value).padStart(2, '0')

export function HijriCalendar({
  value,
  onSelect,
}: {
  value: string
  onSelect: (iso: string) => void
}) {
  // Today is the viewer's local day; its UTC date is yesterday shortly after midnight east of UTC.
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const initial = calendarInput(value || today, 'islamic-umalqura')
  const [year, setYear] = useState(Math.max(1300, Math.min(1600, Number(initial.slice(0, 4)))))
  const [month, setMonth] = useState(Number(initial.slice(5, 7)))
  const first = calendarIso(`${year}-${pad(month)}-01`, 'islamic-umalqura')
  const offset = new Date(`${first}T00:00:00Z`).getUTCDay()
  let days = 30
  try {
    calendarIso(`${year}-${pad(month)}-30`, 'islamic-umalqura')
  } catch {
    days = 29
  }
  const move = (delta: number) => {
    const next = year * 12 + month - 1 + delta
    setYear(Math.floor(next / 12))
    setMonth((next % 12) + 1)
  }
  return (
    <div dir="rtl" className="w-80 space-y-3 p-3" aria-label="تقويم أم القرى">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="الشهر السابق"
          disabled={year === 1300 && month === 1}
          onClick={() => move(-1)}
        >
          <ChevronRight />
        </Button>
        <Select value={String(month)} onValueChange={(value) => setMonth(Number(value))}>
          <SelectTrigger aria-label="الشهر الهجري" className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((label, index) => (
              <SelectItem key={label} value={String(index + 1)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
          <SelectTrigger aria-label="السنة الهجرية" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 301 }, (_, index) => (
              <SelectItem key={index} value={String(1300 + index)}>
                {1300 + index} هـ
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="الشهر التالي"
          disabled={year === 1600 && month === 12}
          onClick={() => move(1)}
        >
          <ChevronLeft />
        </Button>
      </div>
      <div
        className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground"
        aria-hidden="true"
      >
        {['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div
        className="grid grid-cols-7 gap-1"
        role="group"
        aria-label={`${months[month - 1]} ${year} هـ`}
      >
        {Array.from({ length: offset }, (_, index) => (
          <span key={`empty-${index}`} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const iso = new Date(Date.parse(`${first}T00:00:00Z`) + index * 86400000)
            .toISOString()
            .slice(0, 10)
          return (
            <Button
              key={iso}
              type="button"
              size="icon-sm"
              variant={iso === value ? 'default' : 'ghost'}
              aria-pressed={iso === value}
              aria-label={calendarDisplay(iso, 'islamic-umalqura')}
              onClick={() => onSelect(iso)}
            >
              {index + 1}
            </Button>
          )
        })}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        تقويم أم القرى · يُحفظ التاريخ موحدًا
      </p>
    </div>
  )
}
