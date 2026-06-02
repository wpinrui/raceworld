import type { DriverCareer, DriverAttributes } from './types'
import { countryName } from '@/data/countries'

// Football-Manager-style auto-generated driver biography. Pure: derived entirely from
// career totals + current attributes, so it always stays in sync with the save.

// Demonyms for the nationalities that actually appear on the grid / in the pool. Falls back
// to "<Country>" when unknown.
const DEMONYMS: Record<string, string> = {
  GB: 'British', IE: 'Irish', DE: 'German', NL: 'Dutch', BE: 'Belgian', FR: 'French',
  IT: 'Italian', ES: 'Spanish', PT: 'Portuguese', MC: 'Monegasque', AT: 'Austrian',
  CH: 'Swiss', DK: 'Danish', SE: 'Swedish', FI: 'Finnish', NO: 'Norwegian', PL: 'Polish',
  CZ: 'Czech', RU: 'Russian', BR: 'Brazilian', AR: 'Argentine', MX: 'Mexican', CO: 'Colombian',
  US: 'American', CA: 'Canadian', AU: 'Australian', NZ: 'New Zealander', TH: 'Thai',
  JP: 'Japanese', CN: 'Chinese', IN: 'Indian', ZA: 'South African', AE: 'Emirati', SA: 'Saudi',
}

function demonym(code: string): string {
  return DEMONYMS[code?.toUpperCase()] || countryName(code) || 'international'
}

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

// Join a list with commas and a trailing "and".
function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

interface Stint { teamId: string; teamName: string; startYear: number; endYear: number; races: number }

// Collapse the per-season rows into team stints (consecutive seasons at the same team).
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
  return s.startYear === s.endYear ? `${s.startYear}` : `${s.startYear} to ${s.endYear}`
}

// Rank the four attributes to describe driving style. Returns a full sentence.
function styleClause(a: DriverAttributes, subjCap: string, poss: string): string {
  const stats = [
    { key: 'pace', v: a.pace, strong: 'blistering one-lap pace', weak: `${poss} raw pace` },
    { key: 'overtaking', v: a.overtaking, strong: 'fearless wheel-to-wheel racecraft', weak: `${poss} wheel-to-wheel racecraft` },
    { key: 'smoothness', v: a.smoothness, strong: 'a smooth, tyre-preserving style', weak: `${poss} tyre management` },
    { key: 'wetWeatherPace', v: a.wetWeatherPace, strong: 'a knack for wet-weather conditions', weak: `${poss} form in the wet` },
  ].sort((x, y) => y.v - x.v)
  const best = stats[0]
  const worst = stats[stats.length - 1]
  if (best.v - worst.v < 6) return `${subjCap} is a well-rounded driver with no glaring weakness.`
  const tail = worst.v < 65 ? `though questions remain over ${worst.weak}` : `with ${worst.weak} still to sharpen`
  return `${subjCap} is known for ${best.strong}, ${tail}.`
}

// Full-sentence career-standing line. `who` is the sentence subject (a surname).
function standingClause(c: DriverCareer, who: string, subjCap: string): string {
  const { titles, wins, podiums, poles, points, seasons, races } = c.totals
  if (races === 0) return `${subjCap} is yet to make a Grand Prix start.`
  const lead = titles >= 4 ? `${who} is one of the all-time greats, a ${titles}-time World Champion`
    : titles > 0 ? `${who} is a ${titles}-time World Champion`
    : wins >= 10 ? `${who} is a proven race winner still chasing a title`
    : wins > 0 ? `${who} is a race winner still chasing a maiden championship`
    : podiums > 0 ? `${who} is still hunting a first win`
    : `${who} is still searching for a breakthrough result`
  const tally = `${wins} ${wins === 1 ? 'win' : 'wins'}, ${podiums} ${podiums === 1 ? 'podium' : 'podiums'} and ${poles} ${poles === 1 ? 'pole' : 'poles'} across ${seasons} ${seasons === 1 ? 'season' : 'seasons'} and ${points.toLocaleString()} career points`
  return `${lead}, with ${tally}.`
}

// Full-sentence career-arc line.
function trajectoryClause(a: DriverAttributes, subj: string, subjCap: string): string {
  const poss = subj === 'she' ? 'her' : 'his'
  const gapToPrime = a.primeEnd - a.age
  const ceiling = a.peakPotential - a.overall
  if (gapToPrime > 3) {
    return ceiling > 5
      ? `Still developing, ${subj} has ${poss} best years firmly ahead.`
      : `${subjCap} is young but already close to ${poss} ceiling.`
  }
  if (gapToPrime >= -1) return `${subjCap} is at the peak of ${poss} powers.`
  if (gapToPrime >= -4) return `${subjCap} is an experienced campaigner just past ${poss} prime.`
  return `${subjCap} is in the veteran twilight of ${poss} career.`
}

// Full-sentence summary of the driver's current seat and team history (stints).
function teamClause(career: DriverCareer, a: DriverAttributes, subjCap: string): string {
  if (a.isFreeAgent) {
    return `${subjCap} is currently a free agent, available to any team with an open seat.`
  }
  const stints = buildStints(career.seasons)
  const current = stints[stints.length - 1]
  if (!current) return `${subjCap} races for ${a.teamName}.`

  if (stints.length >= 2) {
    const prior = stints.slice(0, -1)
    const priorList = listJoin(prior.map((s) => `${s.teamName} (${stintRange(s)})`))
    const spells = prior.length === 1 ? 'a spell' : 'spells'
    return current.races === 0
      ? `${subjCap} has just joined ${current.teamName} after ${spells} with ${priorList}, and is yet to race for them.`
      : `${subjCap} now races for ${current.teamName} after ${spells} with ${priorList}.`
  }

  // Single team across the whole career so far.
  if (current.races === 0) return `${subjCap} has signed for ${current.teamName} but is yet to race for them.`
  const yrs = current.endYear - current.startYear + 1
  return yrs >= 2
    ? `${subjCap} has raced for ${current.teamName} since ${current.startYear}.`
    : `${subjCap} races for ${current.teamName}.`
}

export function buildDriverBio(career: DriverCareer, a: DriverAttributes, currentYear: number): string {
  const p = pronouns(a.gender)
  const subjCap = cap(p.subj)
  const surname = lastName(career.driverName)

  const opener = `${career.driverName} is a ${a.age}-year-old ${demonym(a.nationality)} driver.`
  const standing = standingClause(career, surname, subjCap)
  const style = styleClause(a, subjCap, p.poss)
  const trajectory = trajectoryClause(a, p.subj, subjCap)
  const team = teamClause(career, a, subjCap)

  const contract = a.isFreeAgent
    ? ''
    : a.contractExpiresAfterSeason <= currentYear
      ? `${cap(p.poss)} contract expires at the end of the season, putting ${p.obj} among the names to watch in the driver market.`
      : `${subjCap} is contracted until ${a.contractExpiresAfterSeason}.`

  return [opener, standing, style, trajectory, team, contract].filter(Boolean).join(' ')
}
