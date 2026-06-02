// Formatting helpers for the world result displays.

// 83456 ms -> "1:23.456"; null -> "—".
export function formatLapTime(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const total = ms / 1000
  const mins = Math.floor(total / 60)
  const secs = total - mins * 60
  const secStr = secs.toFixed(3).padStart(6, '0')
  return mins > 0 ? `${mins}:${secStr}` : secStr
}

// Total race time in ms -> "1:34:12.345" / "34:12.345"; null -> "—".
export function formatRaceTime(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const total = ms / 1000
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total - hrs * 3600) / 60)
  const secs = total - hrs * 3600 - mins * 60
  const secStr = secs.toFixed(3).padStart(6, '0')
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${secStr}`
  return `${mins}:${secStr}`
}

// Gap behind the winner, F1-style: "+12.456s" under a minute, "+1:23.456" beyond.
export function formatGap(ms: number): string {
  const total = ms / 1000
  if (total < 60) return `+${total.toFixed(3)}s`
  const mins = Math.floor(total / 60)
  const secs = total - mins * 60
  return `+${mins}:${secs.toFixed(3).padStart(6, '0')}`
}
