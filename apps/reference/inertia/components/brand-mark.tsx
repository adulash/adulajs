/**
 * The company mark; the project creator replaces its letter with the company's logo. It is
 * decorative: the company name beside it names the link.
 */
export function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-xl bg-primary font-bold text-primary-foreground ${size === 'md' ? 'size-10 text-2xl' : 'size-9 text-xl'}`}
    >
            ع
    </span>
  )
}
