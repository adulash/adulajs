import { Head } from '@inertiajs/react'
import { useMessages } from '~/components/ui/messages'

export default function ServerError() {
  const { t } = useMessages()
  return (
    <>
      <Head title={t('حدث خطأ غير متوقع')} />
      <h1>{t('حدث خطأ غير متوقع')}</h1>
    </>
  )
}
