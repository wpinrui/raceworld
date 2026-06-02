// Multi-season driver-market simulation, seeded with the real 2026 grid.
// Purpose: judge the new fit-based retention (B) vs the current absolute-media
// behaviour BEFORE committing the mechanic. Lightweight season model (no lap sim):
// each driver's results come from car pace + ability + season form + per-race noise.
//
// New retention idea under test:
//   expectation per seat = 2 * carPaceRank - 0.5     (rank teams by raw car pace)
//   driverPerf           = 0.3*avgGrid + 0.7*avgRace (race-weighted)
//   delta                = expectation - driverPerf  (+ve = beat the car)
//   team keep-value      = 50 + K*delta              (sliding; replaces flat media+5)
// Run:  node scripts/market-sim.mjs

// ---- seeded RNG (mulberry32) so runs are reproducible ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function normal(rng, mean = 0, sd = 1) {
  let u = 0, v = 0
  while (!u) u = rng()
  while (!v) v = rng()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const TEAMS = [
  ['mercedes', 75], ['ferrari', 70], ['mclaren', 65], ['redbull', 60], ['alpine', 55],
  ['racingbulls', 50], ['haas', 45], ['williams', 40], ['audi', 35], ['astonmartin', 30], ['cadillac', 25],
].map(([id, carPace]) => ({ id, carPace }))

// id, team, pace, overtaking, smoothness, age, primeEnd, peakPotential, contractExpiresAfterSeason
const DRIVERS = [
  ['Norris', 'mclaren', 91, 89, 80, 26, 32, 94, 2027], ['Piastri', 'mclaren', 92, 82, 86, 25, 31, 95, 2026],
  ['Leclerc', 'ferrari', 93, 85, 83, 29, 33, 95, 2027], ['Hamilton', 'ferrari', 87, 85, 93, 41, 35, 97, 2026],
  ['Verstappen', 'redbull', 97, 97, 88, 28, 34, 98, 2028], ['Hadjar', 'redbull', 80, 79, 75, 21, 31, 91, 2027],
  ['Russell', 'mercedes', 90, 83, 87, 28, 33, 92, 2027], ['Antonelli', 'mercedes', 88, 78, 80, 19, 31, 95, 2027],
  ['Alonso', 'astonmartin', 87, 90, 91, 44, 36, 95, 2026], ['Stroll', 'astonmartin', 61, 54, 64, 27, 30, 70, 2028],
  ['Gasly', 'alpine', 83, 79, 80, 30, 32, 86, 2027], ['Colapinto', 'alpine', 76, 73, 68, 22, 30, 86, 2026],
  ['Albon', 'williams', 80, 76, 79, 30, 32, 84, 2027], ['Sainz', 'williams', 87, 82, 91, 31, 33, 90, 2027],
  ['Lawson', 'racingbulls', 78, 76, 73, 24, 30, 86, 2026], ['Lindblad', 'racingbulls', 70, 67, 68, 19, 30, 88, 2027],
  ['Bearman', 'haas', 76, 78, 68, 20, 29, 88, 2027], ['Ocon', 'haas', 77, 71, 76, 29, 32, 82, 2026],
  ['Hulkenberg', 'audi', 77, 72, 75, 38, 32, 80, 2026], ['Bortoleto', 'audi', 72, 68, 68, 21, 30, 88, 2027],
  ['Perez', 'cadillac', 78, 74, 82, 36, 33, 86, 2027], ['Bottas', 'cadillac', 77, 70, 79, 36, 32, 84, 2027],
].map(([name, team, pace, ot, sm, age, primeEnd, pp, exp]) => ({
  id: name, name, teamId: team, ability: 0.7 * pace + 0.15 * ot + 0.15 * sm,
  age, primeEnd, peakPotential: pp, contractExpiresAfterSeason: exp, pool: false,
}))

const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
const RACES = 22
const FIELD = 22

// --- retention tuning knobs ---
const ONE_YEAR = process.env.ONE_YEAR === '1' // stress test: everyone expires yearly
// Forgiving re-sign offer: P(team offers) = sigmoid((delta + OFFER_SHIFT) / OFFER_SCALE).
// Higher OFFER_SHIFT = more forgiving (teams keep underperformers more readily).
const OFFER_SHIFT = process.env.OFFER_SHIFT ? Number(process.env.OFFER_SHIFT) : 3
const OFFER_SCALE = 2

let rookieSeq = 0
function makeRookie(teamId, rng) {
  rookieSeq++
  const pace = Math.round(normal(rng, 72, 6))
  const ability = 0.7 * pace + 0.15 * (pace - 4) + 0.15 * (pace - 2)
  return {
    id: `rookie${rookieSeq}`, name: `Rookie${rookieSeq}`, teamId, ability,
    age: 19 + Math.floor(rng() * 3), primeEnd: 29 + Math.floor(rng() * 3),
    peakPotential: Math.min(96, ability + 8 + rng() * 12), // room to grow
    contractExpiresAfterSeason: 0, pool: false,
  }
}

function simulateSeason(drivers, teamPace, rng) {
  const stat = {}
  for (const d of drivers) stat[d.id] = { grid: 0, race: 0, points: 0, n: 0 }
  const form = {}
  for (const d of drivers) form[d.id] = normal(rng, 0, 4) // season-to-season swing
  for (let r = 0; r < RACES; r++) {
    const seated = drivers.filter((d) => d.teamId)
    const qual = seated.map((d) => ({ id: d.id, s: teamPace[d.teamId] + d.ability * 0.6 + form[d.id] + normal(rng, 0, 6) }))
      .sort((a, b) => b.s - a.s)
    qual.forEach((q, i) => { stat[q.id].grid += i + 1 })
    const race = seated.map((d) => ({ id: d.id, dnf: rng() < 0.05, s: teamPace[d.teamId] + d.ability * 0.6 + form[d.id] + normal(rng, 0, 9) }))
    race.sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.s - a.s))
    race.forEach((x, i) => {
      stat[x.id].race += x.dnf ? FIELD : i + 1
      if (!x.dnf && i < 10) stat[x.id].points += POINTS[i]
      stat[x.id].n++
    })
  }
  for (const id in stat) { stat[id].avgGrid = stat[id].grid / RACES; stat[id].avgRace = stat[id].race / RACES }
  return stat
}

function runMarket(drivers, teams, stat, year, mode, rng) {
  const teamPace = Object.fromEntries(teams.map((t) => [t.id, t.carPace]))
  // car-pace rank (1 = fastest), expectation per seat
  const paceRank = {}
  ;[...teams].sort((a, b) => b.carPace - a.carPace).forEach((t, i) => { paceRank[t.id] = i + 1 })

  // team season points -> teamMedia (seat quality), driver points percentile -> driverMedia
  const teamPts = {}
  for (const d of drivers) if (d.teamId) teamPts[d.teamId] = (teamPts[d.teamId] || 0) + stat[d.id].points
  const maxTeamPts = Math.max(1, ...Object.values(teamPts))
  const teamMedia = (tid) => 100 * (teamPts[tid] || 0) / maxTeamPts
  const seatedPts = drivers.filter((d) => d.teamId).map((d) => stat[d.id].points).sort((a, b) => a - b)
  const driverMedia = (d) => {
    if (d.pool) return 32 + Math.max(0, d.ability - 68) // unraced: faint pace hint
    const below = seatedPts.filter((p) => p < stat[d.id].points).length
    return seatedPts.length > 1 ? 100 * below / (seatedPts.length - 1) : 50
  }
  const delta = (d) => {
    if (!d.teamId || d.pool) return 0
    const expected = 2 * paceRank[d.teamId] - 0.5
    const perf = 0.3 * stat[d.id].avgGrid + 0.7 * stat[d.id].avgRace
    return expected - perf
  }

  const expiring = new Set(
    drivers.filter((d) => d.teamId && (ONE_YEAR || d.contractExpiresAfterSeason <= year)).map((d) => d.id),
  )

  // NEW: probability-based re-sign OFFER. Each expiring driver's team offers to keep
  // him with a FORGIVING probability tied to delta (how he did vs his car). The offer
  // does NOT lock him in — every expiring driver still goes through the market and can
  // leave for a better team that wants him, or be replaced if his team didn't offer.
  // The offer only decides whether his current team prioritises keeping him.
  const teamWants = new Set()
  if (mode === 'new') {
    const sig = (x) => 1 / (1 + Math.exp(-x))
    for (const id of [...expiring]) {
      const d = drivers.find((x) => x.id === id)
      if (rng() < sig((delta(d) + OFFER_SHIFT) / OFFER_SCALE)) teamWants.add(id)
    }
  }
  const stayers = drivers.filter((d) => d.teamId && !expiring.has(d.id))
  const freeAgents = drivers.filter((d) => expiring.has(d.id) || !d.teamId)
  const cap = {}
  for (const t of teams) cap[t.id] = 2 - stayers.filter((s) => s.teamId === t.id).length
  const openTeams = teams.filter((t) => cap[t.id] > 0)

  const teamValue = (t, fa) => {
    const incumbent = fa.teamId === t.id
    const youth = Math.max(0, Math.min(4, 23 - fa.age))
    const rust = fa.pool ? 5 : 0
    if (mode === 'new') {
      // Retention is decided by the lock above; here a team only prioritises an
      // incumbent it offered to but who is shopping (so it can take him back).
      if (incumbent && teamWants.has(fa.id)) return driverMedia(fa) + 25 + normal(rng, 0, 8)
      return driverMedia(fa) + youth - rust + normal(rng, 0, 8)
    } else {
      // current behaviour: absolute media + flat incumbent bonus
      return driverMedia(fa) + (incumbent ? 5 : 0) - rust + normal(rng, 0, 10)
    }
  }
  const driverRank = (fa) => openTeams.map((t) => {
    let v = teamMedia(t.id) + normal(rng, 0, 10)
    if (mode === 'new' && fa.teamId === t.id) v += 12 // fallback pull to old team
    return { id: t.id, v }
  }).sort((a, b) => b.v - a.v).map((x) => x.id)

  // driver-proposing deferred acceptance
  const pref = {}, next = {}, held = {}
  for (const fa of freeAgents) { pref[fa.id] = driverRank(fa); next[fa.id] = 0 }
  for (const t of openTeams) held[t.id] = []
  const faById = Object.fromEntries(freeAgents.map((d) => [d.id, d]))
  const free = freeAgents.map((d) => d.id)
  while (free.length) {
    const did = free.pop()
    if (next[did] >= pref[did].length) continue
    const tid = pref[did][next[did]++]
    held[tid].push(did)
    if (held[tid].length > cap[tid]) {
      held[tid].sort((a, b) => teamValue(teams.find((t) => t.id === tid), faById[b]) - teamValue(teams.find((t) => t.id === tid), faById[a]))
      const dropped = held[tid].splice(cap[tid])
      for (const dd of dropped) if (next[dd] < pref[dd].length) free.push(dd)
    }
  }

  // apply signings
  let changes = 0
  for (const fa of freeAgents) fa._newTeam = '' // default: unsigned
  for (const t of openTeams) for (const did of held[t.id]) faById[did]._newTeam = t.id

  // contract length = rank-based (model A, already merged): media percentile across
  // next season's grid -> mean length 1 + p*3, sampled with noise.
  const nextGridMedia = []
  for (const s of stayers) nextGridMedia.push(driverMedia(s))
  for (const fa of freeAgents) if (fa._newTeam) nextGridMedia.push(driverMedia(fa))
  const sortedGrid = [...nextGridMedia].sort((a, b) => a - b)
  const gridPct = (m) => (sortedGrid.length > 1 ? sortedGrid.filter((x) => x < m).length / (sortedGrid.length - 1) : 0.5)

  for (const fa of freeAgents) {
    const prevTeam = fa.teamId
    fa.teamId = fa._newTeam
    fa.pool = fa._newTeam === ''
    if (fa._newTeam) {
      const len = Math.max(1, Math.min(4, Math.round(normal(rng, 1 + gridPct(driverMedia(fa)) * 3, 0.9))))
      fa.contractExpiresAfterSeason = year + len
    }
    if (prevTeam && fa._newTeam && prevTeam !== fa._newTeam) changes++
  }

  // fill any empty seats with rookies
  for (const t of teams) {
    const filled = drivers.filter((d) => d.teamId === t.id).length
    for (let i = filled; i < 2; i++) {
      const rk = makeRookie(t.id, rng)
      rk.contractExpiresAfterSeason = year + 1
      drivers.push(rk)
    }
  }
  return changes
}

function ageAndRetire(drivers, rng) {
  const alive = []
  for (const d of drivers) {
    d.age++
    // Progression: improve toward peak before prime (fast when far below, slowing as
    // it approaches), decline at an accelerating rate once past prime.
    if (d.peakPotential != null) {
      if (d.age <= d.primeEnd) {
        d.ability = Math.min(d.peakPotential, d.ability + (d.peakPotential - d.ability) * 0.25 + normal(rng, 0, 1))
      } else {
        d.ability = Math.max(40, d.ability - (1 + 0.7 * (d.age - d.primeEnd)))
      }
    }
    // retire: old age, or long spell without a seat
    if (d.age >= 39 && rng() < 0.5) continue
    if (d.age >= 43) continue
    if (!d.teamId && rng() < 0.3) continue
    alive.push(d)
  }
  return alive
}

function run(mode, seed, years) {
  const rng = mulberry32(seed)
  let drivers = DRIVERS.map((d) => ({ ...d }))
  const teams = TEAMS.map((t) => ({ ...t }))
  const teamPace = Object.fromEntries(teams.map((t) => [t.id, t.carPace]))
  const trace = {} // driverName -> [team per season]
  const changesPerYear = []
  for (let y = 2026; y < 2026 + years; y++) {
    const stat = simulateSeason(drivers, teamPace, rng)
    for (const d of drivers) if (DRIVERS.find((o) => o.id === d.id)) (trace[d.id] ||= []).push(d.teamId || '—')
    const changes = runMarket(drivers, teams, stat, y, mode, rng)
    changesPerYear.push(changes)
    drivers = ageAndRetire(drivers, rng)
  }
  return { changesPerYear, trace }
}

const YEARS = 12
if (process.env.TUNE === '1') {
  const nseeds = 40
  let total = 0
  for (let s = 0; s < nseeds; s++) {
    const { changesPerYear } = run('new', 1000 + s * 13, YEARS)
    total += changesPerYear.reduce((a, b) => a + b, 0) / changesPerYear.length
  }
  console.log(`OFFER_SHIFT=${OFFER_SHIFT}  avg NEW churn over ${nseeds} seeds: ${(total / nseeds).toFixed(2)}/season`)
  process.exit(0)
}
for (const mode of ['old', 'new']) {
  const { changesPerYear, trace } = run(mode, 12345, YEARS)
  const avg = (changesPerYear.reduce((a, b) => a + b, 0) / changesPerYear.length).toFixed(1)
  console.log(`\n=== ${mode.toUpperCase()} retention ===`)
  console.log(`team-changes/season: [${changesPerYear.join(', ')}]  avg ${avg}`)
  for (const d of DRIVERS) {
    if (trace[d.id]) console.log(`  ${d.name.padEnd(11)} ${trace[d.id].join(' → ')}`)
  }
}
