import { Circuit } from '@/lib/sim/types'

// The 24-round 2026 Formula 1 calendar (the originally-announced schedule). Each race carries
// `sundayOfYear` — the ordinal Sunday of the season year on which it runs — so the schedule
// resolves to a real date for ANY future year via resolveRaceDate (see src/lib/sim/calendar-dates.ts).
// 2026 reference dates are in the trailing comments. Las Vegas (real-world Saturday) is normalised
// to its weekend Sunday, consistent with the Sunday-ordinal scheme.
export const calendar2026: Circuit[] = [
  { id: 'australia',    name: 'Australian GP',          code: 'AUS', location: 'Melbourne',     country: 'AU', laps: 58, flatModifier: -13, sundayOfYear: 10 }, // 8 Mar
  { id: 'china',        name: 'Chinese GP',             code: 'CHN', location: 'Shanghai',      country: 'CN', laps: 56, flatModifier:  -5, sundayOfYear: 11 }, // 15 Mar
  { id: 'japan',        name: 'Japanese GP',            code: 'JPN', location: 'Suzuka',        country: 'JP', laps: 53, flatModifier:  -8, sundayOfYear: 13 }, // 29 Mar
  { id: 'bahrain',      name: 'Bahrain GP',             code: 'BHR', location: 'Sakhir',        country: 'BH', laps: 57, flatModifier:  -7, sundayOfYear: 15 }, // 12 Apr
  { id: 'saudi-arabia', name: 'Saudi Arabian GP',       code: 'SAU', location: 'Jeddah',        country: 'SA', laps: 50, flatModifier: -10, sundayOfYear: 16 }, // 19 Apr
  { id: 'miami',        name: 'Miami GP',               code: 'MIA', location: 'Miami',         country: 'US', laps: 57, flatModifier:  -8, sundayOfYear: 18 }, // 3 May
  { id: 'canada',       name: 'Canadian GP',            code: 'CAN', location: 'Montreal',      country: 'CA', laps: 70, flatModifier: -24, sundayOfYear: 21 }, // 24 May
  { id: 'monaco',       name: 'Monaco GP',              code: 'MON', location: 'Monte Carlo',   country: 'MC', laps: 78, flatModifier: -23, sundayOfYear: 23 }, // 7 Jun
  { id: 'spain',        name: 'Barcelona-Catalunya GP', code: 'ESP', location: 'Barcelona',     country: 'ES', laps: 66, flatModifier:  -3, sundayOfYear: 24 }, // 14 Jun
  { id: 'austria',      name: 'Austrian GP',            code: 'AUT', location: 'Red Bull Ring', country: 'AT', laps: 71, flatModifier: -32, sundayOfYear: 26 }, // 28 Jun
  { id: 'britain',      name: 'British GP',             code: 'GBR', location: 'Silverstone',   country: 'GB', laps: 52, flatModifier: -11, sundayOfYear: 27 }, // 5 Jul
  { id: 'belgium',      name: 'Belgian GP',             code: 'BEL', location: 'Spa',           country: 'BE', laps: 44, flatModifier:   7, sundayOfYear: 29 }, // 19 Jul
  { id: 'hungary',      name: 'Hungarian GP',           code: 'HUN', location: 'Budapest',      country: 'HU', laps: 70, flatModifier: -20, sundayOfYear: 30 }, // 26 Jul
  { id: 'netherlands',  name: 'Dutch GP',               code: 'NED', location: 'Zandvoort',     country: 'NL', laps: 72, flatModifier: -26, sundayOfYear: 34 }, // 23 Aug
  { id: 'italy',        name: 'Italian GP',             code: 'ITA', location: 'Monza',         country: 'IT', laps: 53, flatModifier: -18, sundayOfYear: 36 }, // 6 Sep
  { id: 'madrid',       name: 'Spanish GP',             code: 'MAD', location: 'Madrid',        country: 'ES', laps: 57, flatModifier:  -6, sundayOfYear: 37 }, // 13 Sep
  { id: 'azerbaijan',   name: 'Azerbaijan GP',          code: 'AZE', location: 'Baku',          country: 'AZ', laps: 51, flatModifier:   2, sundayOfYear: 39 }, // 27 Sep
  { id: 'singapore',    name: 'Singapore GP',           code: 'SIN', location: 'Marina Bay',    country: 'SG', laps: 62, flatModifier:   0, sundayOfYear: 41 }, // 11 Oct
  { id: 'usa',          name: 'US GP',                  code: 'USA', location: 'Austin',        country: 'US', laps: 56, flatModifier:  -3, sundayOfYear: 43 }, // 25 Oct
  { id: 'mexico',       name: 'Mexico City GP',         code: 'MXC', location: 'Mexico City',   country: 'MX', laps: 71, flatModifier: -21, sundayOfYear: 44 }, // 1 Nov
  { id: 'brazil',       name: 'Sao Paulo GP',           code: 'SAP', location: 'Interlagos',    country: 'BR', laps: 71, flatModifier: -27, sundayOfYear: 45 }, // 8 Nov
  { id: 'las-vegas',    name: 'Las Vegas GP',           code: 'LVG', location: 'Las Vegas',     country: 'US', laps: 50, flatModifier:  -4, sundayOfYear: 47 }, // 22 Nov (Sun of race weekend)
  { id: 'qatar',        name: 'Qatar GP',               code: 'QAT', location: 'Lusail',        country: 'QA', laps: 57, flatModifier: -17, sundayOfYear: 48 }, // 29 Nov
  { id: 'abu-dhabi',    name: 'Abu Dhabi GP',           code: 'ABU', location: 'Yas Marina',    country: 'AE', laps: 58, flatModifier: -10, sundayOfYear: 49 }, // 6 Dec
]
