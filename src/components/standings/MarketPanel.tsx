'use client'

import { ArrowRight } from 'lucide-react'
import type { EndOfSeasonSummary, Team } from '@/lib/sim/types'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'

interface Props {
  summary: EndOfSeasonSummary
  teams: Team[]
}

function TeamPill({ id, name, color }: { id: string; name: string; color?: string }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      {color && <span className="w-1.5 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />}
      <TeamLink id={id} className="text-[#FFFFFF] truncate">{name}</TeamLink>
    </span>
  )
}

const Arrow = () => <ArrowRight size={13} className="text-[#FFFFFF] shrink-0" />

function MoveRow({ driverId, driverName, badge, movement, contract, media }: {
  driverId: string; driverName: string; badge?: boolean
  movement: React.ReactNode; contract?: React.ReactNode; media: string
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#0F1419]/60">
      <span className="w-40 shrink-0 flex items-center gap-1.5 min-w-0">
        <DriverLink id={driverId} className="text-[#FFFFFF] font-medium truncate">{driverName}</DriverLink>
        {badge && <span className="text-[9px] font-bold uppercase tracking-wide bg-[#00D9FF] text-[#0F1419] rounded px-1 py-0.5 shrink-0">New</span>}
      </span>
      <span className="flex-1 flex items-center gap-2 text-xs min-w-0">{movement}</span>
      <span className="w-28 text-right text-xs text-[#FFFFFF] tabular-nums shrink-0">{contract}</span>
      <span className="w-10 text-right text-sm font-semibold text-[#00D9FF] tabular-nums shrink-0">{media}</span>
    </div>
  )
}

function Section({ title, count, tone, children }: { title: string; count: number; tone: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1 px-3">
        {title} <span style={{ color: tone }}>· {count}</span>
      </p>
      <div className="divide-y divide-[#2A3142]/40">{children}</div>
    </div>
  )
}

export function MarketPanel({ summary, teams }: Props) {
  const color = (id: string) => teams.find((t) => t.id === id)?.color
  const sorted = [...summary.marketMoves].sort((a, b) => b.mediaScore - a.mediaScore)
  const realMoves = sorted.filter((m) => !m.isResignation)
  const reSignings = sorted.filter((m) => m.isResignation)
  const dropped = [...(summary.droppedDrivers ?? [])].sort((a, b) => b.mediaScore - a.mediaScore)

  if (sorted.length === 0 && dropped.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">No market activity this off-season.</p>
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Section title="Transfers & Signings" count={realMoves.length} tone="#00D9FF">
        {realMoves.length === 0
          ? <p className="px-3 py-2 text-sm text-[#FFFFFF]">No driver changed teams.</p>
          : realMoves.map((m) => {
              const isRookie = m.mediaScore === 0
              return (
                <MoveRow
                  key={m.driverId}
                  driverId={m.driverId}
                  driverName={m.driverName}
                  badge={isRookie}
                  movement={
                    <>
                      {m.fromTeamId
                        ? <TeamPill id={m.fromTeamId} name={teams.find((t) => t.id === m.fromTeamId)?.name ?? m.fromTeamId} color={color(m.fromTeamId)} />
                        : <span className="italic text-[#FFFFFF] truncate">{isRookie ? 'Debut' : 'Free Agent'}</span>}
                      <Arrow />
                      <TeamPill id={m.toTeamId} name={m.toTeamName} color={color(m.toTeamId)} />
                    </>
                  }
                  contract={`${m.contractLength}yr · ${m.contractExpiresAfterSeason}`}
                  media={isRookie ? '—' : m.mediaScore.toFixed(1)}
                />
              )
            })}
      </Section>

      {reSignings.length > 0 && (
        <Section title="Re-signings" count={reSignings.length} tone="#FFFFFF">
          {reSignings.map((m) => (
            <MoveRow
              key={m.driverId}
              driverId={m.driverId}
              driverName={m.driverName}
              movement={<TeamPill id={m.toTeamId} name={m.toTeamName} color={color(m.toTeamId)} />}
              contract={`${m.contractLength}yr · ${m.contractExpiresAfterSeason}`}
              media={m.mediaScore.toFixed(1)}
            />
          ))}
        </Section>
      )}

      {dropped.length > 0 && (
        <Section title="Dropped" count={dropped.length} tone="#DC143C">
          {dropped.map((d) => (
            <MoveRow
              key={d.driverId}
              driverId={d.driverId}
              driverName={d.driverName}
              movement={
                <>
                  <TeamPill id={d.fromTeamId} name={d.fromTeamName} color={color(d.fromTeamId)} />
                  <Arrow />
                  <span className="italic text-[#DC143C] shrink-0">Released</span>
                </>
              }
              media={d.mediaScore.toFixed(1)}
            />
          ))}
        </Section>
      )}
    </div>
  )
}
