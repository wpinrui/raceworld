'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import type { Driver, RaceState } from '@/lib/sim/types'
import { useRaceStore } from '@/lib/store/race-store'
import { getMoistureAtLap } from '@/lib/sim/weather'
import { buildCandidates, candKey, gatherForecast, summarizeForecast, type ForecastCandidate, type ForecastSample } from '@/lib/sim/strategy-forecast'
import TyreIndicator from './TyreIndicator'

const FORECAST_TARGET = 120 // runs per option at full convergence
// A wall-clock budget caps the expensive (early/pre-race) case so a manual forecast can't run for minutes; it
// stops with whatever (fairly-sampled) data it gathered, flagged as time-limited.
const BUDGET_MS = 12000

const candLabel = (c: ForecastCandidate): string =>
  c.kind === 'hold' ? 'Stay out' : c.kind === 'pit' ? 'Pit' : 'Start'

// Race Engineer talent: Monte-Carlo strategy advice for ONE car. Runs the real engine to the flag many times
// under each option and reports where the car lands. The simulation stays faithful (every run resamples the
// engine's true luck); the risk preference lives only in the ranking — Cautious ranks by the bad-day figure
// (worst 25%) instead of the average, never by skewing the rolls. Shown only while paused (the forecast is a
// snapshot) — pre-race, or mid-race once the player pauses. The lower bar's auto-advance is the team-level
// counterpart that watches every car and pauses at the pit window.
export function RaceEngineer({ driver, raceState, mode }: { driver: Driver; raceState: RaceState; mode: 'pre-race' | 'racing' }) {
  const drivers = useRaceStore((s) => s.drivers)
  const teams = useRaceStore((s) => s.teams)
  const circuit = useRaceStore((s) => s.selectedCircuit)
  const [cautious, setCautious] = useState(false)
  const [running, setRunning] = useState(false)
  const [budgetHit, setBudgetHit] = useState(false)
  const [samples, setSamples] = useState<Record<string, ForecastSample[]>>({})
  const abortRef = useRef(false)

  // Abort an in-flight forecast if the panel unmounts (e.g. the player resumes the race).
  useEffect(() => () => { abortRef.current = true }, [])

  const candidates = useMemo(
    () => buildCandidates(getMoistureAtLap(raceState.weather, raceState.currentLap), mode),
    [raceState.weather, raceState.currentLap, mode],
  )
  // Pre-race the race hasn't gone green; flip to a racing seed exactly as the green light does (lap 1).
  const start: RaceState = mode === 'pre-race' ? { ...raceState, phase: 'racing' } : raceState

  async function run() {
    if (!circuit) return
    abortRef.current = false
    setRunning(true)
    setBudgetHit(false)
    // finally guarantees we leave the running state even if a run throws — otherwise the panel would stick
    // on "Stop" with a dead loop behind it, escapable only by unmounting.
    try {
      const { timedOut } = await gatherForecast(start, drivers, teams, circuit, driver.id, candidates, {
        target: FORECAST_TARGET,
        budgetMs: BUDGET_MS,
        shouldAbort: () => abortRef.current,
        onProgress: (acc) => setSamples(Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.slice()]))),
      })
      if (timedOut) setBudgetHit(true)
    } finally {
      setRunning(false)
    }
  }

  const fieldSize = raceState.drivers.length
  const rows = candidates
    .map((c) => ({ c, stats: summarizeForecast(samples[candKey(c)] ?? [], fieldSize, raceState.year) }))
    // Options with no runs yet sort LAST (their 0.0 isn't a real "best"); among sampled ones, by the metric.
    .sort((a, b) => {
      const az = a.stats.runs === 0, bz = b.stats.runs === 0
      if (az !== bz) return az ? 1 : -1
      return cautious ? a.stats.badDayFinish - b.stats.badDayFinish : a.stats.expectedFinish - b.stats.expectedFinish
    })
  const ranAny = rows.some((r) => r.stats.runs > 0)
  const minRuns = Math.min(...candidates.map((c) => (samples[candKey(c)] ?? []).length))
  const pct = (p: number) => `${Math.round(p * 100)}%`
  const intro = mode === 'pre-race' ? 'Simulate the race for each starting tyre.' : 'Simulate the rest of the race for each pit option, each “box now, then let the AI run the rest”.'

  return (
    <div className="bg-[#1a1326] rounded p-2.5 border border-[#7C3AED]/40 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="text-[10px] font-bold tracking-widest text-[#A78BFA] uppercase">Race Engineer</div>
        <label className="ml-auto flex items-center gap-1 text-[10px] text-[#FFFFFF] cursor-pointer">
          <input type="checkbox" checked={cautious} onChange={(e) => setCautious(e.target.checked)} disabled={running} className="accent-[#7C3AED]" />
          Cautious
        </label>
      </div>

      {!ranAny && !running && <p className="text-[11px] text-[#FFFFFF]">{intro}</p>}

      {ranAny && (
        <table className="w-full text-[11px] text-[#FFFFFF]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-[#FFFFFF]">
              <th className="text-left font-medium">Option</th>
              <th className="text-right font-medium">Exp</th>
              <th className="text-right font-medium">Bad</th>
              <th className="text-right font-medium">Pod</th>
              <th className="text-right font-medium">Pts</th>
              <th className="text-right font-medium">DNF</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, stats }, i) => {
              const has = stats.runs > 0
              const best = i === 0 && has
              return (
                <tr key={candKey(c)} className={best ? 'bg-[#7C3AED]/25' : ''}>
                  <td className="py-0.5">
                    <span className="flex items-center gap-1">
                      {(c.kind === 'pit' || c.kind === 'start') && <TyreIndicator compound={c.compound} size="sm" />}
                      <span className={best ? 'font-bold' : ''}>{candLabel(c)}</span>
                    </span>
                  </td>
                  <td className="text-right font-mono">{has ? `P${stats.expectedFinish.toFixed(1)}` : '—'}</td>
                  <td className="text-right font-mono">{has ? `P${stats.badDayFinish.toFixed(1)}` : '—'}</td>
                  <td className="text-right font-mono">{has ? pct(stats.pPodium) : '—'}</td>
                  <td className="text-right font-mono">{has ? pct(stats.pPoints) : '—'}</td>
                  <td className="text-right font-mono text-[#DC143C]">{has ? pct(stats.dnfRate) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="flex items-center gap-2">
        {running ? (
          <button onClick={() => { abortRef.current = true }} className="flex-1 py-1.5 text-xs font-bold uppercase tracking-widest rounded bg-[#DC143C] text-white">Stop</button>
        ) : (
          <button onClick={run} disabled={!circuit} className="flex-1 py-1.5 text-xs font-bold uppercase tracking-widest rounded bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-40">
            {ranAny ? 'Re-simulate' : 'Simulate'}
          </button>
        )}
        {(running || ranAny) && (
          <span className="text-[10px] text-[#FFFFFF] tabular-nums">
            {Number.isFinite(minRuns) ? minRuns : 0}/{FORECAST_TARGET}
            {budgetHit && ' · time-limited'}
          </span>
        )}
      </div>

      {ranAny && (
        <div className="text-[9px] text-[#FFFFFF]">Exp/Bad = finishing place (Bad = mean of the worst 25%). {cautious ? 'Ranked by bad day.' : 'Ranked by expected finish.'}</div>
      )}
    </div>
  )
}
