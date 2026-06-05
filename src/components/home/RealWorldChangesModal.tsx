'use client'

import { useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import type { RealWorldTransition } from '@/lib/history/transitions'

// Season-start gate for real-world team changes (they take effect next season; the news announces them
// mid-season). Surfaced as an UNDISMISSABLE modal at the season opener: the join/leave/rebrand list must
// be acted on, there is no skipping it. Each change is approved by default; uncheck to override (keep the
// team as-is). Applying writes the approved subset and marks the changes resolved, which closes the modal.
// `transition` is the pending change set (null when there's nothing to act on).
const PRIMARY = 'px-4 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] text-xs font-bold uppercase tracking-wide hover:bg-[#009CB8] transition-colors'

export function RealWorldChangesModal({
  open,
  transition,
}: {
  open: boolean
  transition: RealWorldTransition | null
}) {
  const applyRealWorldChanges = useSeasonStore((s) => s.applyRealWorldChanges)
  // A change is approved unless its key is in here. The modal is remounted per season (keyed on the
  // pending set in Nav), so this starts fresh each time without an effect.
  const [overridden, setOverridden] = useState<Set<string>>(new Set())

  if (!open || !transition) return null
  const { teamJoins, teamLeaves, teamRebrands, toYear } = transition
  const approved = (key: string) => !overridden.has(key)
  const toggle = (key: string) => setOverridden((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  function apply() {
    if (!transition) return
    applyRealWorldChanges({
      joins: transition.teamJoins.filter((j) => approved(`join:${j.id}`)),
      leaves: transition.teamLeaves.filter((l) => approved(`leave:${l.id}`)).map((l) => l.id),
      rebrands: transition.teamRebrands
        .filter((r) => approved(`rebrand:${r.id}`))
        .map((r) => ({ id: r.id, name: r.to.name, shortName: r.to.shortName, color: r.to.color, nationality: r.to.nationality })),
    })
    // No onClose needed: applying marks the changes resolved, so the parent's `pendingRW` goes null
    // and the modal closes on its own.
  }

  const Row = ({ k, swatch, tag, tagColor, children }: { k: string; swatch: string; tag: string; tagColor: string; children: React.ReactNode }) => (
    <label className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#0F1419]/50 cursor-pointer">
      <input type="checkbox" checked={approved(k)} onChange={() => toggle(k)} className="w-4 h-4 shrink-0 accent-[#00D9FF] cursor-pointer" />
      <span className="w-1 h-4 rounded-sm shrink-0" style={{ backgroundColor: swatch }} />
      <span className="text-[10px] uppercase tracking-widest mr-1 shrink-0" style={{ color: tagColor }}>{tag}</span>
      <span className="flex-1 text-sm text-[#FFFFFF]">{children}</span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#1E2431] border border-[#2A3142] rounded-xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2A3142]">
          <span className="font-display text-sm tracking-wider uppercase text-[#FFFFFF]">Real-World Changes · {toYear}</span>
          <span className="text-[10px] uppercase tracking-widest text-[#00D9FF]">Grid update</span>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#2A3142]">
          {teamRebrands.map((r) => (
            <Row key={`rebrand:${r.id}`} k={`rebrand:${r.id}`} swatch={r.to.color} tag="Rebrand" tagColor="#00D9FF">
              {r.from.name} becomes {r.to.name}
            </Row>
          ))}
          {teamLeaves.map((l) => (
            <Row key={`leave:${l.id}`} k={`leave:${l.id}`} swatch="#DC143C" tag="Leaves" tagColor="#DC143C">
              {l.name} drops off the grid
            </Row>
          ))}
          {teamJoins.map((j) => (
            <Row key={`join:${j.id}`} k={`join:${j.id}`} swatch={j.color} tag="Joins" tagColor="#10B981">
              {j.name} enters the grid
            </Row>
          ))}
        </div>

        <div className="flex items-center justify-end px-5 py-3 border-t border-[#2A3142]">
          <button onClick={apply} className={PRIMARY}>Apply changes</button>
        </div>
      </div>
    </div>
  )
}
