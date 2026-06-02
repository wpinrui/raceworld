import type { DriverCareer, DriverAttributes } from './types'
import { countryName } from '@/data/countries'

// Auto-generated driver biography. Plain, factual sentences derived from career totals,
// attributes and team history, so it always matches the save.

type TeamStrength = 'front-running' | 'midfield' | 'backmarker' | null

function pronouns(gender: 'male' | 'female') {
  return gender === 'female'
    ? { subj: 'she', obj: 'her', poss: 'her' }
    : { subj: 'he', obj: 'him', poss: 'his' }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] || fullName
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

interface Stint { teamId: string; teamName: string; startYear: number; endYear: number; races: number }

function buildStints(seasons: DriverCareer['seasons']): Stint[] {
  const asc = [...seasons].sort((a, b) => a.year - b.year)
  const out: Stint[] = []
  for (const s of asc) {
    const last = out[out.length - 1]
    if (last && last.teamId === s.teamId) {
      last.endYear = s.year
      last.races += s.races
    } else {
      out.push({ teamId: s.teamId, teamName: s.teamName, startYear: s.year, endYear: s.year, races: s.races })
    }
  }
  return out
}

function stintRange(s: Stint): string {
  return s.startYear === s.endYear ? `${s.startYear}` : `${s.startYear}-${s.endYear}`
}

function strengthSuffix(strength: TeamStrength): string {
  if (strength === 'front-running') return ', a front-running team'
  if (strength === 'midfield') return ', a midfield team'
  if (strength === 'backmarker') return ', a backmarker team'
  return ''
}

const STAT_LABEL: Record<string, string> = {
  pace: 'pace',
  overtaking: 'overtaking',
  smoothness: 'tyre management',
  wetWeatherPace: 'wet-weather pace',
}

function styleSentence(a: DriverAttributes, subjCap: string): string {
  const stats = [
    { key: 'pace', v: a.pace },
    { key: 'overtaking', v: a.overtaking },
    { key: 'smoothness', v: a.smoothness },
    { key: 'wetWeatherPace', v: a.wetWeatherPace },
  ].sort((x, y) => y.v - x.v)
  const best = stats[0]
  const worst = stats[stats.length - 1]
  if (best.v - worst.v < 6) return `${subjCap} is a well-rounded driver.`
  return `${subjCap} is best at ${STAT_LABEL[best.key]} and weakest at ${STAT_LABEL[worst.key]}.`
}

function recordSentence(c: DriverCareer, subjCap: string): string {
  const { titles, wins, podiums, poles, points, seasons, races } = c.totals
  if (races === 0) return `${subjCap} has not started a race yet.`
  const titlePart = titles > 0 ? `${subjCap} has won ${titles} World ${titles === 1 ? 'Championship' : 'Championships'}. ` : ''
  return `${titlePart}In ${seasons} ${seasons === 1 ? 'season' : 'seasons'} ${subjCap.toLowerCase()} has ${wins} ${wins === 1 ? 'win' : 'wins'}, ${podiums} ${podiums === 1 ? 'podium' : 'podiums'}, ${poles} ${poles === 1 ? 'pole' : 'poles'} and ${points.toLocaleString()} points.`
}

function ageSentence(a: DriverAttributes, subj: string, poss: string): string {
  const gap = a.primeEnd - a.age
  const ceiling = a.peakPotential - a.overall
  if (gap > 3) {
    return ceiling > 5
      ? `At ${a.age} ${subj} is still improving.`
      : `At ${a.age} ${subj} is already close to ${poss} best level.`
  }
  if (gap >= -1) return `At ${a.age} ${subj} is in ${poss} prime.`
  if (gap >= -4) return `At ${a.age} ${subj} is just past ${poss} best.`
  return `At ${a.age} ${subj} is near the end of ${poss} career.`
}

function teamSentence(career: DriverCareer, a: DriverAttributes, subjCap: string, subj: string, strength: TeamStrength): string {
  if (a.isFreeAgent) return `${subjCap} is a free agent with no team.`
  const stints = buildStints(career.seasons)
  const current = stints[stints.length - 1]
  if (!current) return `${subjCap} drives for ${a.teamName}.`
  const team = `${current.teamName}${strengthSuffix(strength)}`

  if (stints.length >= 2) {
    const prior = listJoin(stints.slice(0, -1).map((s) => `${s.teamName} (${stintRange(s)})`))
    return current.races === 0
      ? `${subjCap} just joined ${team} and has not raced for them yet. Before that ${subj} drove for ${prior}.`
      : `${subjCap} drives for ${team}. Before that ${subj} drove for ${prior}.`
  }
  return current.races === 0
    ? `${subjCap} just signed for ${team} and has not raced for them yet.`
    : `${subjCap} drives for ${team}.`
}

export function buildDriverBio(
  career: DriverCareer,
  a: DriverAttributes,
  currentYear: number,
  teamStrength: TeamStrength = null,
): string {
  const p = pronouns(a.gender)
  const subjCap = cap(p.subj)
  const country = countryName(a.nationality) || 'an unknown country'

  const opener = `${career.driverName} is a ${a.age}-year-old driver from ${country}.`
  const record = recordSentence(career, subjCap)
  const style = styleSentence(a, subjCap)
  const age = ageSentence(a, p.subj, p.poss)
  const team = teamSentence(career, a, subjCap, p.subj, teamStrength)
  const contract = a.isFreeAgent
    ? ''
    : a.contractExpiresAfterSeason <= currentYear
      ? `${cap(p.poss)} contract ends after this season.`
      : `${subjCap} is signed until ${a.contractExpiresAfterSeason}.`

  return [opener, record, style, age, team, contract].filter(Boolean).join(' ')
}
