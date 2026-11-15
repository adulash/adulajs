/**
 * The header's icon buttons (the bell, «مهامي», the assistant): one round 36 px target with a
 * shadcn Tooltip, its icon at 18 px and strokeWidth 1.6, and the shell's active pattern
 * (`bg-accent text-primary`) while its page is open.
 */
export const headerIconClass = (active = false) =>
  `relative grid size-9 place-items-center rounded-full transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${active ? 'bg-accent text-primary' : 'text-muted-foreground'}`
