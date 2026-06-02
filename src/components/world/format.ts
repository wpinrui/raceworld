// Formatting helpers for the world result displays.
// NOTE: the sim stores all lap/race times in SECONDS (despite the `_ms` column
// names in the DB), matching how the live race screens format them.

// 87.234 s -> "1:27.234"; null -> "—".
export function formatLapTime(s: number | null | undefined): string {
  if (s == null) return '—'
  const mins = Math.floor(s / 60)
  const secs = s - mins * 60
  const secStr = secs.toFixed(3).padStart(6, '0')
  return mins > 0 ? `${mins}:${secStr}` : secStr
}

// Total race time in seconds -> "1:27:48.000" / "27:48.000"; null -> "—".
export function formatRaceTime(s: number | null | undefined): string {
  if (s == null) return '—'
  const hrs = Math.floor(s / 3600)
  const mins = Math.floor((s - hrs * 3600) / 60)
  const secs = s - hrs * 3600 - mins * 60
  const secStr = secs.toFixed(3).padStart(6, '0')
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${secStr}`
  return `${mins}:${secStr}`
}

// Gap behind the winner, in seconds, F1-style: "+7.231s" under a minute, "+1:23.456" beyond.
export function formatGap(s: number): string {
  if (s < 60) return `+${s.toFixed(3)}s`
  const mins = Math.floor(s / 60)
  const secs = s - mins * 60
  return `+${mins}:${secs.toFixed(3).padStart(6, '0')}`
}
