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

// "his pace, overtaking and his wet-weather pace" — first and last get "his".
function knownForPhrase(labels: string[]): string {
  if (labels.length === 1) return `his ${labels[0]}`
  const head = [`his ${labels[0]}`, ...labels.slice(1, -1)].join(', ')
  return `${head} and his ${labels[labels.length - 1]}`
}

function styleSentence(subjCap: string, knownFor: string[]): string {
  if (knownFor.length === 0) return ''
  return `${subjCap} is known for ${knownForPhrase(knownFor)}.`
}

// Single descriptor noun for the opener, picked by what stands out most.
// overallRank is the driver's 0-based rank on the grid by overall (null if not on the grid).
function driverNoun(career: DriverCareer, a: DriverAttributes, overallRank: number | null): string {
  const { titles, seasons } = career.totals
  const leading = career.seasons.find((s) => s.inProgress)?.championshipFinish === 1
  if (titles > 0) return titles === 1 ? 'F1 champion' : `${titles}-time F1 champion`
  if (leading) return 'F1 championship leader'
  if (overallRank != null && overallRank < 5) return 'superstar'
  if (overallRank != null && overallRank < 10) return 'star'
  if (seasons <= 1) return 'rookie'
  if (a.age >= 37) return 'veteran'
  if (a.narrativeModifier >= 6) return 'popular driver'
  if (a.narrativeModifier <= -6) return 'controversial driver'
  if (seasons >= 5) return 'experienced driver'
  return 'driver'
}

// "a" / "an" for the "{age}-year-old" that follows (18, 11, 8, 80-89 take "an").
function ageArticle(age: number): string {
  return age === 18 || age === 11 || age === 8 || (age >= 80 && age < 90) ? 'an' : 'a'
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
  const suffix = strengthSuffix(strength)
  const teamEnd = `${current.teamName}${suffix}`        // ends a sentence
  const teamMid = `${current.teamName}${suffix}${suffix ? ',' : ''}` // mid-sentence: close the appositive

  if (stints.length >= 2) {
    const prior = listJoin(stints.slice(0, -1).map((s) => `${s.teamName} (${stintRange(s)})`))
    return current.races === 0
      ? `${subjCap} just joined ${teamMid} and has not raced for them yet. Before that ${subj} drove for ${prior}.`
      : `${subjCap} drives for ${teamEnd}. Before that ${subj} drove for ${prior}.`
  }
  return current.races === 0
    ? `${subjCap} just signed for ${teamMid} and has not raced for them yet.`
    : `${subjCap} drives for ${teamEnd}.`
}

export function buildDriverBio(
  career: DriverCareer,
  a: DriverAttributes,
  currentYear: number,
  teamStrength: TeamStrength = null,
  knownFor: string[] = [],
  overallRank: number | null = null,
): string {
  const p = pronouns(a.gender)
  const subjCap = cap(p.subj)
  const country = countryName(a.nationality) || 'an unknown country'

  const opener = `${career.driverName} is ${ageArticle(a.age)} ${a.age}-year-old ${driverNoun(career, a, overallRank)} from ${country}.`
  const record = recordSentence(career, subjCap)
  const style = styleSentence(subjCap, knownFor)
  const age = ageSentence(a, p.subj, p.poss)
  const team = teamSentence(career, a, subjCap, p.subj, teamStrength)
  const contract = a.isFreeAgent
    ? ''
    : a.contractExpiresAfterSeason <= currentYear
      ? `${cap(p.poss)} contract ends after this season.`
      : `${subjCap} is signed until ${a.contractExpiresAfterSeason}.`

  return [opener, record, style, age, team, contract].filter(Boolean).join(' ')
}
