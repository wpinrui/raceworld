'use client'

import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { Panel } from '@/components/world/ui'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import type { RaceResult } from '@/lib/sim/types'

// A headline is a sequence of plain text and linked-entity spans, so names stay
// clickable while the surrounding copy reads as one terse broadcast line.
type Token =
  | { text: string }
  | { kind: 'driver'; id: string; name: string }
  | { kind: 'team'; id: string; name: string }

interface Headline {
  key: string
  accent: 'cyan' | 'red'
  tokens: Token[]
}

const t = (text: string): Token => ({ text })
const driver = (id: string, name: string): Token => ({ kind: 'driver', id, name })
const team = (id: string, name: string): Token => ({ kind: 'team', id, name })

// Most recent round (1-indexed) that has results, plus the results themselves.
function lastCompletedRound(raceResults: RaceResult[][]): { round: number; results: RaceResult[] } | null {
  for (let i = raceResults.length - 1; i >= 0; i--) {
    if (raceResults[i] && raceResults[i].length > 0) return { round: i + 1, results: raceResults[i] }
  }
  return null
}

export function HeadlinesPanel() {
  const raceResults = useSeasonStore((s) => s.raceResults)
  const driverStandings = useSeasonStore((s) => s.driverStandings)
  const constructorStandings = useSeasonStore((s) => s.constructorStandings)
  const year = useSeasonStore((s) => s.year)

  const headlines: Headline[] = []
  const last = lastCompletedRound(raceResults)

  if (!last) {
    // Early season — no race run yet. Lead with a season-opener preview.
    const opener = calendar2026[0]
    headlines.push({
      key: 'opener',
      accent: 'cyan',
      tokens: [t(`Lights out for the ${year} season — ${opener.name} opens at ${opener.location}`)],
    })
    const fav = driverStandings[0]
    if (fav) {
      headlines.push({
        key: 'fav',
        accent: 'cyan',
        tokens: [t('All eyes on '), driver(fav.driverId, fav.driverName), t(' as the grid lines up')],
      })
    }
    const favTeam = constructorStandings[0]
    if (favTeam) {
      headlines.push({
        key: 'fav-team',
        accent: 'red',
        tokens: [team(favTeam.teamId, favTeam.teamName), t(' head the constructors order into round 1')],
      })
    }
  } else {
    const race = calendar2026[last.round - 1]
    const winner = last.results.find((r) => r.finishPosition === 1)

    // 1. Last race winner.
    if (winner && race) {
      headlines.push({
        key: 'winner',
        accent: 'cyan',
        tokens: [driver(winner.driverId, winner.driverName), t(` wins the ${race.name}`)],
      })
    }

    // 2. Championship leader.
    const p1 = driverStandings[0]
    if (p1) {
      headlines.push({
        key: 'leader',
        accent: 'cyan',
        tokens: [driver(p1.driverId, p1.driverName), t(` leads the championship on ${p1.points} pts`)],
      })
    }

    // 3. Title gap, P1 vs P2.
    const p2 = driverStandings[1]
    if (p1 && p2) {
      const gap = p1.points - p2.points
      headlines.push({
        key: 'gap',
        accent: 'red',
        tokens:
          gap === 0
            ? [driver(p1.driverId, p1.driverName), t(' level with '), driver(p2.driverId, p2.driverName), t(' at the top')]
            : [
                driver(p1.driverId, p1.driverName),
                t(` ${gap} pts clear of `),
                driver(p2.driverId, p2.driverName),
              ],
      })
    }

    // 4. Constructors' leader.
    const c1 = constructorStandings[0]
    if (c1) {
      headlines.push({
        key: 'constructor',
        accent: 'red',
        tokens: [team(c1.teamId, c1.teamName), t(` top the constructors on ${c1.points} pts`)],
      })
    }

    // 5. Standout — biggest grid-to-flag climber in the last race, else the
    //    season's win leader.
    const climbers = last.results
      .filter((r) => !r.dnf && r.finishPosition !== null)
      .map((r) => ({ r, climb: r.gridPosition - (r.finishPosition ?? r.gridPosition) }))
      .sort((a, b) => b.climb - a.climb)
    const best = climbers[0]
    if (best && best.climb >= 2 && race) {
      headlines.push({
        key: 'climber',
        accent: 'cyan',
        tokens: [
          driver(best.r.driverId, best.r.driverName),
          t(` climbs ${best.climb} places at ${race.location}`),
        ],
      })
    } else {
      const winLeader = [...driverStandings].sort((a, b) => b.wins - a.wins)[0]
      if (winLeader && winLeader.wins > 0) {
        headlines.push({
          key: 'winleader',
          accent: 'cyan',
          tokens: [
            driver(winLeader.driverId, winLeader.driverName),
            t(` leads the way with ${winLeader.wins} ${winLeader.wins === 1 ? 'win' : 'wins'} so far`),
          ],
        })
      }
    }
  }

  // Keep the panel tight: 4–6 lines.
  const shown = headlines.slice(0, 6)

  return (
    <Panel title="Headlines" flush>
      <ul>
        {shown.map((h) => (
          <li
            key={h.key}
            className="flex items-start gap-3 px-5 py-2.5 border-b border-[#2A3142] last:border-b-0"
          >
            <span
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: h.accent === 'cyan' ? '#00D9FF' : '#DC143C' }}
            />
            <p className="text-sm leading-snug text-[#FFFFFF]">
              {h.tokens.map((tok, i) =>
                'text' in tok ? (
                  <span key={i}>{tok.text}</span>
                ) : tok.kind === 'driver' ? (
                  <DriverLink key={i} id={tok.id} className="font-semibold text-[#FFFFFF]">
                    {tok.name}
                  </DriverLink>
                ) : (
                  <TeamLink key={i} id={tok.id} className="font-semibold text-[#FFFFFF]">
                    {tok.name}
                  </TeamLink>
                ),
              )}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
