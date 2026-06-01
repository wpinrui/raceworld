export function ContractBadge({ expiresAfter, currentYear }: { expiresAfter: number; currentYear: number }) {
  const expiring = expiresAfter === currentYear
  const expired = expiresAfter < currentYear
  if (expired) return (
    <span className="text-xs font-semibold uppercase tracking-wide bg-[#DC143C] text-white rounded px-1.5 py-0.5">
      Free Agent
    </span>
  )
  if (expiring) return (
    <span className="text-xs font-semibold uppercase tracking-wide bg-[#FCD34D] text-[#0F1419] rounded px-1.5 py-0.5">
      Expiring
    </span>
  )
  return (
    <span className="text-xs text-white tabular-nums">until {expiresAfter}</span>
  )
}
