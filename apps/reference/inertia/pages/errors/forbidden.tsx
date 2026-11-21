import { Head } from '@inertiajs/react'
import { useMessages } from '~/components/ui/messages'

export default function Forbidden() {
  const { t } = useMessages()
  return (
    <>
      <Head title={t('ليس لديك صلاحية لعرض هذه الصفحة')} />
      <h1>{t('ليس لديك صلاحية لعرض هذه الصفحة')}</h1>
    </>
  )
}
