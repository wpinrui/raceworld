// A labelled stat for the home dashboard cards (tiny uppercase label over a large value). Shared by the
// Team Manager and Driver home strips so the two read identically.
export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-[#FFFFFF]">{value}</span>
    </div>
  )
}
