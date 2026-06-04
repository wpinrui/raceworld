import { useMemo } from 'react'
import { useSettingsStore } from './settings-store'

// The drivers/teams the player follows (Settings), as lookup sets — for highlighting them in the
// standings, news, etc. Reactive: updates as the follow list changes.
export function useFollowed(): { drivers: Set<string>; teams: Set<string> } {
  const driverIds = useSettingsStore((s) => s.followedDriverIds)
  const teamIds = useSettingsStore((s) => s.followedTeamIds)
  return useMemo(() => ({ drivers: new Set(driverIds), teams: new Set(teamIds) }), [driverIds, teamIds])
}
