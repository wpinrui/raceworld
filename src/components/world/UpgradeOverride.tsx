'use client'

import { useState } from 'react'
import { Pencil, Check } from 'lucide-react'
import type { TeamDevPlan } from '@/lib/sim/types'
import { useSeasonStore } from '@/lib/store/season-store'
import { Panel } from '@/components/world/ui'

// God-mode view & edit of a team's next car upgrade before it is delivered (GDD
// §Development cycle). The development cycle and delivery round are randomised and
// not player-influenceable, so they are shown read-only; only the upgrade's impact
// (final post-penalty pace gain) and the 5% failure outcome can be overridden.
export function UpgradeOverride({
  teamId, devPlan, currentRound, totalRounds,
}: {
  teamId: string
  devPlan: TeamDevPlan
  currentRound: number
  totalRounds: number
}) {
  const setPendingUpgrade = useSeasonStore((s) => s.setPendingUpgrade)
  const [editing, setEditing] = useState(false)

  const failed = devPlan.pendingFailed ?? false
  const paceDelta = devPlan.pendingPaceDelta ?? 0
  const thisSeason = devPlan.nextUpgradeRound <= totalRounds
  const racesAway = devPlan.nextUpgradeRound - currentRound

  const inputClass = 'w-24 px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none'

  return (
    <Panel>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Car development</p>
        <button
          onClick={() => setEditing((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#303848] transition-colors"
        >
          {editing ? <Check size={13} /> : <Pencil size={13} />}
          {editing ? 'Done' : 'God mode'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <div className="rounded-lg bg-[#0F1419] border border-[#2A3142] px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Next upgrade</p>
          <p className="text-sm font-semibold text-[#FFFFFF] mt-0.5">
            {thisSeason
              ? <>Round {devPlan.nextUpgradeRound}{' '}
                  <span className="font-normal text-[#FFFFFF]">
                    {racesAway <= 0 ? '(due now)' : `(in ${racesAway} race${racesAway > 1 ? 's' : ''})`}
                  </span>
                </>
              : 'None this season'}
          </p>
        </div>
        <div className="rounded-lg bg-[#0F1419] border border-[#2A3142] px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Development cycle</p>
          <p className="text-sm font-semibold text-[#FFFFFF] mt-0.5">{devPlan.cycleLength} races</p>
        </div>
        <div className="rounded-lg bg-[#0F1419] border border-[#2A3142] px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Projected impact</p>
          <p className={`text-sm font-semibold mt-0.5 ${failed ? 'text-[#DC143C]' : paceDelta > 0 ? 'text-[#10B981]' : 'text-[#FFFFFF]'}`}>
            {failed ? 'Will fail — no gain' : `+${paceDelta.toFixed(1)} pace`}
          </p>
        </div>
      </div>

      {editing && (
        <div className="pt-3 border-t border-[#2A3142] space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-[#FFFFFF]">Impact (pace gain)</label>
            <input
              type="number" min={0} step={0.1} value={paceDelta} disabled={failed}
              onChange={(e) => setPendingUpgrade(teamId, { paceDelta: Number(e.target.value) })}
              className={inputClass + (failed ? ' opacity-40' : '')}
            />
            <label className="flex items-center gap-2 text-xs text-[#FFFFFF] cursor-pointer">
              <input
                type="checkbox" checked={failed}
                onChange={(e) => setPendingUpgrade(teamId, { failed: e.target.checked })}
                style={{ accentColor: '#DC143C' }}
              />
              Force failure (no gain)
            </label>
          </div>
          <p className="text-[10px] text-[#FFFFFF]">
            Cycle and round are randomised and fixed; only the impact is editable, until the upgrade is delivered.
          </p>
        </div>
      )}
    </Panel>
  )
}
