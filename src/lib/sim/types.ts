import type { TeamBelief } from './pit-ai'

export type TyreCompound = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet'
export type RacePhase = 'pre-qualifying' | 'qualifying' | 'pre-race' | 'racing' | 'finished'
// 1-4 are real-time speeds (slow -> fast); 5 is the fast-forward "skip to the end" (instant, confirmed).
export type SimSpeed = 1 | 2 | 3 | 4 | 5

// A specific technical/mechanical failure (issue #61). Picked uniformly on a technical DNF.
export type TechnicalFailure =
  | 'engine' | 'gearbox' | 'hydraulics' | 'electrical' | 'suspension' | 'brakes' | 'clutch' | 'overheating'

// Why a car retired (issue #61), stored on the result instead of invented later. 'collision-damage'
// covers ALL crashes (consistency mistakes #59 + overtake collisions #60); the rest are technical
// failures whose per-lap rate varies by era (see reliability.ts).
export type RetirementReason = 'collision-damage' | TechnicalFailure

export type Gender = 'male' | 'female'

export interface Driver {
  id: string
  name: string
  teamId: string
  nationality: string    // ISO 3166-1 alpha-2
  gender: Gender         // drives the generated avatar; inferred from the name at generation
  pace: number           // 0-100
  wetWeatherPace: number // 0-100
  overtaking: number     // 0-100
  smoothness: number     // 0-100 (tyre life only)
  // Race-craft consistency 0-100 (issue #59): scales per-lap noise and the mistake rate.
  // Distinct from smoothness. A rating like any other — authored/generated at entry level, then it
  // develops and declines through the same progression curve as pace/wet/overtaking/smoothness.
  consistency: number
  // Season form (#66): a once-per-season offset added to all five ratings, modelling up-and-down years.
  // The five stat fields above are the hidden, smoothly-developing TRUE values; the SHOWN ratings the
  // player sees and the sim races are those + this offset, clamped (see shownStats in progression.ts).
  // Absent reads as 0 (e.g. pre-roll at setup). Rolled at each season start: Normal(0, ~2), clamped +/-10.
  seasonForm?: number
  age: number
  peakPotential: number
  primeEnd: number       // age at which decline starts
  // Per-driver decline damper (#87). The decline median is 0.04·(1 + (age−primeEnd)·declineRate): at 1 it is
  // the original 0.04·(age−primeEnd+1) accelerating curve; lower values flatten it toward a linear taper so a
  // long-lived veteran ages gracefully instead of cliffing. Absent reads as 1 (no effect) — untuned drivers
  // are unchanged. Carried through from the historical entry so the live engine keeps tapering past the start year.
  declineRate?: number
  narrativeModifier: number // -20 to +20
  contractExpiresAfterSeason: number
  // Morale rating in [0, 10] that biases the per-race form roll (issue #58). Starts at 5,
  // persists across seasons. Rises/falls each race on how the driver does versus their teammate.
  // Optional for backward-compatible saves: absent reads as 5 (see CONFIDENCE_DEFAULT).
  confidence?: number
  // Signed streak counter: |value| = consecutive same-direction races, sign = direction
  // (+ overperform, - underperform), 0 = fresh. Amplifies repeated swings (step = 0.5 * |streak|).
  confidenceStreak?: number
  seasonsSinceF1Seat?: number // consecutive seasons without an F1 seat; removed from the market at 5
  photoUrl?: string      // god-mode override; when set, used instead of any real photo or the generated avatar
  debutYear?: number     // real-world debut season (historical mode); lets the newsroom tell a true
                         // rookie from a driver who raced before the game's reach. Absent for generated drivers.
}

export interface Team {
  id: string
  name: string
  shortName: string
  nationality: string    // constructor licence country, ISO 3166-1 alpha-2; '' = rest of world
  color: string          // primary hex
  carPace: number        // 75/70/65/60/55/50/45/40/35/30 — the derived OVERALL pace (mean of the two below)
  // Multi-rating car model (#sim-overhaul). 0-100. Absent on legacy saves → fall back to carPace
  // (see car-rating.ts). straightLine + cornering blend into effective pace per circuit; the two tyre
  // ratings feed the tyre temperature / wear model.
  straightLine?: number  // straight-line speed (acceleration + top speed)
  cornering?: number     // cornering speed
  tyreWarming?: number   // how easily the car keeps its tyres in the optimal temperature window
  tyreWear?: number      // resistance to tyre degradation (higher = slower wear)
}

export interface Circuit {
  id: string
  name: string
  code: string           // 3-letter race code, Wikipedia-style (e.g. BHR, SAU, AUS)
  location: string
  country: string        // ISO 3166-1 alpha-2, for the calendar flag
  laps: number
  flatModifier: number   // seconds added to base laptime for cosmetic realism
  sundayOfYear: number   // race day = the Nth Sunday of the season year (1-based), so the
                         // calendar self-resolves to a real date for any future year
  straightness?: number  // 0 (corner-heavy, Monaco) – 1 (straight-heavy, Monza); weights the pace blend
                         // and overtaking ease. Absent → treated as 0.5. (#sim-overhaul)
}

export interface TyreState {
  compound: TyreCompound
  condition: number      // 0-100
  maxLifeLaps: number
}

export interface DriverRaceState {
  driverId: string
  position: number
  totalTime: number
  lapTimes: number[]
  sectorTimes?: number[] // played-race sector engine (#sector-engine): this lap's sub-lap splits, appended
                         // per sector tick. Length 8 ⇔ they describe lapTimes' last entry; <8 ⇔ the lap in
                         // progress. Absent on headless/legacy states (whole-lap ticks).
  pendingPit?: { pit: boolean; compound: TyreCompound } // sector engine: the pit call taken on the lap's
                         // first slice (same decision state as the lap engine), executed in the final
                         // sector. Absent at frac=1, where decision and execution share the tick.
  passedThisLap?: boolean // sector engine: this car completed a pass this lap, so it contests no further
                         // until the next lap — the lap engine structurally allows one contest per car
                         // per lap, and uncapped sector contests chained multi-pass laps (+14% places
                         // gained, measured). Cleared on the lap's first slice; never set at frac=1.
  contestArmed?: boolean // sector engine: within strike range at the LAP BOUNDARY — the lap engine's
                         // contest gate. Without it a car attacked in the same lap it caught up,
                         // gaining fractional contest exposure on every catch-up. Set each lap start.
  currentTyre: TyreState
  tyreTemp?: number      // normalised tyre temperature: window [0,1], <0 cold, >1 hot (#sim-overhaul).
                         // Absent (legacy/forecast states) → treated as a fresh-tyre temp.
  push?: PushState       // the driver's SELECTED push (slider or auto-reverting preset) — their intent. Absent → normal.
  pushAuto?: boolean     // Team Manager: hand push to the AI; `push` then mirrors the AI's live pick each lap (#push-auto).
  autoDefend?: boolean   // Driver mode: while `push` is normal, auto-push to defend a car behind. The defensive push is
                         // applied for the lap WITHOUT changing `push` (intent stays normal), so it stays armed (#push-auto).
  defending?: boolean    // transient: the sim applied a defensive push this lap (drives the "Defending" UI badge).
  stintLap: number
  fuelLaps: number
  form: number           // 0-10
  retired: boolean
  retirementLap: number | null
  retirementReason: RetirementReason | null  // set when retired; null while running
  mistakeCount: number                       // consistency mistakes made this race (incl. a crash)
  worstMistakeLoss: number                   // largest single mistake time loss (s) this race; 0 if none
  lastPitLap: number
  pitStops: number
  stintHistory: Array<{ compound: TyreCompound; laps: number }>
  targetPitLap: number | null   // lap the team plans to pit; null = no planned stop
  targetNextCompound: TyreCompound
  gap: number            // gap to car directly ahead in seconds; leader = 0
  lapsDown: number       // whole laps behind the leader (0 = lead lap); drives the +N LAP display, the
                         // finish truncation, and a lapped car's shortened pit strategy
  dsq: boolean
}

export interface QualifyingLap {
  driverId: string
  lap1: number | null
  lap2: number | null
  best: number | null
  lap1Sectors?: [number, number, number]   // S1/S2/S3 of lap 1, summing to lap1 (qualifying playback)
  lap2Sectors?: [number, number, number]   // S1/S2/S3 of lap 2, summing to lap2
}

export interface QualifyingSessionResult {
  session: 'Q1' | 'Q2' | 'Q3'
  results: QualifyingLap[]
  eliminated: string[]
}

export interface QualifyingResult {
  driverId: string
  gridPosition: number
  bestTime: number | null
  q1Time: number | null
  q2Time: number | null
  q3Time: number | null
}

export interface CommentaryEntry {
  lap: number
  text: string
  type: 'pit' | 'overtake' | 'closing' | 'weather' | 'retirement' | 'finish' | 'info'
}

export interface WeatherPoint {
  lap: number
  moisture: number       // 0-1
}

export interface RaceState {
  circuitId: string
  year: number                                             // season year, for era-dependent effects (e.g. pit-lane loss)
  totalLaps: number
  currentLap: number
  currentSector?: number                                    // played-race sector engine (#sector-engine): the sector
                                                            // in progress, 0..7 within currentLap. Absent on headless states.
  weather: WeatherPoint[]                                   // the true weather (drives the sim)
  weatherForecast: WeatherPoint[]                           // fallible prediction; blended toward truth as laps near (UI only)
  drivers: DriverRaceState[]
  commentary: CommentaryEntry[]
  phase: RacePhase
  qualifyingResults: QualifyingResult[]
  qualifyingSessions: QualifyingSessionResult[]
  speed: SimSpeed
  paused: boolean
  strategyNoise: number                                    // 0–1; tunable
  compoundDeltas: Record<TyreCompound, number>             // per-race pace delta (s/lap) per compound
  tyreBaseLife: Record<TyreCompound, number>               // per-race base life (fraction of race) per compound
  teamBeliefs: Record<string, TeamBelief>                  // teamId -> per-compound tyre belief (imperfect info)
  carForm: Record<string, number>                          // teamId -> per-race car-form pace delta (Normal(0, ~5.19)); adds straight to car pace this race
}

export interface GodModeAction {
  type: 'set-tyre-condition' | 'force-retire' | 'set-form' | 'force-pit' | 'cancel-pit'
  driverId: string
  value?: number
  compound?: TyreCompound  // used with force-pit
}

// Driver push controls (#sim-overhaul). A persistent 5-step SLIDER (back off…max) or a transient PRESET
// that auto-reverts to normal once its goal is met. Logic in push.ts; resolves to an intensity for the lap
// loop's pace/temp/wear model. Per-car race state (DriverRaceState.push).
export type SliderLevel = -2 | -1 | 0 | 1 | 2
export type PushPreset = 'overtake' | 'push' | 'conserve'
export type PushState = { kind: 'manual'; level: SliderLevel } | { kind: 'preset'; preset: PushPreset }

// --- Season / standings types ---

export type SeasonPhase =
  | 'idle'
  | 'pre-race'
  | 'post-race'
  | 'end-of-season'
  | 'contract-negotiations'
  | 'driver-retirements'
  | 'pre-season-testing'

// Off-season phases that run sequentially after the final race, each presenting
// its own slice of info before rolling into the next pre-season.
export const OFF_SEASON_PHASES: SeasonPhase[] = [
  'end-of-season',
  'contract-negotiations',
  'driver-retirements',
  'pre-season-testing',
]

export function isOffSeason(phase: SeasonPhase): boolean {
  return OFF_SEASON_PHASES.includes(phase)
}

// Per-race weather summary for the newsroom. Computed once at the flag from the true moisture curve
// and the fallible forecast (both on RaceState) plus the field's lap times, then persisted with the
// race so archived seasons read identically. `shape` is the day's arc; `wetMaster` is the driver who
// handled the wet best RELATIVE to the field (biggest dry->wet step-up; see sim/race-weather.ts).
export interface RaceWeather {
  rained: boolean
  peakMoisture: number              // 0-1, the wettest point of the race
  wetLapCount: number               // laps run at/above the wet (intermediate) threshold
  shape: 'dry' | 'shower' | 'building' | 'drying' | 'sustained'
  forecastThreatenedRain: boolean   // a dry race the forecast had wrongly called for rain (phantom rain)
  wetMasterId: string | null        // best relative wet performer; null on a dry race / too few wet laps
  wetMasterName: string | null
}

export interface RaceResult {
  driverId: string
  driverName: string
  teamId: string
  teamName: string
  gridPosition: number
  finishPosition: number | null  // null = DNF
  points: number
  form: number                   // pre-race form (0-10), the FM-style match rating
  lapsCompleted: number
  totalTime: number | null
  dnf: boolean
  stints: Array<{ compound: TyreCompound; laps: number }>
  q1Time: number | null
  q2Time: number | null
  q3Time: number | null
  // Consistency mistakes this race (issue #59). Optional: archived results predating the field
  // (and the DB-replay path) omit them. `crashed` = the DNF was a crash (retirementReason 'collision-damage').
  mistakes?: number
  worstMistakeLoss?: number              // largest single time loss (s) from a mistake, 0 if none
  crashed?: boolean
  retirementReason?: RetirementReason | null
  fastestLap?: boolean                   // set on the driver who set the race's fastest lap (issue #63)
  // Race-day weather summary (the SAME object on every row of a race). Optional: archived results
  // predating the field omit it; a fresh DB read re-attaches it from the races table.
  weather?: RaceWeather
}

export interface DriverStanding {
  driverId: string
  driverName: string
  teamId: string
  teamName: string
  points: number
  wins: number
  results: (number | null)[]  // finishPosition per round index; null = DNF or not yet raced
}

export interface ConstructorStanding {
  teamId: string
  teamName: string
  points: number
  wins: number
  results: (number | null)[][]  // [driverIdx][roundIdx]
}

// --- M3: Multi-season dynamics types ---

export type FundingTier = 1 | 2 | 3 | 4

// How a team's upgrade gain is allocated across the four car ratings (#upgrade-focus). Fractions summing to
// 1; absent → a pace-focused default (the legacy behaviour: all gain on straight-line + cornering).
export interface FocusSplit {
  straightLine: number
  cornering: number
  tyreWarming: number
  tyreWear: number
}

export interface TeamDevPlan {
  teamId: string
  cycleLength: number          // 3–6 races per upgrade
  focusSplit?: FocusSplit      // how this cycle's gain is split across the four ratings (#upgrade-focus)
  // The round the in-progress upgrade lands. null = no active upgrade — Team Manager player only: after a
  // delivery the player's plan goes idle until they pick the next package (the car stagnates meanwhile).
  // AI plans are never null (they develop continuously).
  nextUpgradeRound: number | null
  fundingTier: FundingTier      // funding tier (1-4); now informational — drives the reshuffle nudge, not upgrade size
  cumulativePenalty: number     // legacy field, always 0 since the tier penalty was replaced by catch-up upgrades
  // Pre-rolled outcome of the upgrade due at nextUpgradeRound, so the player can
  // view and god-mode edit it before it lands. The catch-up bonus is already baked in,
  // so pendingPaceDelta is the final pace gain that will be applied.
  // Optional: saves serialized before this field existed won't have it (migrated
  // on rehydrate; applyUpgradeEvents also rolls lazily if still missing).
  pendingPaceDelta?: number
  pendingFailed?: boolean       // the upcoming upgrade will deliver nothing (5% base chance)
  pendingPackageName?: string   // Team Manager: the part the player chose to develop, echoed in the reveal
  playerControlled?: boolean    // Team Manager: the player sets this team's cycle, so it isn't re-randomised
}

export interface DevUpgradeEvent {
  teamId: string
  round: number
  paceDelta: number
  failed: boolean
  packageName?: string          // Team Manager: the player's chosen package, shown in the upgrade-reveal modal
}

// God-mode grid changes (add/remove a team) queued during a season, applied at the
// end-of-season transition so they take effect at the start of the following season.
// Departing teams' drivers re-enter the market; new teams enter at the lowest car pace.
export interface PendingGridChanges {
  additions: Team[]      // new teams to add next season (seats start empty, filled by the market)
  removals: string[]     // teamIds to remove at season end
}

export interface ConstructorSeasonRecord {
  seasonYear: number
  teamId: string
  finalPosition: number
  points: number
}

export interface DriverProgressionEvent {
  driverId: string
  driverName: string
  stat: 'pace' | 'wetWeatherPace' | 'overtaking' | 'smoothness' | 'consistency'
  before: number
  after: number
  direction: 'improved' | 'declined' | 'unchanged'
}

export interface DriverMediaScore { driverId: string; score: number }
export interface TeamMediaScore   { teamId: string;   score: number }

// Full media breakdown for the power-rankings view — the component values that
// feed `media_score = 0.35·a + 0.45·b + 0.2·c + narrative + paceNarrative`.
export interface DriverMediaBreakdown {
  driverId: string
  a: number              // results percentile (grid only)
  b: number              // teammate H2H
  c: number              // car-adjusted overperformance
  narrative: number      // effective narrative: god-mode modifier after past-prime decay
  paceNarrative: number  // pace-derived swing (free agents only)
  score: number
}

export interface MarketMove {
  driverId: string
  driverName: string
  fromTeamId: string | null
  toTeamId: string
  toTeamName: string
  contractLength: number
  contractExpiresAfterSeason: number
  mediaScore: number
  isResignation: boolean   // re-signed with the same team (from === to)
}

export interface SeatContestDriver {
  driverId: string
  driverName: string
  teamPerceived: number   // the team's perceived value: driver media + incumbent bonus + noise
  incumbent: boolean      // the driver's expiring contract was with this team
}

// A driver whose contract expired and who was NOT re-signed anywhere — dropped
// to the free-agent pool this off-season.
export interface DroppedDriver {
  driverId: string
  driverName: string
  fromTeamId: string
  fromTeamName: string
  mediaScore: number
}

// A team's seat battle from the deferred-acceptance market — raw material for
// newsroom transfer stories. `winners` are who the team signed, `rivals` are the
// free agents it turned away; teamPerceived is the "why".
export interface SeatContest {
  teamId: string
  teamName: string
  seats: number                    // open seats the team was filling
  winners: SeatContestDriver[]     // signed, best-perceived first
  rivals: SeatContestDriver[]      // applied but turned away, best-perceived first
}

// Fuel load is revealed to the player only as a qualitative band, never the
// exact number — so a fast lap on a full tank reads as genuinely quick.
export type FuelBand = 'full' | 'heavy' | 'medium' | 'light'

export interface PreSeasonTestEntry {
  teamId: string
  teamName: string
  driverId: string
  driverName: string
  tyre: TyreCompound
  fuelBand: FuelBand
  lapTime: number   // simulated representative lap (seconds)
  carPace: number   // true new-season pace; only surfaced via god-mode reveal
}

export interface PreSeasonTest {
  circuitName: string
  entries: PreSeasonTestEntry[]   // sorted by lapTime ascending
}

export interface EndOfSeasonSummary {
  seasonYear: number
  driverChampion: string
  constructorChampion: string
  progressionEvents: DriverProgressionEvent[]
  retiredDriverIds: string[]
  carReshuffleOldPaces: Record<string, number>
  carReshuffleNewPaces: Record<string, number>
  marketMoves: MarketMove[]
  droppedDrivers: DroppedDriver[]
  seatContests: SeatContest[]
  driverMediaScores: DriverMediaScore[]
  teamMediaScores: TeamMediaScore[]
  upgradeEvents: DevUpgradeEvent[]
  preSeasonTest: PreSeasonTest | null
  // Per-driver finish vs car-pace expectation this season; drives re-sign offers.
  // Optional: saves serialized before this field existed won't have it (caller defaults to {}).
  retentionDelta?: Record<string, number>
  // God-mode grid changes taking effect NEXT season, captured here so the newsroom can announce
  // a new team's arrival and bid a departing team farewell at the close of its final season.
  // Optional for backward-compatible saves. finalPosition is the leaver's last championship place.
  gridAdditions?: { teamId: string; teamName: string }[]
  gridRemovals?: { teamId: string; teamName: string; finalPosition: number | null }[]
  // A lineage that kept its id but changed name next season (e.g. Sauber -> Audi): announced as a
  // rebrand at the close of the current season. Same shape for live + archived-replay paths.
  gridRebrands?: { teamId: string; fromName: string; toName: string }[]
}
