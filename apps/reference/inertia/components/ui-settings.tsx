import { useState } from 'react'
import { router } from '@inertiajs/react'
import type { UiPreferences, CalendarPreference, DigitsPreference } from 'adula'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { Badge } from '~/components/ui/badge'
import { ResourceSelect } from '~/components/ui/resource-field'

export function UiSettings({ initial }: { initial: UiPreferences }) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>التواريخ وتجربة الاستخدام</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="max-w-md space-y-2">
          <Label htmlFor="calendar-preference">عرض التاريخ</Label>
          <ResourceSelect
            id="calendar-preference"
            aria-label="عرض التاريخ"
            value={value.calendar}
            options={[
              { value: 'gregory', label: 'الميلادي' },
              { value: 'islamic-umalqura', label: 'الهجري · أم القرى' },
              { value: 'both', label: 'الميلادي والهجري معًا' },
            ]}
            onChange={(calendar) =>
              setValue({ ...value, calendar: calendar as CalendarPreference })
            }
          />
          <p className="text-xs text-muted-foreground">
            يشمل الجداول والتفاصيل والنماذج. عند اختيار كليهما يمكنك الإدخال بأي تقويم مع رؤية
            التاريخ المقابل.
          </p>
        </div>
        <div className="max-w-md space-y-2">
          <Label htmlFor="digits-preference">الأرقام في المستندات المطبوعة</Label>
          <ResourceSelect
            id="digits-preference"
            aria-label="الأرقام في المستندات المطبوعة"
            value={value.digits ?? 'latn'}
            options={[
              { value: 'latn', label: 'أرقام لاتينية (0123)' },
              { value: 'arab', label: 'أرقام عربية مشرقية (٠١٢٣)' },
            ]}
            onChange={(digits) => setValue({ ...value, digits: digits as DigitsPreference })}
          />
          <p className="text-xs text-muted-foreground">
            تُطبَّق في قوالب الطباعة على التواريخ والمبالغ والأرقام.
          </p>
        </div>
        <div className="flex items-center justify-between gap-6">
          <div>
            <Label htmlFor="confirm-dialog-close">تأكيد إغلاق نماذج التحرير</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              يحمي الإدخال عند النقر خارج النافذة أو الضغط على إغلاق أو Escape. نوافذ العرض تُغلق
              مباشرة.
            </p>
          </div>
          <Switch
            id="confirm-dialog-close"
            checked={value.confirmDialogClose}
            onCheckedChange={(confirmDialogClose) => setValue({ ...value, confirmDialogClose })}
          />
        </div>
        <div className="flex items-center justify-between gap-6">
          <Label htmlFor="page-transitions">انتقالات سلسة بين الصفحات</Label>
          <Switch
            id="page-transitions"
            checked={value.pageTransitions}
            onCheckedChange={(pageTransitions) => setValue({ ...value, pageTransitions })}
          />
        </div>
        <div className="flex items-start justify-between gap-6 border-t pt-5">
          <div>
            <p className="text-sm font-medium">حماية الوصول الإداري</p>
            <p className="mt-1 text-xs text-muted-foreground">
              تغييرات الصلاحيات تتطلب تأكيدًا. يمنع النظام إزالة آخر مدير نشط أو سحب إدارة النظام من
              حسابك الحالي.
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            مفعّلة دائمًا
          </Badge>
        </div>
        <Button
          disabled={saving}
          onClick={() =>
            router.put(
              '/admin/settings',
              {
                key: 'ui.preferences',
                scope: 'system',
                scopeId: '0',
                value: JSON.stringify(value),
              },
              {
                preserveScroll: true,
                onStart: () => setSaving(true),
                onFinish: () => setSaving(false),
              }
            )
          }
        >
          {saving ? 'جارٍ الحفظ…' : 'حفظ تفضيلات الواجهة'}
        </Button>
      </CardContent>
    </Card>
  )
}
