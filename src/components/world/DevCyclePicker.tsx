'use client'

import { useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendarForYear } from '@/data/calendars'
import { drawPackages } from '@/lib/sim/development'
import { Tooltip } from '@/components/ui/Tooltip'
import { ConfirmModal } from '@/components/race/ConfirmModal'

// 1 car-pace point = 0.04s/lap (engine.ts: carMod = (75 − carPace)/25, added to the base lap). The 5% flat
// failure and the median/catch-up gain mirror rollUpgrade in development.ts.
const SECONDS_PER_PACE = 0.04
const CATCHUP_PER_POINT = 0.125

// Expected lap-time gain (seconds) for an upgrade of the given cycle, for a car `deficit` pace points off
// the leader: median = cycle·1.05^(cycle−3), plus the catch-up bonus, converted to seconds.
function expectedSeconds(cycle: number, deficit: number): number {
  const median = cycle * Math.pow(1.05, cycle - 3)
  const catchUp = Math.max(0, deficit) * CATCHUP_PER_POINT
  return (median + catchUp) * SECONDS_PER_PACE
}

// Team Manager: the upgrade-development picker for the player's own car. The player picks a PART to develop
// (from a seeded, randomly-mapped pool) which commits the car to a 3–6 race cycle. A part in development is
// fixed (switching restarts the work, with a warning); once delivered the player must pick again or the car
// stagnates. Shared by the team page and the home dashboard panel so the two never drift.
export function DevCyclePicker({ className }: { className?: string }) {
  const playerTeamId = useSeasonStore((s) => s.playerTeamId)
  const devPlan = useSeasonStore((s) => s.devPlans.find((p) => p.teamId === playerTeamId))
  const teams = useSeasonStore((s) => s.teams)
  const saveSeed = useSeasonStore((s) => s.saveSeed)
  const allUpgradeEvents = useSeasonStore((s) => s.allUpgradeEvents)
  const seasonYear = useSeasonStore((s) => s.year)
  const totalRounds = useSeasonStore((s) => calendarForYear(s.year).length)

  const [pendingSwitch, setPendingSwitch] = useState<{ cycle: number; name: string } | null>(null)

  // A fresh set of four named packages per development offer. The offer index = the player's delivered
  // upgrades this season, so the four options hold steady while one is in progress and refresh after each
  // delivery. saveSeed makes them stable across reload and unique per save.
  const offerIndex = allUpgradeEvents.filter((e) => e.teamId === playerTeamId).length
  const packages = drawPackages(`${saveSeed}:${offerIndex}`)

  const leaderPace = teams.length ? Math.max(...teams.map((t) => t.carPace)) : 75
  const myPace = teams.find((t) => t.id === playerTeamId)?.carPace ?? 75
  const deficit = Math.max(0, leaderPace - myPace)

  const active = devPlan?.nextUpgradeRound != null
  const activeCycle = active ? devPlan!.cycleLength : null

  const start = (cycle: number, name: string) => useSeasonStore.getState().setPlayerUpgrade(cycle, name)

  const onPick = (cycle: number, name: string) => {
    if (cycle === activeCycle) return // already developing this one
    if (active) setPendingSwitch({ cycle, name }) // switching mid-development warns first
    else start(cycle, name)
  }

  const arrivalRound = active ? devPlan!.nextUpgradeRound! : null
  const arrivalName =
    arrivalRound != null && arrivalRound <= totalRounds
      ? (calendarForYear(seasonYear)[arrivalRound - 1]?.name ?? `Round ${arrivalRound}`).replace(/\bGP\b/, 'Grand Prix')
      : null

  return (
    <div className={className}>
      <h2 className="font-display text-sm tracking-widest uppercase text-[#FFFFFF]">Car development</h2>

      {!active && (
        <div className="mt-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#00D9FF] animate-pulse" />
          <p className="text-xs font-semibold uppercase tracking-widest text-[#00D9FF]">Select a development package</p>
        </div>
      )}

      <div className={`mt-3 w-72 max-w-full space-y-2 ${!active ? 'rounded-xl border border-[#00D9FF]/50 p-2' : ''}`}>
        {packages.map(({ cycle, name }) => {
          const selected = cycle === activeCycle
          const sec = expectedSeconds(cycle, deficit)
          return (
            <Tooltip
              key={cycle}
              content={
                <div className="space-y-0.5 font-bold">
                  <div className="text-[#34D399]">≈ {sec.toFixed(2)}s/lap faster</div>
                  <div className="text-[#F87171]">5% chance of failure</div>
                </div>
              }
            >
              <button
                onClick={() => onPick(cycle, name)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-left text-sm font-semibold transition-colors ${
                  selected
                    ? 'bg-[#00D9FF] text-[#0F1419]'
                    : 'bg-[#0F1419] text-[#FFFFFF] border border-[#303848] hover:border-[#00D9FF] cursor-pointer'
                }`}
              >
                <span>{name}</span>
                <span className={`text-xs uppercase tracking-widest ${selected ? 'text-[#0F1419]' : 'text-[#FFFFFF]'}`}>
                  {cycle} races
                </span>
              </button>
            </Tooltip>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-[#FFFFFF]">
        {!active
          ? 'No upgrade in development. The car will not improve while idle.'
          : arrivalName
            ? <>In development: {devPlan!.pendingPackageName ?? 'an upgrade'}. Arrives {arrivalName} (Round {arrivalRound})</>
            : <>In development: {devPlan!.pendingPackageName ?? 'an upgrade'}. Arrives next season</>}
      </p>

      {pendingSwitch && (
        <ConfirmModal
          title="Restart development"
          body={`Switching to "${pendingSwitch.name}" scraps the work on your current upgrade. Development restarts from scratch.`}
          confirmLabel="Restart"
          confirmClass="bg-[#DC143C] hover:bg-[#B01030] text-[#FFFFFF]"
          onConfirm={() => {
            start(pendingSwitch.cycle, pendingSwitch.name)
            setPendingSwitch(null)
          }}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
    </div>
  )
}
