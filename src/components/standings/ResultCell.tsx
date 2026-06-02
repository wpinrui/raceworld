export function ResultChip({ position }: { position: number | null | undefined }) {
  // Future round — render nothing
  if (position === undefined) {
    return <div className="w-8 h-7" />
  }

  if (position === null) {
    return (
      <div className="w-8 h-7 flex items-center justify-center rounded text-[10px] font-bold"
        style={{ backgroundColor: '#5C2475', color: '#E8BBFF' }}>
        DNF
      </div>
    )
  }

  let bg = ''
  let fg = ''
  if (position === 1)       { bg = '#D4AC00'; fg = '#0F1419' }
  else if (position === 2)  { bg = '#9E9E9E'; fg = '#0F1419' }
  else if (position === 3)  { bg = '#C0622B'; fg = '#FFFFFF' }
  else if (position <= 10)  { bg = '#1A4A2E'; fg = '#6EE7A0' }
  else                      { bg = '#1A4A66'; fg = '#A8DEFF' }

  return (
    <div className="w-8 h-7 flex items-center justify-center rounded text-[11px] font-bold"
      style={{ backgroundColor: bg, color: fg }}>
      {position}
    </div>
  )
}

export function ResultCell({ position }: { position: number | null | undefined }) {
  return (
    <td className="px-0.5 py-0.5">
      <ResultChip position={position} />
    </td>
  )
}
