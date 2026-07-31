import { describe, expect, it } from 'vitest'
import { historicalGrids } from './grids'
import { liveryFor, teamLiveries } from './liveries'

const HEX = /^#[0-9A-Fa-f]{6}$/

describe('teamLiveries', () => {
  it('covers every constructor in every season on the timeline', () => {
    const gaps: string[] = []
    for (const grid of historicalGrids) {
      for (const team of grid.teams) {
        const eras = teamLiveries[team.id]
        if (!eras?.some((e) => grid.year >= e.from && grid.year <= e.to)) {
          gaps.push(`${grid.year} ${team.id}`)
        }
      }
    }
    expect(gaps).toEqual([])
  })

  it('carries five real colours in every slot of every era', () => {
    for (const [id, eras] of Object.entries(teamLiveries)) {
      for (const era of eras) {
        expect(era.to, `${id} ${era.from}-${era.to}`).toBeGreaterThanOrEqual(era.from)
        const slots = Object.values(era.paint)
        expect(slots, `${id} ${era.from}`).toHaveLength(5)
        for (const hex of slots) expect(hex, `${id} ${era.from}`).toMatch(HEX)
      }
    }
  })

  it('never overlaps two eras for one constructor', () => {
    for (const [id, eras] of Object.entries(teamLiveries)) {
      const sorted = [...eras].sort((a, b) => a.from - b.from)
      for (let i = 0; i + 1 < sorted.length; i++) {
        expect(sorted[i].to, `${id} era ${sorted[i].from}`).toBeLessThan(sorted[i + 1].from)
      }
    }
  })

  it('has no livery for a constructor that never raced', () => {
    const onGrid = new Set(historicalGrids.flatMap((g) => g.teams.map((t) => t.id)))
    for (const id of Object.keys(teamLiveries)) expect(onGrid).toContain(id)
  })

  it('spreads the fallback colour when a team has no livery at all', () => {
    const paint = liveryFor('a-team-that-does-not-exist', 2020, '#123456')
    expect(paint.body).toBe('#123456')
    expect(paint.accent).toBe('#123456')
  })

  it('clamps to the nearest era rather than failing outside a team’s years', () => {
    // Forti raced in 1996 only; asking for 2005 still yields their palette, not nothing.
    expect(liveryFor('forti', 2005, '#000000').body).toBe(teamLiveries.forti[0].paint.body)
  })
})
