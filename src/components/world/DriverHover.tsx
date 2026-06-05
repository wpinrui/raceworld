'use client'

import { DriverTooltip } from '@/components/world/DriverTooltip'
import type { DriverCardResolver } from '@/components/news/LinkedText'

// Wraps a driver name/link in the hover card when the resolver has data for that id, otherwise renders
// the child untouched. Build the resolver ONCE per list (useLiveDriverCards) and pass it to each row, so
// career data is fetched once, not per name.
export function DriverHover({
  id,
  card,
  side = 'right',
  className,
  children,
}: {
  id: string
  card: DriverCardResolver
  side?: 'top' | 'right' | 'bottom' | 'left'
  // Applied to the wrapping span; pass the trigger's layout classes (truncate / flex-1 / min-w-0) so the
  // span keeps the place the bare link held in a flex row.
  className?: string
  children: React.ReactNode
}) {
  const c = card(id)
  if (!c) return <>{children}</>
  return (
    <DriverTooltip driver={c.driver} year={c.year} wdcPosition={c.wdcPosition} wdcPoints={c.wdcPoints} career={c.career} side={side}>
      <span className={className}>{children}</span>
    </DriverTooltip>
  )
}
