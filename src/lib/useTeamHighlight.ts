'use client'

import type { CSSProperties } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { teamHighlightStyle } from '@/lib/team-manager'

// Returns a colour-tint style for the rows that are "yours" across race tables, standings, etc.; undefined
// otherwise. Call the returned fn per row with that row's team id + colour (+ driver id for driver rows).
// Team Manager mode highlights every row of the player's TEAM; Driver mode highlights only the player's own
// driver row (pass its driverId). One hook, both modes — same accent tint reused.
export function useTeamHighlight(): (teamId: string | undefined | null, color: string | undefined, driverId?: string | null) => CSSProperties | undefined {
  const playerTeamId = useSeasonStore((s) => (s.teamManagerMode ? s.playerTeamId : null))
  const playerDriverId = useSeasonStore((s) => (s.driverMode ? s.playerDriverId : null))
  return (teamId, color, driverId) => {
    if (!color) return undefined
    if (playerTeamId && teamId === playerTeamId) return teamHighlightStyle(color)
    if (playerDriverId && driverId && driverId === playerDriverId) return teamHighlightStyle(color)
    return undefined
  }
}
