import { ShieldAlert } from 'lucide-react'
import { useMessages } from '~/components/ui/messages'

/**
 * What the assistant sends to the external provider (ADR 052). Shown to every user before
 * the first question and to administrators in the assistant settings.
 */
export function AssistantNotice() {
  const { t } = useMessages()
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm leading-6">
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlert size={16} className="text-muted-foreground" />
        {t('ما الذي يُرسل إلى مزوّد خارجي؟')}
      </p>
      <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
        <li>{t('نص سؤالك والمحادثة الحالية.')}</li>
        <li>
          {t(
            'ما يقرؤه المساعد من السجلات نيابة عنك، وهو ما تسمح لك صلاحياتك برؤيته فقط، دون الحقول المخفية أو المحجوبة.'
          )}
        </li>
        <li>{t('أسماء الكيانات التي يحق لك الاطلاع عليها.')}</li>
      </ul>
      <p className="text-muted-foreground">
        {t(
          'لا تُرسل كلمات المرور ولا الإعدادات ولا المرفقات ولا اسمك أو بريدك. يعالج المزوّد (OpenRouter) هذه البيانات وفق سياسته، ولا يُنفَّذ أي تعديل على السجلات إلا بعد موافقتك.'
        )}
      </p>
    </div>
  )
}
