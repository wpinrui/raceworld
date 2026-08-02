// Where the sun actually is (#time-of-day).
//
// The four scalars in `lighting.ts` describe a light. They do not say where that light came from, and
// for most of this project's life the answer was "a constant": every dry race on the calendar
// rendered `MOODS.afternoon`, an elevation of 0.75, which is a 67.5 degree sun. That is higher than
// the sun ever gets at the Hungaroring (65.9 degrees, solar noon, summer solstice), so the picture
// was not a time of day at any venue, it was a number. Shadows came out at 0.41x their caster's
// height where the real Hungarian GP runs 0.62x at the green light and 1.59x at the flag.
//
// So the light is computed instead, from the three things that actually determine it: where on the
// earth the circuit is, what day of the year the race is held, and what the clock says. Everything
// downstream is unchanged, because all of it already derived from those same four scalars.
//
// The BEARING is the half that needed the map to cooperate, and it does: `track-import` projects
// every trace equirectangular and north-up (`x = lon * cos(lat)`, `y = -lat`), so viewBox +x is east
// and +y is south, and a compass bearing converts straight into the world. It used to come from
// `pitViewAzimuth`, i.e. the sun was placed to light the pit buildings, which put it in the NORTH on
// northern-hemisphere circuits. Shadows now fall the way the hemisphere says they fall.

import type { Lighting } from './lighting'

const D = Math.PI / 180

/** A circuit's place on the earth and its slot in the calendar. Everything the sun needs. */
export interface Venue {
  /** Degrees north of the equator, negative south. */
  lat: number
  /** Degrees east of Greenwich, negative west. */
  lon: number
  /** Race month, 1..12, and day of that month. Together they set the sun's declination, which is
   *  what makes a Belgian summer race a high sun and a Brazilian November one lower than its
   *  latitude alone suggests. */
  month: number
  day: number
  /** The local clock hour the race starts, 24h and fractional (16.5 = half past four). */
  startHour: number
  /** Hours ahead of UTC at the venue ON RACE DAY, so a country keeping summer time gets the offset
   *  it is actually on rather than its winter one. Without this a race is placed an hour off, which
   *  at a low sun is a fifth of the shadow length. */
  utcOffset: number
}

/** How long a grand prix takes, in hours: the two-hour regulation limit is rarely reached and the
 *  distance is set to land near this. The sun tracks across it, so a race that starts in sunshine
 *  can finish in a low raking light, which is most of the point of computing this at all. */
export const RACE_HOURS = 1.6

/** Days into the year, ignoring leap years: a day's slip moves the declination by under half a
 *  degree, which is far below anything visible in a shadow. */
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
export function dayOfYear(month: number, day: number): number {
  return MONTH_STARTS[Math.max(0, Math.min(11, month - 1))] + day
}

/** The sun's declination: how far north or south of the equator it stands that day, which is the
 *  whole of the seasons. Cooper's formula, good to under half a degree. */
function declination(n: number): number {
  return 23.44 * D * Math.sin(((360 / 365) * (n + 284)) * D)
}

/** The equation of time, in HOURS: the earth's orbit is an ellipse and its axis is tilted, so the
 *  sun runs up to a quarter of an hour ahead of or behind the clock depending on the date. Small,
 *  but it is the difference between a race being placed at the right minute and a quarter hour out,
 *  and it is four lines. */
function equationOfTime(n: number): number {
  const b = ((360 / 364) * (n - 81)) * D
  return (9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b)) / 60
}

/** Local SOLAR hour from the local CLOCK hour: the clock is a zone-wide fiction, and a circuit sits
 *  wherever it sits inside its zone. Budapest keeps UTC+2 but stands at 19.25 east, so its solar
 *  noon falls at about 12:44 and not at twelve. */
export function solarHour(v: Venue, clockHour: number): number {
  const n = dayOfYear(v.month, v.day)
  return clockHour + (v.lon - 15 * v.utcOffset) / 15 + equationOfTime(n)
}

/** The clock hour at which the sun crosses the meridian, i.e. when `solarHour` reads twelve. Budapest
 *  keeps UTC+2, whose meridian is 30 east, and stands ten degrees WEST of it, so its noon is late. */
export function solarNoon(v: Venue): number {
  return 24 - solarHour(v, 12)
}

/** Where the sun stands, seen from the venue at that hour on the clock.
 *
 *  `altitude` is radians above the horizon and goes NEGATIVE once the sun has set, which is what
 *  makes a night race a night race rather than a venue on a list. `bearing` is the compass direction
 *  the sun lies in, radians clockwise from north, so 0 is north and pi/2 is east. */
export function sunPosition(v: Venue, clockHour: number): { altitude: number; bearing: number } {
  const dec = declination(dayOfYear(v.month, v.day))
  const lat = v.lat * D
  // The hour angle: fifteen degrees for every hour the sun is off the meridian, negative before it.
  const h = 15 * (solarHour(v, clockHour) - 12) * D
  const altitude = Math.asin(
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h),
  )
  // Measured from SOUTH by the arctangent, turned half a circle to read from north. At solar noon in
  // the northern hemisphere this lands on pi, which is due south, and that is the check.
  const bearing = Math.atan2(
    Math.sin(h), Math.cos(h) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat),
  ) + Math.PI
  // Wrapped into [0, 2pi). A southern-hemisphere noon lands the arctangent on pi and the half turn
  // carries it to exactly 2pi, which is due north said the long way round.
  return { altitude, bearing: bearing % (2 * Math.PI) }
}

/** A compass bearing as this project's `azimuth`, which is the direction light TRAVELS in the plan.
 *
 *  Two turns in one: the light runs the opposite way from the direction the sun lies in, and the map
 *  is north-up with +x east and +y south while `azimuth` is measured off +x toward +y. Verified by
 *  the case that matters: a sun due south sends its light due north, which is UP the screen. */
export function azimuthFromBearing(bearing: number): number {
  return Math.atan2(Math.cos(bearing), -Math.sin(bearing))
}

/** Altitude at which the floodlights are the race and the sun is dressing, in radians. Above it the
 *  scene is daylit; below it the light ramps into the night rig over the twilight below. */
const DAY_ALT = 8 * D
/** Altitude below which there is no usable daylight left: civil twilight's own definition. */
const NIGHT_ALT = -6 * D

/** The light the night rig runs at, which no solar geometry can produce because it is not sunlight:
 *  a floodlit circuit is lit from masts at a height, cool, flat and dark. Reached by ramp through
 *  twilight rather than by a switch, so Abu Dhabi's dusk race arrives at it over the distance
 *  instead of changing mood between two laps. */
const NIGHT = { elevation: 0.5, warmth: -0.5, ambient: 0.55, level: 0.5 }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Smooth 0..1 across an interval, for the twilight blend. */
function ramp(v: number, lo: number, hi: number): number {
  const t = clamp((v - lo) / (hi - lo), 0, 1)
  return t * t * (3 - 2 * t)
}

/** How wet the race is, 0..1, as the moisture the weather is actually carrying. Overcast is a real
 *  change in the LIGHT and not a mood label: the sun goes away into the cloud and the sky does the
 *  lighting, which is exactly what raising ambient and dropping warmth says. */
export interface SkyState {
  /** 0 dry and clear, 1 fully overcast. */
  cloud: number
}

/** The `Lighting` a venue renders under at that hour, with the weather over it.
 *
 *  Daylight derives everything from the sun's own altitude, which is the point: warmth rises as the
 *  sun drops because a low sun really is redder, ambient rises with it because more of the light
 *  arriving is scattered, and both fall out of one number instead of being authored per mood. */
export function lightingAt(v: Venue, clockHour: number, sky: SkyState = { cloud: 0 }): Lighting {
  const { altitude, bearing } = sunPosition(v, clockHour)
  const azimuth = azimuthFromBearing(bearing)
  // How much daylight is left: 1 with the sun up, 0 once it is properly down.
  const day = ramp(altitude, NIGHT_ALT, DAY_ALT)
  const sin = Math.max(0, Math.sin(altitude))
  const lit: Omit<Lighting, 'azimuth'> = {
    elevation: clamp(altitude / (Math.PI / 2), 0, 1),
    // A low sun is a red sun: its light crosses far more atmosphere and loses the blue end doing it.
    warmth: clamp(Math.pow(1 - sin, 0.6) * 0.9, 0, 1),
    // And a low sun is a bluer, flatter SHADOW, because more of what is left arrives scattered.
    ambient: clamp(0.22 + 0.25 * (1 - sin), 0, 1),
    level: 1,
  }
  const l: Lighting = {
    azimuth,
    elevation: mix(NIGHT.elevation, lit.elevation, day),
    warmth: mix(NIGHT.warmth, lit.warmth, day),
    ambient: mix(NIGHT.ambient, lit.ambient, day),
    level: mix(NIGHT.level, 1, day),
  }
  if (sky.cloud <= 0) return l
  // Cloud takes the sun out and hands its share to the whole dome: shadows fill in, the cast cools,
  // and the scene loses a little of its level with the direct beam.
  return {
    ...l,
    warmth: mix(l.warmth, -0.2, sky.cloud),
    ambient: clamp(mix(l.ambient, 0.75, sky.cloud), 0, 1),
    level: (l.level ?? 1) * mix(1, 0.85, sky.cloud),
  }
}

/** Whether the floodlights are carrying the race at that hour: the sun is too low to be doing it.
 *  Derived, so a venue is night because of where and when it races, not because it was on a list. */
export function isFloodlit(v: Venue, clockHour: number): boolean {
  return sunPosition(v, clockHour).altitude < DAY_ALT
}

/** The clock hour at a point through the race, 0 at the green light and 1 at the flag. */
export function raceClock(v: Venue, progress: number): number {
  return v.startHour + clamp(progress, 0, 1) * RACE_HOURS
}
