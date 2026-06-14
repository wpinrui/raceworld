'use client'

import type { CSSProperties } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { teamHighlightStyle } from '@/lib/team-manager'

// Returns a colour-tint style for the rows that are "yours" across race tables, standings, etc.; undefined
// otherwise. Call the returned fn per row with that row's team id + colour (+ driver id for driver rows).
//   Team Manager: every row of the player's TEAM gets the accent.
//   Driver mode: the player's own driver row gets the FULL accent; the teammate's row a LIGHTER one; the
//   player's TEAM rows in constructor tables (no driverId) get the full accent too.
// One hook, both modes — same tint reused.
export function useTeamHighlight(): (teamId: string | undefined | null, color: string | undefined, driverId?: string | null) => CSSProperties | undefined {
  const playerTeamId = useSeasonStore((s) => (s.teamManagerMode ? s.playerTeamId : null))
  const playerDriverId = useSeasonStore((s) => (s.driverMode ? s.playerDriverId : null))
  const playerDriverTeamId = useSeasonStore((s) =>
    s.driverMode && s.playerDriverId ? (s.drivers.find((d) => d.id === s.playerDriverId)?.teamId || null) : null,
  )
  return (teamId, color, driverId) => {
    if (!color) return undefined
    if (playerTeamId && teamId === playerTeamId) return teamHighlightStyle(color)
    if (playerDriverId) {
      if (driverId && driverId === playerDriverId) return teamHighlightStyle(color)               // you: full accent
      if (playerDriverTeamId && teamId === playerDriverTeamId) return teamHighlightStyle(color, !!driverId) // teammate row light, team row (constructors) full
    }
    return undefined
  }
}
