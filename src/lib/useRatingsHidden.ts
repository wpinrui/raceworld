'use client'

import { useSeasonStore } from '@/lib/store/season-store'
import { useSettingsStore } from '@/lib/store/settings-store'

// Ratings (Overall, Potential, the 5 stats) are hidden — shown as A–D grades and anonymised sliders — in the
// managed career modes (Team Manager AND Driver), unless the Scout Network talent is on (reveals exact
// numbers for the whole grid). The classic sandbox always shows the real numbers.
export function useRatingsHidden(): boolean {
  const managed = useSeasonStore((s) => s.teamManagerMode || s.driverMode)
  const scout = useSettingsStore((s) => s.talents['scout-network'] ?? false)
  return managed && !scout
}
