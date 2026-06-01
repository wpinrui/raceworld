import type { TyreCompound, TyreState } from './types'

export function computeTyreLife(
  compound: TyreCompound,
  smoothness: number,
  totalLaps: number,
): number {
  let basePercent: number

  switch (compound) {
    case 'soft':
      basePercent = 0.12 + Math.random() * 0.08 // 12-20%
      break
    case 'medium':
      basePercent = 0.20 + Math.random() * 0.15 // 20-35%
      break
    case 'hard':
      basePercent = 0.35 + Math.random() * 0.15 // 35-50%
      break
    case 'intermediate':
      basePercent = 0.20 + Math.random() * 0.15 // 20-35%
      break
    case 'wet':
      basePercent = 0.35 + Math.random() * 0.15 // 35-50%
      break
  }

  const baseLaps = Math.round(basePercent * totalLaps)
  const smoothnessMultiplier = 0.5 + smoothness / 100
  return Math.max(1, Math.round(baseLaps * smoothnessMultiplier))
}

export function degradeTyre(tyre: TyreState): number {
  return Math.max(0, Math.round(tyre.condition - 100 / tyre.maxLifeLaps))
}

export function isTyreInWindow(compound: TyreCompound, moisture: number): boolean {
  return tyreStepsOutOfWindow(compound, moisture) === 0
}

export function tyreStepsOutOfWindow(compound: TyreCompound, moisture: number): number {
  switch (compound) {
    case 'soft':
    case 'medium':
    case 'hard':
      // Dry tyres
      if (moisture < 0.10) return 0
      if (moisture < 0.35) return 1
      return 2

    case 'intermediate':
      if (moisture >= 0.10 && moisture <= 0.45) return 0
      if (moisture < 0.10) return 1
      if (moisture > 0.45 && moisture <= 0.70) return 1
      // moisture > 0.70
      return 2

    case 'wet':
      if (moisture >= 0.35 && moisture <= 0.80) return 0
      if (moisture >= 0.20 && moisture < 0.35) return 1
      if (moisture > 0.80) return 1
      // moisture < 0.20
      return 2
  }
}

export function recommendTyre(moisture: number): TyreCompound {
  if (moisture < 0.10) return 'medium'
  if (moisture <= 0.35) return 'intermediate'
  return 'wet'
}
