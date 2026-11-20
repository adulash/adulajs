/**
 * The header's icon buttons (the bell, «مهامي», the assistant): shadcn's ghost icon Button
 * (`size="icon"`, 36 px), round, the icon at 18 px and strokeWidth 1.6, a Tooltip with its name,
 * and the shell's active pattern (`bg-accent text-primary`) while its page is open
 * (ADR 049, ADR 055).
 */
export const headerIconClass = (active = false) =>
  `relative rounded-full [&_svg:not([class*='size-'])]:size-[18px] ${active ? 'bg-accent text-primary' : 'text-muted-foreground'}`

/** A header icon's count: a shadcn Badge on the button's top-end corner. */
export const headerCountClass =
  'absolute -end-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 text-[10px] leading-4'
