import { getPoints } from '@/lib/sim/points'

// Race-result chip. The green "in the points" tier follows the season's era points system (issue #63):
// top 6 (1996-2002), top 8 (2003-2009), top 10 (2010+) — `year` decides which positions scored.
// `code` (optional) stacks the circuit's short code above the result inside the square — used by the
// driver career grid, whose column headers are round numbers (calendars differ across eras, #64).
export function ResultChip({ position, year, code }: { position: number | null | undefined; year: number; code?: string }) {
  // Future round — render nothing
  if (position === undefined) {
    return <div className="w-8 h-7" />
  }

  let bg = ''
  let fg = ''
  let label = ''
  if (position === null)                    { bg = '#5C2475'; fg = '#E8BBFF'; label = 'DNF' }
  else if (position === 1)                  { bg = '#D4AC00'; fg = '#0F1419'; label = String(position) }
  else if (position === 2)                  { bg = '#9E9E9E'; fg = '#0F1419'; label = String(position) }
  else if (position === 3)                  { bg = '#C0622B'; fg = '#FFFFFF'; label = String(position) }
  else if (getPoints(position, year) > 0)   { bg = '#1A4A2E'; fg = '#6EE7A0'; label = String(position) }
  else                                      { bg = '#1A4A66'; fg = '#A8DEFF'; label = String(position) }

  return (
    <div className="w-8 h-7 flex flex-col items-center justify-center rounded leading-none"
      style={{ backgroundColor: bg, color: fg }}>
      {code && <span className="text-[6px] font-semibold uppercase tracking-tight opacity-70">{code}</span>}
      <span className={position === null ? 'text-[10px] font-bold' : 'text-[11px] font-bold'}>{label}</span>
    </div>
  )
}

export function ResultCell({ position, year, code }: { position: number | null | undefined; year: number; code?: string }) {
  return (
    <td className="px-0.5 py-0.5">
      <ResultChip position={position} year={year} code={code} />
    </td>
  )
}
