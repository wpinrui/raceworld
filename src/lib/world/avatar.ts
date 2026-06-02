import { createAvatar } from '@dicebear/core'
import { avataaars } from '@dicebear/collection'
import type { Driver, Gender } from '@/lib/sim/types'
import { skinToneFor } from '@/data/nationality-skin'

// Deterministic DiceBear "toon head" avatar for a driver: professional smile, team-colored
// outfit, gender-aware hair, nationality-aware skin tone. Used only as a fallback when no
// real photo / god-mode photoUrl is available. Returns an inline SVG data URI.

// Short, professional cuts for men; longer styles for women — picked deterministically by seed.
const MALE_TOPS = ['shortFlat', 'shortRound', 'shortWaved', 'theCaesar', 'theCaesarAndSidePart', 'sides', 'shortCurly'] as const
const FEMALE_TOPS = ['bob', 'bun', 'longButNotTooLong', 'straight01', 'straight02', 'curly', 'shortWaved'] as const

function hashSeed(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h)
}

function stripHash(hex: string): string {
  return hex.replace('#', '').slice(0, 6)
}

export function buildDriverAvatarUri(opts: {
  seed: string
  nationality: string
  gender: Gender
  teamColor: string
}): string {
  const h = hashSeed(opts.seed)
  const tops = opts.gender === 'female' ? FEMALE_TOPS : MALE_TOPS
  const top = tops[h % tops.length]
  return createAvatar(avataaars, {
    seed: opts.seed,
    mouth: ['smile'],
    top: [top],
    skinColor: [skinToneFor(opts.nationality)],
    clothesColor: [stripHash(opts.teamColor)],
    // Some men have facial hair; women none. Deterministic via seed inside DiceBear.
    facialHairProbability: opts.gender === 'female' ? 0 : 35,
  }).toDataUri()
}

// Resolution order for a driver portrait: god-mode override -> real photo file -> generated.
export function resolveDriverImage(
  driver: Pick<Driver, 'id' | 'nationality' | 'gender' | 'photoUrl'>,
  teamColor: string,
  realPhoto: string | undefined,
): string {
  if (driver.photoUrl) return driver.photoUrl
  if (realPhoto) return realPhoto
  return buildDriverAvatarUri({
    seed: driver.id,
    nationality: driver.nationality,
    gender: driver.gender ?? 'male',
    teamColor,
  })
}
