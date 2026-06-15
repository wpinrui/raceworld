'use client'

import { useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { useSettingsStore } from '@/lib/store/settings-store'
import { calendarForYear } from '@/data/calendars'
import { drawPackages, CATCHUP_PER_POINT_PER_RACE } from '@/lib/sim/development'
import { DEFAULT_FOCUS } from '@/lib/sim/car-rating'
import type { FocusSplit } from '@/lib/sim/types'
import { Tooltip } from '@/components/ui/Tooltip'
import { ConfirmModal } from '@/components/race/ConfirmModal'

// The four ratings an upgrade's gain can be poured into, in display order.
const FOCUS_RATINGS: { key: keyof FocusSplit; label: string }[] = [
  { key: 'straightLine', label: 'Straight-line' },
  { key: 'cornering', label: 'Cornering' },
  { key: 'tyreWarming', label: 'Tyre warming' },
  { key: 'tyreWear', label: 'Tyre wear' },
]

// Normalise four raw slider weights to a FocusSplit summing to 1 (all-zero → an even split).
function toFocusSplit(w: number[]): FocusSplit {
  const sum = w[0] + w[1] + w[2] + w[3]
  const f = sum > 0 ? w.map((x) => x / sum) : [0.25, 0.25, 0.25, 0.25]
  return { straightLine: f[0], cornering: f[1], tyreWarming: f[2], tyreWear: f[3] }
}

// Upgrade focus allocator: four sliders set the relative emphasis; the gain is split by the normalised share.
function FocusAllocator({ focus, onChange }: { focus: FocusSplit; onChange: (f: FocusSplit) => void }) {
  // Local raw weights (0–100) drive the sliders; the displayed % is each one's normalised share.
  const [weights, setWeights] = useState<number[]>(() => FOCUS_RATINGS.map((r) => Math.round(focus[r.key] * 100)))
  const sum = weights[0] + weights[1] + weights[2] + weights[3]
  const pct = (i: number) => (sum > 0 ? Math.round((weights[i] / sum) * 100) : 25)
  const set = (i: number, v: number) => {
    const next = weights.map((w, j) => (j === i ? v : w))
    setWeights(next)
    onChange(toFocusSplit(next))
  }
  return (
    <div className="mt-3 w-[46rem] max-w-full rounded-lg border border-[#303848] bg-[#0F1419] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#FFFFFF]">Development focus</p>
      <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-2">
        {FOCUS_RATINGS.map((r, i) => (
          <label key={r.key} className="flex items-center gap-2 text-xs text-[#FFFFFF]">
            <span className="w-24 shrink-0">{r.label}</span>
            <input
              type="range" min={0} max={100} value={weights[i]}
              onChange={(e) => set(i, Number(e.target.value))}
              className="flex-1 accent-[#00D9FF]"
            />
            <span className="w-9 shrink-0 text-right tabular-nums font-semibold">{pct(i)}%</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// 1 car-pace point = 0.04s/lap (engine.ts: carMod = (75 − carPace)/25, added to the base lap). The 5% flat
// failure and the median/catch-up gain mirror rollUpgrade in development.ts (catch-up accrues per race); the
// catch-up rate is imported from there so the tooltip can't drift from the engine.
const SECONDS_PER_PACE = 0.04

// Expected lap-time gain (seconds) for an upgrade of the given cycle, for a car `deficit` pace points off
// the leader: median = cycle·1.05^(cycle−3), plus the per-race catch-up bonus and the Chief Aerodynamicist
// per-race bonus, converted to seconds.
function expectedSeconds(cycle: number, deficit: number, aeroPerRace: number): number {
  const median = cycle * Math.pow(1.05, cycle - 3)
  const catchUp = Math.max(0, deficit) * CATCHUP_PER_POINT_PER_RACE * cycle
  const bonus = aeroPerRace * cycle
  return (median + catchUp + bonus) * SECONDS_PER_PACE
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
  const talents = useSettingsStore((s) => s.talents)
  const noFail = !!talents['chief-engineer']
  const aeroPerRace = talents['chief-aero'] ? 1.25 : 0

  const [pendingSwitch, setPendingSwitch] = useState<{ cycle: number; name: string } | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)

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

      <div className="mt-3 grid w-[46rem] max-w-full grid-cols-2 gap-2">
        {packages.map(({ cycle, name }) => {
          const selected = cycle === activeCycle
          const sec = expectedSeconds(cycle, deficit, aeroPerRace)
          return (
            <Tooltip
              key={cycle}
              content={
                <div className="space-y-0.5 font-bold">
                  <div className="text-[#34D399]">≈ {sec.toFixed(2)}s/lap faster</div>
                  {noFail
                    ? <div className="text-[#34D399]">No failure risk</div>
                    : <div className="text-[#F87171]">5% chance of failure</div>}
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
                <span className="min-w-0 flex-1">{name}</span>
                <span className={`shrink-0 whitespace-nowrap text-xs uppercase tracking-widest ${selected ? 'text-[#0F1419]' : 'text-[#FFFFFF]'}`}>
                  {cycle} races
                </span>
              </button>
            </Tooltip>
          )
        })}
      </div>

      <FocusAllocator
        focus={devPlan?.focusSplit ?? DEFAULT_FOCUS}
        onChange={(f) => useSeasonStore.getState().setPlayerFocus(f)}
      />

      <p className="mt-3 text-xs text-[#FFFFFF]">
        {!active
          ? 'No upgrade in development.'
          : arrivalName
            ? <>In development: {devPlan!.pendingPackageName ?? 'an upgrade'}. Arrives {arrivalName} (Round {arrivalRound})</>
            : <>In development: {devPlan!.pendingPackageName ?? 'an upgrade'}. Arrives next season</>}
      </p>

      {active && (
        <button
          onClick={() => setConfirmCancel(true)}
          className="mt-3 px-3 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#DC143C] hover:bg-[#303848] transition-colors"
        >
          Cancel current upgrade
        </button>
      )}

      {confirmCancel && (
        <ConfirmModal
          title="Cancel upgrade"
          body="Scraps the work on your current upgrade."
          confirmLabel="Scrap upgrade"
          confirmClass="bg-[#DC143C] hover:bg-[#B01030] text-[#FFFFFF]"
          onConfirm={() => {
            useSeasonStore.getState().setPlayerUpgrade(null)
            setConfirmCancel(false)
          }}
          onCancel={() => setConfirmCancel(false)}
        />
      )}

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
