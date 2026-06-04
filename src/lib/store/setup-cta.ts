import { create } from 'zustand'

// Bridges the pre-season Setup page's "Start Season" action up to the nav top bar. The setup page
// holds the staged grid in local state, so it registers a start callback (and readiness) here; the
// nav renders the CTA and invokes it. Cleared when the setup page unmounts or a season is active.
interface SetupCtaState {
  cta: { ready: boolean; year: number; start: () => void } | null
  setCta: (cta: SetupCtaState['cta']) => void
}

export const useSetupCta = create<SetupCtaState>((set) => ({
  cta: null,
  setCta: (cta) => set({ cta }),
}))
