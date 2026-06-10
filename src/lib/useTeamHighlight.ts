'use client'

import type { CSSProperties } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { teamHighlightStyle } from '@/lib/team-manager'

// In Team Manager mode, returns a colour-tint style for rows belonging to the player's team (race tables,
// standings, etc.); returns undefined otherwise. Call the returned fn per row with that row's team id+colour.
export function useTeamHighlight(): (teamId: string | undefined | null, color: string | undefined) => CSSProperties | undefined {
  const playerTeamId = useSeasonStore((s) => (s.teamManagerMode ? s.playerTeamId : null))
  return (teamId, color) => (playerTeamId && teamId === playerTeamId && color ? teamHighlightStyle(color) : undefined)
}
