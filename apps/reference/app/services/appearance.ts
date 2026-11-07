import type { DerivedTheme } from 'adula'
import { adula } from '#services/adula'
import { fileIdentity } from '#services/initial_setup'

/** The public address of an appearance logo; a new logo is a new id, so it never changes. */
export const logoUrl = (id: number) => `/appearance/logos/${id}`

/**
 * The `appearance` shared prop (ADR 053): what every page shows for this request, guests
 * included. Texts left empty are null, so a shell keeps its own default wording.
 */
export type SharedAppearance = {
  company: string
  logoUrl: string | null
  /**
   * Only what «المظهر والهوية» sets (the saved identity or today's occasion). The shells show
   * it in place of their own name and mark; null keeps the shell's identity.
   */
  brand: { company: string | null; logoUrl: string | null }
  login: { title: string | null; description: string | null }
  guestHome: { title: string | null; description: string | null }
  banner: string | null
  occasion: { name: string; endsOn: string } | null
  theme: DerivedTheme | null
}

export async function sharedAppearance(): Promise<SharedAppearance> {
  const [resolved, base] = await Promise.all([adula().appearance.resolve(), fileIdentity()])
  return {
    company: resolved.company ?? base.company,
    logoUrl: resolved.logoId ? logoUrl(resolved.logoId) : base.logo,
    brand: {
      company: resolved.company,
      logoUrl: resolved.logoId ? logoUrl(resolved.logoId) : null,
    },
    login: resolved.login,
    guestHome: resolved.guestHome,
    banner: resolved.banner,
    occasion: resolved.occasion
      ? { name: resolved.occasion.name, endsOn: resolved.occasion.endsOn }
      : null,
    theme: resolved.theme,
  }
}
