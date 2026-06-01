'use client'

import ReactCountryFlag from 'react-country-flag'
import type { Driver, Team, Circuit } from '@/lib/sim/types'

interface Props {
  drivers: Driver[]
  teams: Team[]
  forms: Record<string, number>
  strategyNoise: number
  currentCircuit: Circuit | undefined
  onStrategyNoiseChange: (v: number) => void
  onFormChange: (id: string, v: number) => void
  onBegin: () => void
  onAutoSim: () => void
}

export function PreQualPanel({
  drivers, teams, forms, strategyNoise, currentCircuit,
  onStrategyNoiseChange, onFormChange, onBegin, onAutoSim,
}: Props) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-end gap-4 px-6 pt-5 pb-4 border-b border-[#2A3142]">
        <div className="flex-1">
          <p className="text-xs text-[#FFFFFF] uppercase tracking-wider mb-1">Race Weekend</p>
          <h2 className="font-display text-xl tracking-wider uppercase text-[#E8EAED]">
            {currentCircuit?.name ?? '—'}
          </h2>
          <p className="text-sm text-[#FFFFFF] mt-0.5">
            {currentCircuit?.location} · {currentCircuit?.laps} laps
          </p>
        </div>

        <div className="shrink-0">
          <label className="block text-xs font-bold tracking-wider text-[#FFFFFF] uppercase mb-2">
            Strategy Noise <span className="text-[#00D9FF]">{Math.round(strategyNoise * 100)}%</span>
          </label>
          <input
            type="range" min={0} max={1} step={0.05}
            value={strategyNoise}
            onChange={(e) => onStrategyNoiseChange(Number(e.target.value))}
            className="w-32 accent-[#00D9FF]"
          />
        </div>

        <button
          onClick={onBegin}
          className="px-6 py-2.5 bg-[#00D9FF] hover:bg-[#009CB8] text-[#0F1419] text-sm font-black tracking-widest uppercase rounded transition-colors shrink-0"
        >
          Begin Race Weekend
        </button>

        <button
          onClick={onAutoSim}
          className="px-4 py-2.5 bg-[#2A3142] hover:bg-[#303848] text-[#FFFFFF] text-xs font-bold tracking-widest uppercase rounded transition-colors shrink-0 cursor-pointer"
        >
          Sim Rest of Season
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-6 py-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
          <h2 className="font-semibold text-sm tracking-widest text-[#E8EAED] uppercase">Driver Forms</h2>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[#FFFFFF] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
              <th className="text-left py-1 pr-2">Driver</th>
              <th className="text-left py-1 px-2">Team</th>
              <th className="text-center py-1 px-2 w-36">Form</th>
              <th className="text-center py-1 px-2 w-16">Car</th>
              <th className="text-center py-1 px-2 w-16">Pace</th>
              <th className="text-center py-1 px-2 w-16">Wet</th>
              <th className="text-center py-1 px-2 w-16">Ovt</th>
              <th className="text-center py-1 px-2 w-16">Smt</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const team = teams.find((t) => t.id === d.teamId)
              const form = forms[d.id] ?? 5
              return (
                <tr key={d.id} className="border-b border-[#1a2030] hover:bg-[#1E2431] transition-colors">
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: team?.color }} />
                      <ReactCountryFlag countryCode={d.nationality || 'GB'} svg style={{ width: '1.1em', height: '1.1em', borderRadius: '2px', flexShrink: 0 }} />
                      <span className="text-sm font-medium text-[#E8EAED]">{d.name}</span>
                    </div>
                  </td>
                  <td className="py-1 px-2 text-sm text-[#FFFFFF]">{team?.name ?? '—'}</td>
                  <td className="py-1 px-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="range" min={0} max={10} step={0.5}
                        value={form}
                        onChange={(e) => onFormChange(d.id, Number(e.target.value))}
                        className="w-20 accent-[#00D9FF]"
                      />
                      <span className={`text-xs w-6 text-right ${form > 5 ? 'text-[#10B981]' : form < 5 ? 'text-[#DC143C]' : 'text-[#FFFFFF]'}`}>
                        {form.toFixed(1)}
                      </span>
                    </div>
                  </td>
                  <td className="py-1 px-2 text-center text-sm font-semibold text-[#FFFFFF]">{team?.carPace ?? '—'}</td>
                  {(['pace', 'wetWeatherPace', 'overtaking', 'smoothness'] as const).map((stat) => (
                    <td key={stat} className="py-1 px-2 text-center text-sm font-semibold text-[#E8EAED]">{d[stat]}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
