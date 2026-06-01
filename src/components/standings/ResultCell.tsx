// Colour-coded race result cell per GDD / style-guide Wikipedia F1 convention
export function ResultCell({ position, round }: { position: number | null | undefined; round?: number }) {
  if (position === undefined) {
    // Future round
    return (
      <td className="px-0.5 py-0.5">
        <div className="w-8 h-7 flex items-center justify-center rounded text-[10px] font-mono text-[#6B7280] border border-dashed border-[#2A3142]">
          {round !== undefined ? String(round + 1).padStart(2, '0') : '·'}
        </div>
      </td>
    )
  }

  if (position === null) {
    // DNF
    return (
      <td className="px-0.5 py-0.5">
        <div className="w-8 h-7 flex items-center justify-center rounded text-[10px] font-mono font-bold"
          style={{ backgroundColor: '#3A1A4A', color: '#C084FC' }}>
          DNF
        </div>
      </td>
    )
  }

  let bg = ''
  let fg = ''

  if (position === 1) {
    bg = '#D4AC00'; fg = '#0F1419'
  } else if (position === 2) {
    bg = '#9E9E9E'; fg = '#0F1419'
  } else if (position === 3) {
    bg = '#C0622B'; fg = '#FFFFFF'
  } else if (position <= 10) {
    bg = '#1A4A2E'; fg = '#6EE7A0'
  } else {
    bg = '#0D2A3A'; fg = '#7ECFEA'
  }

  const ordinal = position === 1 ? 'ST' : position === 2 ? 'ND' : position === 3 ? 'RD' : 'TH'

  return (
    <td className="px-0.5 py-0.5">
      <div
        className="w-8 h-7 flex items-center justify-center rounded text-[10px] font-mono font-bold"
        style={{ backgroundColor: bg, color: fg }}
      >
        {position}<sup className="text-[7px]">{ordinal}</sup>
      </div>
    </td>
  )
}
