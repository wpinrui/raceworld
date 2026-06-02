'use client'

import { useMemo, useState } from 'react'
import type { Driver } from '@/lib/sim/types'
import { buildDriverAvatarUri } from '@/lib/world/avatar'
import { realPhotoFor } from '@/data/driver-photos'

// Driver portrait. Resolution order: god-mode photoUrl -> real photo file -> generated
// DiceBear avatar. If a real photo / override fails to load (e.g. file not present yet),
// it falls back to the generated avatar so the UI never shows a broken image.
export function DriverAvatar({
  driver,
  teamColor,
  size = 96,
  className = '',
}: {
  driver: Pick<Driver, 'id' | 'name' | 'nationality' | 'gender' | 'photoUrl'>
  teamColor: string
  size?: number
  className?: string
}) {
  const generated = useMemo(
    () => buildDriverAvatarUri({
      seed: driver.id,
      nationality: driver.nationality,
      gender: driver.gender ?? 'male',
      teamColor,
    }),
    [driver.id, driver.nationality, driver.gender, teamColor],
  )

  const preferred = driver.photoUrl || realPhotoFor(driver.id) || generated
  const [src, setSrc] = useState(preferred)
  // Reset when the preferred source changes (e.g. god-mode edit / different driver).
  const [seenPreferred, setSeenPreferred] = useState(preferred)
  if (preferred !== seenPreferred) {
    setSeenPreferred(preferred)
    setSrc(preferred)
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={driver.name}
      width={size}
      height={size}
      onError={() => { if (src !== generated) setSrc(generated) }}
      className={`shrink-0 rounded-xl object-cover bg-[#2A3142] ${className}`}
      style={{ width: size, height: size, borderColor: teamColor }}
    />
  )
}
