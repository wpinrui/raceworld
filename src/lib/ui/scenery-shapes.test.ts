// #sim-2d — building form. `pickArchetype` fixes a specific visual defect: articulated footprints
// coming out as slivers a few metres wide, which made clusters read as debris rather than
// architecture.

import { describe, it, expect } from 'vitest'
import { buildingParts, pickArchetype, blobPath, smoothClosed } from './scenery-shapes'

describe('buildingParts', () => {
  it('keeps every part inside the overall footprint, for all ten archetypes', () => {
    const w = 40
    const h = 30
    for (let type = 0; type < 10; type++) {
      for (const p of buildingParts(type, w, h)) {
        expect(Math.abs(p.dx) + p.w / 2).toBeLessThanOrEqual(w / 2 + 1e-9)
        expect(Math.abs(p.dy) + p.h / 2).toBeLessThanOrEqual(h / 2 + 1e-9)
        expect(p.w).toBeGreaterThan(0)
        expect(p.h).toBeGreaterThan(0)
      }
    }
  })

  it('wraps the type so any integer is a valid archetype', () => {
    expect(buildingParts(10, 10, 10)).toEqual(buildingParts(0, 10, 10))
    expect(buildingParts(23, 10, 10)).toEqual(buildingParts(3, 10, 10))
  })
})

describe('pickArchetype', () => {
  // At 1 metre per unit, a 12-unit building's thinnest wing would be 12 * 0.28 = 3.4 m.
  it('falls back to a solid archetype when the wings would be slivers', () => {
    for (const roll of [0, 0.25, 0.49, 0.5, 0.75, 0.99]) {
      const type = pickArchetype(12, 12, 8, 1, roll)
      expect([0, 8]).toContain(type)
      // And the chosen archetype really is solid, not a thin-limbed one.
      const parts = buildingParts(type, 12, 12)
      expect(Math.max(...parts.map((p) => p.w))).toBeGreaterThanOrEqual(12)
    }
  })

  it('allows the full archetype set once the building is big enough', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 100; i++) seen.add(pickArchetype(80, 60, 8, 1, i / 100))
    expect(seen.size).toBeGreaterThan(5)
  })

  it('scales the threshold through metresPerUnit, not raw units', () => {
    // The same 12-unit footprint is 3.4 m of wing at 1 m/unit but 17 m at 5 m/unit.
    expect([0, 8]).toContain(pickArchetype(12, 12, 8, 1, 0.9))
    expect(pickArchetype(12, 12, 8, 5, 0.9)).toBe(9)
  })
})

describe('blobPath / smoothClosed', () => {
  const rng = () => 0.5 // fixed jitter -> a predictable lobe factor

  it('emits a closed path with finite coordinates', () => {
    const d = blobPath(100, 100, 20, 10, 0.4, rng, 8, 0.8, 0.35)
    expect(d.startsWith('M ')).toBe(true)
    expect(d.trimEnd().endsWith('Z')).toBe(true)
    expect(/NaN|Infinity/.test(d)).toBe(false)
  })

  it('stays within the jittered radius bound the exclusion capsules assume', () => {
    // Lake and run-off keep-outs size themselves as radius * (jBase + jSpan); the drawn blob must
    // not exceed that, or props would be sited on water.
    const jBase = 0.8
    const jSpan = 0.35
    const d = blobPath(0, 0, 30, 30, 0, () => 1, 10, jBase, jSpan) // rng()=1 -> worst-case lobe
    const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
    // smoothClosed writes coordinates at one decimal place, so allow the half-step each axis can
    // gain to rounding — a few centimetres at any real metresPerUnit.
    const bound = 30 * (jBase + jSpan) + Math.hypot(0.05, 0.05)
    for (let i = 0; i + 1 < n.length; i += 2) {
      expect(Math.hypot(n[i], n[i + 1])).toBeLessThanOrEqual(bound)
    }
  })

  it('smoothClosed round-trips a triangle into a closed path', () => {
    const d = smoothClosed([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }])
    expect(d.startsWith('M ')).toBe(true)
    expect(d.trimEnd().endsWith('Z')).toBe(true)
  })
})
