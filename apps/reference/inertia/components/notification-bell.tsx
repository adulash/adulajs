import { useEffect, useRef } from 'react'
import { router, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { Transmit } from '@adonisjs/transmit-client'
import { Bell } from 'lucide-react'
import { toast } from 'sonner'
import { useMessages } from '~/components/ui/messages'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { headerIconClass } from '~/components/header_icon'
import { isActivePath } from '~/components/shell_navigation'

const HIDDEN_GRACE_MS = 10_000
let client: Transmit | undefined
function realtime() {
  // One Transmit client per tab, used by the leader tab only. Subscriptions are POSTs, so they carry the CSRF token.
  client ??= new Transmit({
    baseUrl: window.location.origin,
    beforeSubscribe: (request) => {
      const token = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)?.[1]
      if (token) request.headers.set('X-XSRF-TOKEN', decodeURIComponent(token))
    },
    beforeUnsubscribe: (request) => {
      const token = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)?.[1]
      if (token) request.headers.set('X-XSRF-TOKEN', decodeURIComponent(token))
    },
  })
  return client
}

/**
 * Opens this tab's subscription to the user's notification channel; returns a closer.
 * Each open stream holds one of the browser's six HTTP/1.1 connections to this host.
 */
function openStream(userId: number, onMessage: () => void, onSubscribed?: () => void) {
  const transmit = realtime()
  const subscription = transmit.subscription(`notifications/${userId}`)
  let active = true
  subscription
    .create()
    .then(() => {
      if (!active) void subscription.delete()
      else if (subscription.isCreated) onSubscribed?.()
    })
    .catch(() => {})
  const stop = subscription.onMessage(onMessage)
  return () => {
    active = false
    stop()
    void subscription.delete().catch(() => {})
    client?.close()
    client = undefined
  }
}

/**
 * One stream per browser, not per tab (#36): visible tabs elect a leader with a Web Lock;
 * the leader holds the stream and relays each signal to the other tabs over a
 * BroadcastChannel. When the leader closes or is hidden, a waiting tab takes over.
 * Nothing delivers a signal sent between two leaders, so a tab that takes over
 * refreshes the count for all tabs once it is subscribed.
 * Browsers without these APIs fall back to a stream per visible tab.
 */
function joinRealtime(userId: number, onMessage: () => void, onCatchUp: () => void) {
  const name = `adula:notifications:${userId}`
  if (typeof BroadcastChannel === 'undefined' || !('locks' in navigator)) {
    return openStream(userId, onMessage)
  }
  const channel = new BroadcastChannel(name)
  channel.onmessage = (event) => (event.data === 'catch-up' ? onCatchUp() : onMessage())
  const leave = new AbortController()
  const lead = async (takeover: boolean) => {
    if (leave.signal.aborted) return
    const stop = openStream(
      userId,
      () => {
        onMessage()
        channel.postMessage('notification')
      },
      takeover
        ? () => {
            onCatchUp()
            channel.postMessage('catch-up')
          }
        : undefined
    )
    // Hold the lock, and the stream, until this tab leaves.
    await new Promise<void>((resolve) =>
      leave.signal.addEventListener('abort', () => resolve(), { once: true })
    )
    stop()
  }
  // A tab that finds the lock free skips the refresh on purpose, so the gap between
  // page load and an accepted subscription stays uncovered.
  navigator.locks
    .request(name, { ifAvailable: true }, async (lock) => {
      if (lock) await lead(false)
      return lock !== null
    })
    .then((led) => {
      if (led || leave.signal.aborted) return
      return navigator.locks.request(name, { signal: leave.signal }, () => lead(true))
    })
    .catch(() => {
      // Leaving before becoming the leader aborts the pending request.
    })
  return () => {
    leave.abort()
    channel.close()
  }
}

export function NotificationBell() {
  const page = usePage<{
    unreadNotifications?: number
    account?: { id: number; email: string }
  }>()
  const userId = page.props.account?.id
  const { t } = useMessages()
  // The stream outlives navigations; it reads the current wording through a ref.
  const text = useRef(t)
  text.current = t
  useEffect(() => {
    if (!userId) return
    let leaveRealtime: (() => void) | undefined
    const onMessage = () => {
      // New work arrives with a notification, so «مهامي» refreshes with the bell (#156).
      router.reload({ only: ['unreadNotifications', 'openTasks'] })
      toast(text.current('وصلك إشعار جديد'), {
        action: { label: text.current('عرض'), onClick: () => router.visit('/notifications') },
      })
    }
    // Asynchronous, so a catch-up never cancels the navigation the user is making.
    const catchUp = () =>
      router.reload({ only: ['unreadNotifications', 'openTasks'], async: true })
    const open = () => {
      leaveRealtime ??= joinRealtime(userId, onMessage, catchUp)
    }
    const close = () => {
      leaveRealtime?.()
      leaveRealtime = undefined
    }
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined
    const onVisibility = () => {
      clearTimeout(hiddenTimer)
      if (document.visibilityState === 'hidden') {
        // A short grace period avoids handing the stream over on every quick tab switch.
        hiddenTimer = setTimeout(close, HIDDEN_GRACE_MS)
      } else if (!leaveRealtime) {
        open()
        // Catch up on notifications that arrived while this tab was not listening.
        catchUp()
      }
    }
    if (document.visibilityState !== 'hidden') open()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(hiddenTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      close()
    }
  }, [userId])
  if (!page.props.account) return null
  const count = page.props.unreadNotifications ?? 0
  const active = isActivePath(page.url, '/notifications')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/notifications"
          aria-label={count ? t('الإشعارات، {count} غير مقروء', { count }) : t('الإشعارات')}
          aria-current={active ? 'page' : undefined}
          data-testid="notifications-button"
          className={headerIconClass(active)}
        >
          <Bell size={18} strokeWidth={1.6} aria-hidden />
          {count > 0 && (
            <span
              data-testid="unread-count"
              className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-destructive-foreground"
            >
              {count}
            </span>
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{t('الإشعارات')}</TooltipContent>
    </Tooltip>
  )
}
