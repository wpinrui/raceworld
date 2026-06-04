'use client'

import { useState } from 'react'
import { Trash2, ChevronDown } from 'lucide-react'
import ReactCountryFlag from 'react-country-flag'
import type { Driver, Team } from '@/lib/sim/types'
import { STAT_KEYS, STAT_LABELS, computeOverall } from './stat-utils'
import { DriverLink } from '@/components/world/EntityLink'
import { OverallRing } from './OverallRing'
import { StatBar } from './StatBar'
import { StatSlider } from './StatSlider'
import { ContractBadge } from './ContractBadge'

export function makeDefaultDriver(teamId: string): Driver {
  return {
    id: `driver-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'New Driver',
    teamId,
    nationality: 'GB',
    gender: 'male',
    pace: 70,
    wetWeatherPace: 70,
    overtaking: 70,
    smoothness: 70,
    age: 25,
    peakPotential: 80,
    primeEnd: 32,
    narrativeModifier: 0,
    contractExpiresAfterSeason: 2026,
  }
}

export function DriverCard({ driver, teams, onUpdate, onRemove, currentYear }: {
  driver: Driver
  teams: Team[]
  onUpdate: (patch: Partial<Driver>) => void
  onRemove: () => void
  currentYear: number
}) {
  const [expanded, setExpanded] = useState(false)
  const overall = computeOverall(driver)

  return (
    <div className="rounded-xl bg-[#2A3142] overflow-hidden">
      <div className="p-4">
        {/* Header: ring + name + flag + controls */}
        <div className="flex items-center gap-3 mb-4">
          <OverallRing overall={overall} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <DriverLink id={driver.id} className="text-base font-semibold text-[#FFFFFF] truncate">{driver.name}</DriverLink>
              <ReactCountryFlag
                countryCode={driver.nationality || 'GB'}
                svg
                style={{ width: '1.25em', height: '1.25em', borderRadius: '2px', flexShrink: 0 }}
              />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-white">Age {driver.age}</span>
              <ContractBadge expiresAfter={driver.contractExpiresAfterSeason} currentYear={currentYear} />
            </div>
          </div>
          <button
            onClick={() => setExpanded((x) => !x)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#FFFFFF] hover:text-[#FFFFFF] hover:bg-[#303848] transition-colors shrink-0"
          >
            Edit
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={onRemove}
            className="p-1 rounded text-[#FFFFFF] hover:text-[#F87171] hover:bg-[#3A1A1A] transition-colors shrink-0"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* Stat bars */}
        <div className="space-y-2">
          {STAT_KEYS.map((k) => (
            <StatBar key={k} label={STAT_LABELS[k]} value={driver[k]} />
          ))}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#303848] p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[#FFFFFF] block mb-1">Name</label>
              <input
                type="text" value={driver.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                className="w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-[#FFFFFF] block mb-1">Team</label>
              <select
                value={driver.teamId}
                onChange={(e) => onUpdate({ teamId: e.target.value })}
                className="w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
              >
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-[#FFFFFF] block mb-1">Age</label>
                <input type="number" min={16} max={60} value={driver.age}
                  onChange={(e) => onUpdate({ age: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-[#FFFFFF] block mb-1">Potential</label>
                <input type="number" min={0} max={100} value={driver.peakPotential}
                  onChange={(e) => onUpdate({ peakPotential: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            {STAT_KEYS.map((k) => (
              <StatSlider
                key={k}
                label={STAT_LABELS[k]}
                value={driver[k]}
                onChange={(v) => onUpdate({ [k]: v })}
              />
            ))}
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#FFFFFF] w-20 shrink-0">Narrative</span>
              <input
                type="range" min={-20} max={20} value={driver.narrativeModifier}
                onChange={(e) => onUpdate({ narrativeModifier: Number(e.target.value) })}
                className="flex-1 h-1 cursor-pointer"
                style={{ accentColor: '#A855F7' }}
              />
              <span className={`text-sm font-semibold w-8 text-right shrink-0 ${driver.narrativeModifier > 0 ? 'text-[#10B981]'
                  : driver.narrativeModifier < 0 ? 'text-[#DC143C]'
                    : 'text-[#FFFFFF]'
                }`}>
                {driver.narrativeModifier > 0 ? '+' : ''}{driver.narrativeModifier}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
