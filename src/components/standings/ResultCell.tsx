export function ResultCell({ position }: { position: number | null | undefined }) {
  // Future round — render nothing
  if (position === undefined) {
    return <td className="px-0.5 py-0.5"><div className="w-8 h-7" /></td>
  }

  if (position === null) {
    return (
      <td className="px-0.5 py-0.5">
        <div className="w-8 h-7 flex items-center justify-center rounded text-[10px] font-bold"
          style={{ backgroundColor: '#3A1A4A', color: '#C084FC' }}>
          DNF
        </div>
      </td>
    )
  }

  let bg = ''
  let fg = ''
  if (position === 1)       { bg = '#D4AC00'; fg = '#0F1419' }
  else if (position === 2)  { bg = '#9E9E9E'; fg = '#0F1419' }
  else if (position === 3)  { bg = '#C0622B'; fg = '#FFFFFF' }
  else if (position <= 10)  { bg = '#1A4A2E'; fg = '#6EE7A0' }
  else                      { bg = '#0D2A3A'; fg = '#7ECFEA' }

  return (
    <td className="px-0.5 py-0.5">
      <div className="w-8 h-7 flex items-center justify-center rounded text-[11px] font-bold"
        style={{ backgroundColor: bg, color: fg }}>
        {position}
      </div>
    </td>
  )
}
