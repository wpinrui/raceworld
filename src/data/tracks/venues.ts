// Where each circuit stands on the earth, and when it races (#time-of-day).
//
// The only consumer is `lib/ui/sun.ts`, which turns these into the sun's altitude and bearing. They
// are the venue's real coordinates and its usual slot on the calendar: the month and day set the
// declination, the start hour and the UTC offset set the hour angle, and between them they say
// whether a race runs under a high summer sun, a low autumn one, or floodlights.
//
// The offsets are the ones in force ON RACE DAY, summer time included where the country keeps it,
// because an hour's error at a low sun is a fifth of the shadow length.
//
// Circuits that have left the calendar keep the slot they last raced in, which is the honest answer
// for a historical season and the only one available for one that never had a modern date.

import type { Lighting } from '@/lib/ui/lighting'
import { isFloodlit, lightingAt, raceClock, type SkyState, type Venue } from '@/lib/ui/sun'

/** Every venue, by the circuit id `TRACK_LAYOUTS` keys on. */
export const VENUES: Record<string, Venue> = {
  'abu-dhabi': { lat: 24.47, lon: 54.60, month: 12, day: 7, startHour: 17, utcOffset: 4 },
  argentina: { lat: -34.69, lon: -58.46, month: 4, day: 12, startHour: 14, utcOffset: -3 },
  australia: { lat: -37.85, lon: 144.97, month: 3, day: 16, startHour: 15, utcOffset: 11 },
  austria: { lat: 47.22, lon: 14.76, month: 6, day: 29, startHour: 15, utcOffset: 2 },
  azerbaijan: { lat: 40.37, lon: 49.85, month: 9, day: 15, startHour: 15, utcOffset: 4 },
  bahrain: { lat: 26.03, lon: 50.51, month: 3, day: 2, startHour: 18, utcOffset: 3 },
  belgium: { lat: 50.44, lon: 5.97, month: 7, day: 27, startHour: 15, utcOffset: 2 },
  brazil: { lat: -23.70, lon: -46.70, month: 11, day: 9, startHour: 14, utcOffset: -3 },
  britain: { lat: 52.07, lon: -1.02, month: 7, day: 6, startHour: 15, utcOffset: 1 },
  canada: { lat: 45.50, lon: -73.52, month: 6, day: 15, startHour: 14, utcOffset: -4 },
  china: { lat: 31.34, lon: 121.22, month: 4, day: 20, startHour: 15, utcOffset: 8 },
  estoril: { lat: 38.75, lon: -9.39, month: 9, day: 22, startHour: 14, utcOffset: 1 },
  hockenheim: { lat: 49.33, lon: 8.57, month: 7, day: 28, startHour: 14, utcOffset: 2 },
  hungary: { lat: 47.58, lon: 19.25, month: 7, day: 20, startHour: 15, utcOffset: 2 },
  imola: { lat: 44.34, lon: 11.71, month: 5, day: 18, startHour: 15, utcOffset: 2 },
  indianapolis: { lat: 39.79, lon: -86.23, month: 9, day: 28, startHour: 13, utcOffset: -4 },
  italy: { lat: 45.62, lon: 9.28, month: 9, day: 7, startHour: 15, utcOffset: 2 },
  japan: { lat: 34.84, lon: 136.54, month: 4, day: 6, startHour: 14, utcOffset: 9 },
  'las-vegas': { lat: 36.11, lon: -115.17, month: 11, day: 22, startHour: 20, utcOffset: -8 },
  madrid: { lat: 40.47, lon: -3.61, month: 9, day: 13, startHour: 15, utcOffset: 2 },
  'magny-cours': { lat: 46.86, lon: 3.16, month: 7, day: 1, startHour: 14, utcOffset: 2 },
  malaysia: { lat: 2.76, lon: 101.74, month: 10, day: 1, startHour: 15, utcOffset: 8 },
  mexico: { lat: 19.40, lon: -99.09, month: 10, day: 26, startHour: 14, utcOffset: -6 },
  miami: { lat: 25.96, lon: -80.24, month: 5, day: 4, startHour: 16, utcOffset: -4 },
  monaco: { lat: 43.73, lon: 7.42, month: 5, day: 25, startHour: 15, utcOffset: 2 },
  mugello: { lat: 43.99, lon: 11.37, month: 9, day: 13, startHour: 15, utcOffset: 2 },
  netherlands: { lat: 52.39, lon: 4.54, month: 8, day: 31, startHour: 15, utcOffset: 2 },
  nurburgring: { lat: 50.33, lon: 6.95, month: 7, day: 27, startHour: 14, utcOffset: 2 },
  'paul-ricard': { lat: 43.25, lon: 5.79, month: 7, day: 20, startHour: 15, utcOffset: 2 },
  portimao: { lat: 37.23, lon: -8.63, month: 10, day: 24, startHour: 15, utcOffset: 1 },
  qatar: { lat: 25.49, lon: 51.45, month: 11, day: 30, startHour: 19, utcOffset: 3 },
  russia: { lat: 43.41, lon: 39.97, month: 9, day: 26, startHour: 14, utcOffset: 3 },
  'saudi-arabia': { lat: 21.63, lon: 39.10, month: 4, day: 20, startHour: 20, utcOffset: 3 },
  singapore: { lat: 1.29, lon: 103.86, month: 10, day: 5, startHour: 20, utcOffset: 8 },
  spain: { lat: 41.57, lon: 2.26, month: 6, day: 1, startHour: 15, utcOffset: 2 },
  turkey: { lat: 40.95, lon: 29.41, month: 10, day: 10, startHour: 15, utcOffset: 3 },
  usa: { lat: 30.13, lon: -97.64, month: 10, day: 19, startHour: 14, utcOffset: -5 },
}

/** A venue with a fallback, for a circuit added without one. Silverstone in July at three o'clock:
 *  an ordinary mid-afternoon summer race, which is the least surprising light there is. */
export const DEFAULT_VENUE: Venue = VENUES.britain

export function venueFor(circuitId: string): Venue {
  return VENUES[circuitId] ?? DEFAULT_VENUE
}

/** The light a circuit races in, and whether the floodlights are carrying it.
 *
 *  Sampled at the race's MIDPOINT, which is the one decision in here worth stating: the world's road
 *  ink, its baked sky and its light rig are all built from this value, so a sun that moved per lap
 *  would rebuild the circuit and re-bake the environment under the player. The midpoint is the
 *  fairest single sample, being the light most of the distance is actually run in.
 *
 *  One function rather than three call sites doing the same three calls, because they must agree:
 *  the sky, the floodlights and the shadows all have to be describing the same moment. */
export function raceLight(
  circuitId: string, sky: SkyState = { cloud: 0 },
): { lighting: Lighting; floodlit: boolean } {
  const venue = venueFor(circuitId)
  const clock = raceClock(venue, 0.5)
  return { lighting: lightingAt(venue, clock, sky), floodlit: isFloodlit(venue, clock) }
}
