'use client'

import { useSeasonStore } from '@/lib/store/season-store'
import { useSettingsStore } from '@/lib/store/settings-store'

// Ratings (Overall, Potential, the 5 stats) are hidden — shown as A–D grades and anonymised sliders —
// in Team Manager mode, unless the player has switched the Scout Network talent on (reveals exact numbers
// for the whole grid). The classic sandbox always shows the real numbers.
export function useRatingsHidden(): boolean {
  const tm = useSeasonStore((s) => s.teamManagerMode)
  const scout = useSettingsStore((s) => s.talents['scout-network'] ?? false)
  return tm && !scout
}
