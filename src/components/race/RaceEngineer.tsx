'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import type { Driver, RaceState, TyreCompound } from '@/lib/sim/types'
import { useRaceStore } from '@/lib/store/race-store'
import { getMoistureAtLap } from '@/lib/sim/weather'
import { tyreStepsOutOfWindow } from '@/lib/sim/tyres'
import { forecastSingleRun, summarizeForecast, type ForecastCandidate, type ForecastSample } from '@/lib/sim/strategy-forecast'
import TyreIndicator from './TyreIndicator'

const ALL_COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet']
const FORECAST_TARGET = 120 // runs per option at full convergence
// One run from late in a race is sub-ms, but a full-distance run is ~0.5s (the AI replans every car each lap).
// So we don't fix a run count per yield: we run for at most BURST_MS, then yield — the UI stays responsive
// whether a run is fast or slow. A total wall-clock BUDGET caps the expensive (early/pre-race) case so it
// can't run for minutes; it stops with whatever sample it gathered (flagged as time-limited).
const BURST_MS = 80
const BUDGET_MS = 12000

type CandKey = string
const candKey = (c: ForecastCandidate): CandKey => (c.kind === 'pit' || c.kind === 'start' ? `${c.kind}:${c.compound}` : c.kind)
const candLabel = (c: ForecastCandidate): string =>
  c.kind === 'auto' ? 'Auto (AI)' : c.kind === 'hold' ? 'Stay out' : c.kind === 'pit' ? 'Pit' : 'Start'

// The compounds that actually suit the track right now (no slicks in the wet, no wets in the dry). Current
// moisture is already observable, so reading it here is no forecast leak.
function suitableCompounds(moisture: number): TyreCompound[] {
  const inWindow = ALL_COMPOUNDS.filter((c) => tyreStepsOutOfWindow(c, moisture) === 0)
  return inWindow.length ? inWindow : ALL_COMPOUNDS.filter((c) => tyreStepsOutOfWindow(c, moisture) <= 1)
}

// Options worth simulating. Pre-race: which grid tyre to start on. In-race: ride the AI plan, hold, or box
// now for a suitable compound.
function buildCandidates(moisture: number, mode: 'pre-race' | 'racing'): ForecastCandidate[] {
  const compounds = suitableCompounds(moisture)
  if (mode === 'pre-race') return compounds.map((c) => ({ kind: 'start', compound: c }) as ForecastCandidate)
  return [{ kind: 'auto' }, ...compounds.map((c) => ({ kind: 'pit', compound: c }) as ForecastCandidate), { kind: 'hold' }]
}

// Race Engineer talent: Monte-Carlo strategy advice. Runs the real engine to the flag many times under each
// option and reports where the player's car lands. The simulation stays faithful (every run resamples the
// engine's true luck); the risk preference lives only in the ranking — Cautious ranks by the bad-day figure
// (worst 25%) instead of the average, never by skewing the rolls. Shown only while paused (the forecast is a
// snapshot) — pre-race, or mid-race once the player pauses.
export function RaceEngineer({ driver, raceState, mode }: { driver: Driver; raceState: RaceState; mode: 'pre-race' | 'racing' }) {
  const drivers = useRaceStore((s) => s.drivers)
  const teams = useRaceStore((s) => s.teams)
  const circuit = useRaceStore((s) => s.selectedCircuit)
  const [cautious, setCautious] = useState(false)
  const [running, setRunning] = useState(false)
  const [budgetHit, setBudgetHit] = useState(false)
  const [samples, setSamples] = useState<Record<CandKey, ForecastSample[]>>({})
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
      const acc: Record<CandKey, ForecastSample[]> = Object.fromEntries(candidates.map((c) => [candKey(c), []]))
      setSamples({ ...acc })
      const startedAt = performance.now()
      let done = false
      let timedOut = false
      while (!done && !abortRef.current && !timedOut) {
        // Run for up to BURST_MS (one run at minimum, even if it alone is longer), spreading runs evenly across
        // candidates so the live table stays a fair comparison, then yield so the UI can paint / Stop can fire.
        const burstStart = performance.now()
        let advanced = true
        while (advanced && performance.now() - burstStart < BURST_MS) {
          advanced = false
          for (const c of candidates) {
            const k = candKey(c)
            if (acc[k].length >= FORECAST_TARGET) continue
            acc[k].push(forecastSingleRun(start, drivers, teams, circuit, raceState.year, driver.id, c))
            advanced = true
            if (performance.now() - burstStart >= BURST_MS) break
          }
        }
        setSamples(Object.fromEntries(Object.entries(acc).map(([kk, v]) => [kk, v.slice()])))
        await new Promise((r) => setTimeout(r, 0))
        done = candidates.every((c) => acc[candKey(c)].length >= FORECAST_TARGET)
        timedOut = performance.now() - startedAt >= BUDGET_MS
      }
      if (timedOut && !done) setBudgetHit(true)
    } finally {
      setRunning(false)
    }
  }

  const fieldSize = raceState.drivers.length
  const rows = candidates
    .map((c) => ({ c, stats: summarizeForecast(samples[candKey(c)] ?? [], fieldSize, raceState.year) }))
    .sort((a, b) => (cautious ? a.stats.badDayFinish - b.stats.badDayFinish : a.stats.expectedFinish - b.stats.expectedFinish))
  const ranAny = rows.some((r) => r.stats.runs > 0)
  const minRuns = Math.min(...candidates.map((c) => (samples[candKey(c)] ?? []).length))
  const pct = (p: number) => `${Math.round(p * 100)}%`
  const intro = mode === 'pre-race' ? 'Simulate the race for each starting tyre.' : 'Simulate the rest of the race for each pit option. Each is “do it now, then let the AI run the rest”.'

  return (
    <div className="bg-[#1a1326] rounded p-2.5 border border-[#7C3AED]/40 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="text-[10px] font-bold tracking-widest text-[#A78BFA] uppercase">Race Engineer</div>
        <label className="ml-auto flex items-center gap-1 text-[10px] text-[#FFFFFF] cursor-pointer">
          <input type="checkbox" checked={cautious} onChange={(e) => setCautious(e.target.checked)} className="accent-[#7C3AED]" />
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
            {rows.map(({ c, stats }, i) => (
              <tr key={candKey(c)} className={i === 0 ? 'bg-[#7C3AED]/25' : ''}>
                <td className="py-0.5">
                  <span className="flex items-center gap-1">
                    {(c.kind === 'pit' || c.kind === 'start') && <TyreIndicator compound={c.compound} size="sm" />}
                    <span className={i === 0 ? 'font-bold' : ''}>{candLabel(c)}</span>
                  </span>
                </td>
                <td className="text-right font-mono">P{stats.expectedFinish.toFixed(1)}</td>
                <td className="text-right font-mono">P{stats.badDayFinish.toFixed(1)}</td>
                <td className="text-right font-mono">{pct(stats.pPodium)}</td>
                <td className="text-right font-mono">{pct(stats.pPoints)}</td>
                <td className="text-right font-mono text-[#DC143C]">{pct(stats.dnfRate)}</td>
              </tr>
            ))}
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
