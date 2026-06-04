'use client'

import { useMemo, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { realWorldTransition } from '@/lib/history/transitions'
import { Panel } from '@/components/world/ui'
import { NationalityFlag } from '@/components/world/NationalityFlag'

// Season-end consent for real-world team changes. Shown at the end-of-season stage (before contract
// negotiations fill the seats) when real-world mode is on. Each join/leave/rebrand is approved by
// default; uncheck to override (keep the team as-is). Applying writes the approved subset into the
// next-season grid; the engine market then fills the new/opened seats. Rookies enter automatically.
export function RealWorldChanges() {
  const phase = useSeasonStore((s) => s.phase)
  const year = useSeasonStore((s) => s.year)
  const realWorldMode = useSeasonStore((s) => s.realWorldMode)
  const pending = useSeasonStore((s) => s.pendingNextSeasonState)
  const applyRealWorldChanges = useSeasonStore((s) => s.applyRealWorldChanges)

  // Local "override" set: a change is approved unless its key is in here.
  const [overridden, setOverridden] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setOverridden((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const transition = useMemo(
    () => (pending ? realWorldTransition(year, pending.teams) : null),
    [pending, year],
  )

  if (phase !== 'end-of-season' || !realWorldMode || !transition || !transition.hasData) return null
  const { teamJoins, teamLeaves, teamRebrands, rookieEntries, toYear } = transition
  const nChanges = teamJoins.length + teamLeaves.length + teamRebrands.length
  if (nChanges === 0 && rookieEntries.length === 0) return null

  const approved = (key: string) => !overridden.has(key)

  function apply() {
    if (!transition) return
    applyRealWorldChanges({
      joins: transition.teamJoins.filter((j) => approved(`join:${j.id}`)),
      leaves: transition.teamLeaves.filter((l) => approved(`leave:${l.id}`)).map((l) => l.id),
      rebrands: transition.teamRebrands
        .filter((r) => approved(`rebrand:${r.id}`))
        .map((r) => ({ id: r.id, name: r.to.name, shortName: r.to.shortName, color: r.to.color, nationality: r.to.nationality })),
    })
    setOverridden(new Set())
  }

  const Row = ({ k, swatch, children }: { k: string; swatch: string; children: React.ReactNode }) => (
    <label className="flex items-center gap-3 px-4 py-2 hover:bg-[#0F1419]/50 cursor-pointer">
      <input type="checkbox" checked={approved(k)} onChange={() => toggle(k)} className="w-4 h-4 shrink-0 accent-[#00D9FF] cursor-pointer" />
      <span className="w-1 h-4 rounded-sm shrink-0" style={{ backgroundColor: swatch }} />
      <span className="flex-1 text-sm text-[#FFFFFF]">{children}</span>
    </label>
  )

  return (
    <Panel title={`Real-World Changes · ${toYear}`} flush>
      <div className="divide-y divide-[#2A3142]">
        {teamRebrands.map((r) => (
          <Row key={`rebrand:${r.id}`} k={`rebrand:${r.id}`} swatch={r.to.color}>
            <span className="text-[#00D9FF] text-[10px] uppercase tracking-widest mr-2">Rebrand</span>
            {r.from.name} becomes {r.to.name}
          </Row>
        ))}
        {teamLeaves.map((l) => (
          <Row key={`leave:${l.id}`} k={`leave:${l.id}`} swatch="#DC143C">
            <span className="text-[#DC143C] text-[10px] uppercase tracking-widest mr-2">Leaves</span>
            {l.name} drops off the grid
          </Row>
        ))}
        {teamJoins.map((j) => (
          <Row key={`join:${j.id}`} k={`join:${j.id}`} swatch={j.color}>
            <span className="text-[#10B981] text-[10px] uppercase tracking-widest mr-2">Joins</span>
            {j.name} enters the grid
          </Row>
        ))}
      </div>

      {rookieEntries.length > 0 && (
        <div className="px-4 py-3 border-t border-[#2A3142]">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5">Entering the driver market</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {rookieEntries.map((d) => (
              <span key={d.id} className="inline-flex items-center gap-1.5 text-sm text-[#FFFFFF]">
                <NationalityFlag code={d.nationality} />{d.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {nChanges > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#2A3142]">
          <span className="text-xs text-[#FFFFFF]">Unchecked changes are overridden (the grid keeps them as-is).</span>
          <button onClick={apply} className="shrink-0 px-4 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] text-xs font-bold uppercase tracking-wide hover:bg-[#009CB8] transition-colors">
            Apply changes
          </button>
        </div>
      )}
    </Panel>
  )
}
