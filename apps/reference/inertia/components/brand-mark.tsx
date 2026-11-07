/**
 * The company mark; the project creator replaces its letter with the company's logo. A logo
 * set in «المظهر والهوية» (ADR 053) takes its place. It is decorative: the company name
 * beside it names the link.
 */
export function BrandMark({
  size = 'md',
  logo = null,
}: {
  size?: 'sm' | 'md'
  /** The appearance logo; null keeps the project's own mark. */
  logo?: string | null
}) {
  const box = size === 'md' ? 'size-10' : 'size-9'
  if (logo)
    return (
      <span aria-hidden="true" className={`grid shrink-0 place-items-center ${box}`}>
        <img src={logo} alt="" className="size-full object-contain" data-brand-logo />
      </span>
    )
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-xl bg-primary font-bold text-primary-foreground ${box} ${size === 'md' ? 'text-2xl' : 'text-xl'}`}
    >
            ع
    </span>
  )
}
