'use client'

import { Trophy, TrendingUp, TrendingDown, Star } from 'lucide-react'
import type { EndOfSeasonSummary, Driver, Team, DriverStanding, ConstructorStanding } from '@/lib/sim/types'
import { ProgressionPanel } from '@/components/standings/ProgressionPanel'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { DriverHover } from '@/components/world/DriverHover'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import type { DriverCardResolver } from '@/components/news/LinkedText'

interface Props {
  summary: EndOfSeasonSummary
  drivers: Driver[]
  teams: Team[]
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
}

// Overall weighting (GDD §Driver progression curve) — used to turn per-stat
// changes into a single "how much did this driver move" number.
const STAT_WEIGHT: Record<string, number> = {
  pace: 0.6,
  smoothness: 0.2,
  overtaking: 0.1,
  wetWeatherPace: 0.1,
}

interface Mover {
  driverId: string
  name: string
  teamName: string
  delta: number
}

function computeMovers(summary: EndOfSeasonSummary, drivers: Driver[], teams: Team[]): Mover[] {
  const teamName = (id: string) => (id === '' ? 'Free Agent' : teams.find((t) => t.id === id)?.name ?? '—')
  const byId = new Map<string, Mover>()
  for (const ev of summary.progressionEvents) {
    const driver = drivers.find((d) => d.id === ev.driverId)
    const m = byId.get(ev.driverId) ?? {
      driverId: ev.driverId,
      name: ev.driverName,
      teamName: teamName(driver?.teamId ?? ''),
      delta: 0,
    }
    m.delta += (STAT_WEIGHT[ev.stat] ?? 0) * (ev.after - ev.before)
    byId.set(ev.driverId, m)
  }
  return [...byId.values()].filter((m) => Math.abs(m.delta) >= 0.05)
}

function ChampionCard({ kind, name, sub }: { kind: string; name: React.ReactNode; sub: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-[#0F1419] border border-[#E8C547]/40 px-5 py-4">
      <Trophy size={30} className="text-[#E8C547] shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">{kind}</p>
        <p className="font-display text-xl tracking-wide text-[#FFFFFF] truncate">{name}</p>
        <p className="text-xs text-[#FFFFFF] tabular-nums">{sub}</p>
      </div>
    </div>
  )
}

function MoverCard({ label, mover, up, card }: { label: string; mover: Mover | undefined; up: boolean; card: DriverCardResolver }) {
  const accent = up ? '#10B981' : '#DC143C'
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <div className="rounded-xl bg-[#0F1419] border border-[#2A3142] px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} style={{ color: accent }} />
        <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">{label}</p>
      </div>
      {mover ? (
        <>
          <p className="font-semibold text-[#FFFFFF]"><DriverHover id={mover.driverId} card={card}><DriverLink id={mover.driverId}>{mover.name}</DriverLink></DriverHover></p>
          <p className="text-xs text-[#FFFFFF] flex items-center justify-between">
            <span>{mover.teamName}</span>
            <span className="tabular-nums font-semibold" style={{ color: accent }}>
              {mover.delta > 0 ? '+' : ''}{mover.delta.toFixed(1)} OVR
            </span>
          </p>
        </>
      ) : (
        <p className="text-sm text-[#FFFFFF]">—</p>
      )}
    </div>
  )
}

export function SeasonReviewPanel({ summary, drivers, teams, driverStandings, constructorStandings }: Props) {
  const card = useLiveDriverCards()
  const champ = driverStandings[0]
  const runnerUp = driverStandings[1]
  const wcc = constructorStandings[0]
  const champWins = champ?.wins ?? 0
  const margin = champ && runnerUp ? champ.points - runnerUp.points : 0

  const movers = computeMovers(summary, drivers, teams)
  const mostImproved = movers.length ? movers.reduce((a, b) => (b.delta > a.delta ? b : a)) : undefined
  const steepestDecline = movers.length ? movers.reduce((a, b) => (b.delta < a.delta ? b : a)) : undefined
  const hasImproved = mostImproved && mostImproved.delta > 0
  const hasDeclined = steepestDecline && steepestDecline.delta < 0

  // Best uncontracted prospect by raw pace.
  const freeAgents = drivers.filter((d) => d.teamId === '')
  const oneToWatch = freeAgents.length ? freeAgents.reduce((a, b) => (b.pace > a.pace ? b : a)) : undefined

  const topFive = driverStandings.slice(0, 5)

  return (
    <div className="space-y-5">
      {/* Champion spotlight */}
      <div className="grid gap-4 sm:grid-cols-2">
        {champ && (
          <ChampionCard
            kind={`${summary.seasonYear} World Champion`}
            name={<DriverHover id={champ.driverId} card={card}><DriverLink id={champ.driverId}>{champ.driverName}</DriverLink></DriverHover>}
            sub={`${champ.teamName} · ${champWins} ${champWins === 1 ? 'win' : 'wins'} · ${champ.points} pts`}
          />
        )}
        {wcc && (
          <ChampionCard
            kind={`${summary.seasonYear} Constructors' Champion`}
            name={<TeamLink id={wcc.teamId}>{wcc.teamName}</TeamLink>}
            sub={`${wcc.points} pts`}
          />
        )}
      </div>

      {/* Title story */}
      {champ && runnerUp && (
        <p className="text-sm text-[#FFFFFF]">
          <span className="font-semibold">{champ.driverName}</span>
          {margin === 0
            ? ` took the title on countback from ${runnerUp.driverName}.`
            : ` sealed the championship by ${margin} ${margin === 1 ? 'point' : 'points'} over ${runnerUp.driverName}.`}
        </p>
      )}

      {/* Season superlatives + standout prospect */}
      {(hasImproved || hasDeclined || oneToWatch) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {hasImproved && <MoverCard label="Most Improved" mover={mostImproved} up card={card} />}
          {hasDeclined && <MoverCard label="Steepest Decline" mover={steepestDecline} up={false} card={card} />}
          {oneToWatch && (
            <div className="rounded-xl bg-[#0F1419] border border-[#2A3142] px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <Star size={15} className="text-[#00D9FF]" />
                <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">One to Watch</p>
              </div>
              <p className="font-semibold text-[#FFFFFF]"><DriverHover id={oneToWatch.id} card={card}><DriverLink id={oneToWatch.id}>{oneToWatch.name}</DriverLink></DriverHover></p>
              <p className="text-xs text-[#FFFFFF] flex items-center justify-between">
                <span>Free agent · age {oneToWatch.age}</span>
                <span className="tabular-nums font-semibold text-[#00D9FF]">{oneToWatch.pace} pace</span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Final top five */}
      {topFive.length > 0 && (
        <div className="rounded-xl bg-[#0F1419] border border-[#2A3142] overflow-hidden">
          <p className="px-4 py-2.5 text-[10px] uppercase tracking-widest text-[#FFFFFF] border-b border-[#2A3142]">
            Final Championship · Top 5
          </p>
          <div>
            {topFive.map((d, i) => {
              const color = teams.find((t) => t.id === d.teamId)?.color ?? '#6B7280'
              return (
                <div key={d.driverId} className="flex items-center gap-3 px-4 py-2 border-b border-[#2A3142]/50 last:border-0">
                  <span className="w-5 text-right tabular-nums text-[#FFFFFF] font-semibold">{i + 1}</span>
                  <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                  <DriverHover id={d.driverId} card={card} className="flex-1 truncate min-w-0"><DriverLink id={d.driverId} className="flex-1 text-sm text-[#FFFFFF] font-medium truncate">{d.driverName}</DriverLink></DriverHover>
                  <TeamLink id={d.teamId} className="text-xs text-[#FFFFFF] truncate hidden sm:block">{d.teamName}</TeamLink>
                  <span className="w-14 text-right tabular-nums text-sm text-[#FFFFFF] font-semibold">{d.points}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Full development table — opt-in, not in your face */}
      <details className="rounded-xl bg-[#0F1419] border border-[#2A3142] overflow-hidden">
        <summary className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] cursor-pointer select-none hover:bg-[#1A2030]">
          All driver development
        </summary>
        <div className="p-4 border-t border-[#2A3142]">
          <ProgressionPanel summary={summary} drivers={drivers} />
        </div>
      </details>
    </div>
  )
}
