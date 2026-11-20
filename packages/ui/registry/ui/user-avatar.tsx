import { cn } from "cn"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"

export type UserAvatarUser = {
  id: number
  /** The name the initials come from; shown as the image's accessible name when alone. */
  name?: string | null
  /**
   * The picture URL. Omitted: `/users/:id/avatar` (any signed-in user may read it). `null`: the
   * user has no picture, so only the initials show and nothing is requested.
   */
  avatarUrl?: string | null
}

const SIZES = {
  xs: { root: "size-5", text: "text-[9px]" },
  sm: { root: "size-7", text: "text-[11px]" },
  md: { root: "size-9", text: "text-xs" },
  lg: { root: "size-16", text: "text-lg" },
} as const

/** Two initials like the server's `User.initials`: first and last word, or one word's first two letters. */
export function initialsOf(name?: string | null) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean)
  if (!words.length) return "؟"
  const letters =
    words.length > 1
      ? [Array.from(words[0])[0], Array.from(words.at(-1) as string)[0]]
      : Array.from(words[0]).slice(0, 2)
  return letters.join("").toUpperCase()
}

/**
 * A user's profile picture (ADR 050) with their initials while it loads and when there is none.
 * Next to a visible name it is decorative; pass `labelled` when it stands alone. It composes
 * shadcn's Avatar (ADR 055), so it carries `data-slot="avatar"` and `data-user-avatar`.
 */
export function UserAvatar({
  user,
  size = "sm",
  labelled = false,
  className,
}: {
  user: UserAvatarUser
  size?: keyof typeof SIZES
  labelled?: boolean
  className?: string
}) {
  const src =
    user.avatarUrl === null ? undefined : (user.avatarUrl ?? `/users/${user.id}/avatar`)
  return (
    <Avatar
      data-user-avatar=""
      role={labelled ? "img" : undefined}
      aria-label={labelled ? (user.name ?? undefined) : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn("inline-flex align-middle", SIZES[size].root, className)}
    >
      {src ? <AvatarImage src={src} alt="" loading="lazy" className="object-cover" /> : null}
      <AvatarFallback className={cn("font-semibold", SIZES[size].text)}>
        {initialsOf(user.name)}
      </AvatarFallback>
    </Avatar>
  )
}
