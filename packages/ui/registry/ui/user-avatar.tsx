import { cn } from "cn"
import { Avatar as AvatarPrimitive } from "radix-ui"

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
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-16 text-lg",
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
 * Next to a visible name it is decorative; pass `labelled` when it stands alone.
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
    <AvatarPrimitive.Root
      data-slot="user-avatar"
      role={labelled ? "img" : undefined}
      aria-label={labelled ? (user.name ?? undefined) : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden rounded-full bg-muted align-middle",
        SIZES[size],
        className
      )}
    >
      {src ? (
        <AvatarPrimitive.Image
          data-slot="user-avatar-image"
          src={src}
          alt=""
          loading="lazy"
          className="aspect-square size-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        data-slot="user-avatar-fallback"
        className="flex size-full items-center justify-center rounded-full font-semibold text-muted-foreground"
      >
        {initialsOf(user.name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
