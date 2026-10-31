import { Head } from '@inertiajs/react'
import { useMessages } from '~/components/ui/messages'

export default function NotFound() {
  const { t } = useMessages()
  return (
    <>
      <Head title={t('الصفحة غير موجودة')} />
      <h1>{t('الصفحة غير موجودة')}</h1>
    </>
  )
}
