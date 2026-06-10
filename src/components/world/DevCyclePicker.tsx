'use client'

import { useSeasonStore } from '@/lib/store/season-store'
import { calendarForYear } from '@/data/calendars'
import { Tooltip } from '@/components/ui/Tooltip'

// Team Manager: the upgrade-cadence picker for the player's own car. Reads the player team's dev plan, so
// the delivery line (which round + race the next upgrade lands) updates live as the cycle is changed.
// Shared by the team page and the home dashboard panel so the two never drift.
export function DevCyclePicker({ className }: { className?: string }) {
  const playerTeamId = useSeasonStore((s) => s.playerTeamId)
  const devPlan = useSeasonStore((s) => s.devPlans.find((p) => p.teamId === playerTeamId))
  const playerDevCycle = useSeasonStore((s) => s.playerDevCycle)
  const totalRounds = useSeasonStore((s) => calendarForYear(s.year).length)
  const seasonYear = useSeasonStore((s) => s.year)
  const selectedCycle = playerDevCycle ?? devPlan?.cycleLength ?? null

  return (
    <div className={className}>
      <h2 className="font-display text-sm tracking-widest uppercase text-[#FFFFFF]">Development cycle</h2>
      <div className="mt-3 flex gap-2">
        {[3, 4, 5, 6].map((n) => (
          <Tooltip key={n} content="Longer cycles deliver bigger but rarer upgrades.">
            <button
              onClick={() => useSeasonStore.getState().setPlayerDevCycle(n)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                selectedCycle === n
                  ? 'bg-[#00D9FF] text-[#0F1419]'
                  : 'bg-[#0F1419] text-[#FFFFFF] border border-[#303848] hover:border-[#00D9FF]'
              }`}
            >
              {n}
            </button>
          </Tooltip>
        ))}
        <span className="self-center ml-1 text-xs uppercase tracking-widest text-[#FFFFFF]">races</span>
      </div>
      {devPlan && (
        <p className="mt-3 text-xs text-[#FFFFFF]">
          {devPlan.nextUpgradeRound <= totalRounds
            ? <>Next upgrade arrival: {(calendarForYear(seasonYear)[devPlan.nextUpgradeRound - 1]?.name ?? `Round ${devPlan.nextUpgradeRound}`).replace(/\bGP\b/, 'Grand Prix')} (Round {devPlan.nextUpgradeRound})</>
            : 'Next upgrade arrival: next season'}
        </p>
      )}
    </div>
  )
}
