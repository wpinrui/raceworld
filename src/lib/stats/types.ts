// Types for the stats-engine feat/record detector. Kept free of any server-only
// imports (no better-sqlite3) so client components can render a Feat[] returned
// from a Server Action.

export type FeatCategory =
  | 'title'         // championships
  | 'record'        // an all-time #1
  | 'milestone'     // round-number career landmark (50th win, 1000 points…)
  | 'streak'        // consecutive-race run
  | 'season'        // single-season record/landmark
  | 'race'          // single-race feat
  | 'constructor'   // team-level feat
  | 'teammate'      // head-to-head vs teammate
  | 'championship'  // title-race state (clinch / decider)

export interface Feat {
  id: string             // stable key, e.g. "driver-50-wins" — lets callers dedupe
  category: FeatCategory
  title: string          // short label, e.g. "3× World Champion"
  detail?: string        // supporting line, e.g. "2027 · 2029 · 2031"
  value?: number
  year?: number          // season the feat belongs to, when applicable
  round?: number
  allTime?: boolean      // an all-time #1 record (drives emphasis + newsworthiness)
  priority: number       // 0–100; higher = more newsworthy / sorted first
}
