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

// Rank the four attributes to describe driving style.
function styleClause(a: DriverAttributes, poss: string): string {
  const stats = [
    { key: 'pace', v: a.pace, strong: 'blistering one-lap pace', weak: `${poss} raw pace` },
    { key: 'overtaking', v: a.overtaking, strong: 'fearless wheel-to-wheel racecraft', weak: `${poss} wheel-to-wheel racecraft` },
    { key: 'smoothness', v: a.smoothness, strong: 'a smooth, tyre-preserving style', weak: `${poss} tyre management` },
    { key: 'wetWeatherPace', v: a.wetWeatherPace, strong: 'a reputation as a wet-weather specialist', weak: `${poss} form in the wet` },
  ].sort((x, y) => y.v - x.v)
  const best = stats[0]
  const worst = stats[stats.length - 1]
  if (best.v - worst.v < 6) return `A well-rounded driver with no glaring weakness`
  return `Known for ${best.strong}, ${worst.v < 65 ? `though questions remain over ${worst.weak}` : `with ${worst.weak} the area still to polish`}`
}

function standingClause(c: DriverCareer): string {
  const { titles, wins, podiums, poles, points, seasons } = c.totals
  const head = titles >= 4 ? `One of the all-time greats, a ${titles}-time World Champion`
    : titles > 0 ? `A ${titles}-time World Champion`
    : wins >= 10 ? 'A proven race winner yet to land a title'
    : wins > 0 ? 'A race winner still chasing a maiden championship'
    : podiums > 0 ? 'A podium-getter still hunting a first win'
    : seasons > 0 ? 'Still searching for a breakthrough result'
    : 'Yet to start a Grand Prix'
  const tally = seasons > 0
    ? ` — ${wins} ${wins === 1 ? 'win' : 'wins'}, ${podiums} ${podiums === 1 ? 'podium' : 'podiums'} and ${poles} ${poles === 1 ? 'pole' : 'poles'} from ${seasons} ${seasons === 1 ? 'season' : 'seasons'}, for ${points.toLocaleString()} career points`
    : ''
  return head + tally
}

function trajectoryClause(a: DriverAttributes, subj: string): string {
  const poss = subj === 'she' ? 'her' : 'his'
  const gapToPrime = a.primeEnd - a.age
  const ceiling = a.peakPotential - a.overall
  if (gapToPrime > 3) {
    return ceiling > 5
      ? `Still developing, ${subj} has ${poss} best years firmly ahead`
      : `Young but already close to ${poss} ceiling`
  }
  if (gapToPrime >= -1) return `At the peak of ${poss} powers`
  if (gapToPrime >= -4) return `An experienced campaigner just past ${poss} prime`
  return `In the veteran twilight of ${poss} career`
}

export function buildDriverBio(career: DriverCareer, a: DriverAttributes, currentYear: number): string {
  const p = pronouns(a.gender)
  const seat = a.isFreeAgent
    ? 'currently without a race seat'
    : `racing for ${a.teamName}`
  const opener = `${career.driverName} is a ${a.age}-year-old ${demonym(a.nationality)} driver, ${seat}.`

  const standing = `${standingClause(career)}.`
  const style = `${styleClause(a, p.poss)}.`
  const trajectory = `${trajectoryClause(a, p.subj)}.`

  const contract = a.isFreeAgent
    ? `${cap(p.subj)} is a free agent and available to any team with an open seat.`
    : a.contractExpiresAfterSeason <= currentYear
      ? `${cap(p.poss)} contract expires at the end of the season, making ${p.obj} one to watch in the driver market.`
      : `${cap(p.subj)} is under contract with ${a.teamName} until ${a.contractExpiresAfterSeason}.`

  return [opener, standing, style + ' ' + trajectory, contract].join(' ')
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
