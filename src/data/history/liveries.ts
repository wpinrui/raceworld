import type { CarPaint } from '@/lib/scene3d/car-mesh'

// Era-appropriate liveries for every constructor on the 1996-2026 timeline, keyed by the SAME team
// id `grids.ts` uses, so a rebrand (Jordan -> Midland -> Spyker -> Force India -> Racing Point ->
// Aston Martin) is a run of eras under one id rather than a new entry.
//
// Eras are declared only where the car ACTUALLY changed. Red Bull has worn one palette since 2005
// and gets one entry; Williams changed title sponsor five times and gets five. Nothing here exists
// to add variation for its own sake.
//
// Five slots per era, matching the paintable surfaces on the 3D car:
//   body   monocoque, nose, sidepods, wing pylons
//   cover  engine cover and airbox, rear flap, shoulder fins
//   wing   front wing's neutral plane and the beam wing
//   accent front wing flaps and the rear mainplane
//   trim   endplates, mirrors, wheel centre caps

export interface LiveryEra {
  /** First season this palette is worn. */
  from: number
  /** Last season, inclusive. */
  to: number
  paint: CarPaint
}

const p = (body: string, cover: string, wing: string, accent: string, trim: string): CarPaint =>
  ({ body, cover, wing, accent, trim })

const WHITE = '#F2F2F2'
const BLACK = '#101010'
const SILVER = '#C8CCD0'
/** Chrome, as far as a flat-shaded renderer can carry it: a dark metal grey that the sun lifts,
 *  rather than a light grey that already sits at its own highlight and has nowhere to go. */
const CHROME = '#79818B'
const GOLD = '#C9A227'
const RED = '#C8102E'

export const teamLiveries: Record<string, LiveryEra[]> = {
  williams: [
    // Rothmans white/blue/gold, then Winfield red, then the BMW years, Martini, and the navy era.
    { from: 1996, to: 1997, paint: p(WHITE, '#0B2E6E', '#0B2E6E', '#D6A03A', '#1B60B0') },
    { from: 1998, to: 1999, paint: p('#E8E8E8', RED, RED, '#1B4FA0', '#E8E8E8') },
    { from: 2000, to: 2005, paint: p(WHITE, '#0F2C63', '#0F2C63', '#E3001B', WHITE) },
    { from: 2006, to: 2013, paint: p(WHITE, '#1B4FA0', '#1B4FA0', '#E3001B', WHITE) },
    { from: 2014, to: 2019, paint: p(WHITE, '#0A2E63', '#0A2E63', RED, '#6BA4DE') },
    { from: 2020, to: 2026, paint: p('#16305E', '#0E2247', '#16305E', '#3AA0E8', WHITE) },
  ],
  ferrari: [
    // Fully red, every slot. The only change in thirty years is the shade of red.
    { from: 1996, to: 2018, paint: p('#D50000', '#D50000', '#D50000', '#D50000', '#D50000') },
    { from: 2019, to: 2026, paint: p('#DC0000', '#DC0000', '#DC0000', '#DC0000', '#DC0000') },
  ],
  enstone: [
    { from: 1996, to: 2001, paint: p('#0F3D91', '#1E9E4A', '#0F3D91', '#E8C300', WHITE) },
    { from: 2002, to: 2006, paint: p('#F5D000', '#1B3D8F', '#1B3D8F', '#F5D000', WHITE) },
    { from: 2007, to: 2009, paint: p('#F5D000', '#F26522', WHITE, '#1B3D8F', WHITE) },
    { from: 2010, to: 2011, paint: p(BLACK, BLACK, GOLD, GOLD, WHITE) },
    // Lotus black and gold, then Renault yellow, then Alpine blue and pink.
    { from: 2012, to: 2015, paint: p('#0A0A0A', '#0A0A0A', '#D4AF37', '#D4AF37', RED) },
    { from: 2016, to: 2020, paint: p('#F5D000', BLACK, '#F5D000', BLACK, WHITE) },
    { from: 2021, to: 2026, paint: p('#0A2A5E', '#0A2A5E', '#1E60C0', '#E85D9B', WHITE) },
  ],
  mclaren: [
    { from: 1996, to: 1996, paint: p(WHITE, WHITE, '#E30613', '#E30613', BLACK) },
    { from: 1997, to: 2005, paint: p(SILVER, BLACK, SILVER, '#E30613', BLACK) },
    { from: 2006, to: 2013, paint: p(CHROME, CHROME, '#E30613', '#E30613', BLACK) },
    { from: 2014, to: 2016, paint: p('#6E7276', BLACK, '#6E7276', '#E30613', BLACK) },
    { from: 2017, to: 2026, paint: p('#FF8000', '#FF8000', BLACK, '#FF8000', '#47C7FC') },
  ],
  silverstone: [
    { from: 1996, to: 2001, paint: p(GOLD, BLACK, GOLD, BLACK, WHITE) },
    { from: 2002, to: 2005, paint: p('#F5D000', BLACK, '#F5D000', '#E30613', WHITE) },
    { from: 2006, to: 2006, paint: p(RED, WHITE, RED, WHITE, BLACK) },
    { from: 2007, to: 2007, paint: p('#F26522', BLACK, '#F26522', BLACK, SILVER) },
    { from: 2008, to: 2016, paint: p(WHITE, '#F26522', '#1E9E4A', '#F26522', BLACK) },
    { from: 2017, to: 2020, paint: p('#F5559B', '#F5559B', BLACK, '#F5559B', WHITE) },
    { from: 2021, to: 2026, paint: p('#00594F', '#00594F', '#00594F', '#CEDC00', WHITE) },
  ],
  prost: [
    { from: 1996, to: 1996, paint: p('#1E4FA0', WHITE, '#1E4FA0', '#E30613', WHITE) },
    { from: 1997, to: 1999, paint: p('#1B3D8F', WHITE, '#1B3D8F', '#E30613', WHITE) },
    { from: 2000, to: 2001, paint: p('#1B3D8F', BLACK, '#1B3D8F', SILVER, WHITE) },
  ],
  hinwil: [
    { from: 1996, to: 2005, paint: p('#0F3D91', WHITE, '#0F3D91', RED, WHITE) },
    { from: 2006, to: 2009, paint: p(WHITE, '#0F3D91', WHITE, RED, '#0F3D91') },
    { from: 2010, to: 2014, paint: p(WHITE, BLACK, WHITE, RED, BLACK) },
    { from: 2015, to: 2018, paint: p('#0B2E6E', '#0B2E6E', '#F5D000', '#F5D000', WHITE) },
    { from: 2019, to: 2023, paint: p('#8B0000', WHITE, '#8B0000', RED, WHITE) },
    { from: 2024, to: 2025, paint: p('#00E701', BLACK, '#00E701', BLACK, WHITE) },
    { from: 2026, to: 2026, paint: p('#BB0A30', BLACK, WHITE, '#BB0A30', WHITE) },
  ],
  brackley: [
    { from: 1996, to: 1998, paint: p('#1E7FD0', WHITE, '#1E7FD0', BLACK, WHITE) },
    { from: 1999, to: 2005, paint: p(WHITE, RED, WHITE, RED, BLACK) },
    { from: 2006, to: 2008, paint: p(WHITE, RED, WHITE, RED, '#1E7FD0') },
    { from: 2009, to: 2009, paint: p(WHITE, '#DCE93A', WHITE, '#DCE93A', BLACK) },
    { from: 2010, to: 2019, paint: p(SILVER, SILVER, SILVER, '#00D2BE', BLACK) },
    { from: 2020, to: 2021, paint: p(BLACK, BLACK, BLACK, '#00D2BE', SILVER) },
    { from: 2022, to: 2026, paint: p(SILVER, BLACK, SILVER, '#00D2BE', BLACK) },
  ],
  arrows: [
    { from: 1996, to: 1996, paint: p(WHITE, '#F26522', WHITE, '#F26522', BLACK) },
    { from: 1997, to: 1999, paint: p('#F26522', WHITE, '#F26522', BLACK, WHITE) },
    { from: 2000, to: 2002, paint: p(BLACK, BLACK, '#F26522', '#F26522', SILVER) },
  ],
  faenza: [
    { from: 1996, to: 2000, paint: p(BLACK, '#F5D000', BLACK, '#F5D000', WHITE) },
    { from: 2001, to: 2005, paint: p(BLACK, RED, BLACK, RED, WHITE) },
    { from: 2006, to: 2016, paint: p('#0B2E6E', RED, SILVER, RED, WHITE) },
    { from: 2017, to: 2019, paint: p('#1B3D8F', '#1B3D8F', SILVER, RED, WHITE) },
    { from: 2020, to: 2023, paint: p('#20394C', '#20394C', WHITE, WHITE, SILVER) },
    { from: 2024, to: 2026, paint: p(WHITE, '#1B3D8F', WHITE, RED, '#1B3D8F') },
  ],
  forti: [
    { from: 1996, to: 1996, paint: p('#E8D000', BLACK, '#E8D000', '#1B3D8F', WHITE) },
  ],
  miltonkeynes: [
    { from: 1997, to: 1999, paint: p(WHITE, WHITE, WHITE, RED, '#1B3D8F') },
    { from: 2000, to: 2004, paint: p('#0B4D2C', '#0B4D2C', '#0B4D2C', GOLD, WHITE) },
    // Red Bull have worn one palette since 2005: navy with red and yellow. One era, not twenty-two.
    { from: 2005, to: 2026, paint: p('#0B1B47', '#0B1B47', '#0B1B47', RED, '#F5D000') },
  ],
  lola: [
    { from: 1997, to: 1997, paint: p(RED, WHITE, RED, BLACK, WHITE) },
  ],
  toyota: [
    { from: 2002, to: 2009, paint: p(WHITE, WHITE, RED, RED, BLACK) },
  ],
  superaguri: [
    { from: 2006, to: 2008, paint: p(WHITE, RED, WHITE, RED, BLACK) },
  ],
  caterham: [
    { from: 2010, to: 2014, paint: p('#0B5B34', '#0B5B34', '#0B5B34', '#F5D000', WHITE) },
  ],
  hrt: [
    { from: 2010, to: 2010, paint: p('#6E7276', BLACK, '#6E7276', RED, WHITE) },
    { from: 2011, to: 2012, paint: p(BLACK, BLACK, RED, GOLD, WHITE) },
  ],
  manor: [
    { from: 2010, to: 2011, paint: p(BLACK, RED, BLACK, RED, WHITE) },
    { from: 2012, to: 2015, paint: p(RED, BLACK, RED, WHITE, BLACK) },
    { from: 2016, to: 2016, paint: p(WHITE, '#1B3D8F', WHITE, RED, BLACK) },
  ],
  haas: [
    { from: 2016, to: 2018, paint: p(SILVER, BLACK, SILVER, RED, BLACK) },
    { from: 2019, to: 2019, paint: p(BLACK, BLACK, GOLD, GOLD, WHITE) },
    { from: 2020, to: 2026, paint: p(WHITE, BLACK, WHITE, RED, BLACK) },
  ],
  cadillac: [
    { from: 2026, to: 2026, paint: p(BLACK, BLACK, GOLD, GOLD, WHITE) },
  ],
}

/** The palette a constructor wore in a given season. Falls back to a spread of the team's single
 *  `color` so a team added to the grid without a livery entry still paints, rather than throwing. */
export function liveryFor(teamId: string, year: number, fallback: string): CarPaint {
  const eras = teamLiveries[teamId]
  const era = eras?.find((e) => year >= e.from && year <= e.to)
    ?? eras?.[year < (eras[0]?.from ?? 0) ? 0 : eras.length - 1]
  return era?.paint ?? p(fallback, fallback, SILVER, fallback, SILVER)
}
