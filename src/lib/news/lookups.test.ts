import { describe, it, expect } from 'vitest'
import { teamName, circuit, paceRank, tierWord } from './lookups'
import type { NewsContext } from './engine'

function ctxOf(parts: Record<string, unknown>): NewsContext {
  return { teams: [], calendar: [], ...parts } as unknown as NewsContext
}

describe('teamName', () => {
  const ctx = ctxOf({ teams: [{ id: 't1', name: 'Ferrari' }] })
  it('resolves a team name', () => expect(teamName(ctx, 't1')).toBe('Ferrari'))
  it('falls back to the id when unknown', () => expect(teamName(ctx, 'tX')).toBe('tX'))
})

describe('circuit', () => {
  const ctx = ctxOf({ calendar: [{ name: 'British GP' }] })
  it('expands GP to Grand Prix', () => expect(circuit(ctx, 1)).toBe('British Grand Prix'))
  it('falls back to "Round N" when the round is missing', () => expect(circuit(ctx, 5)).toBe('Round 5'))
})

describe('paceRank', () => {
  const ctx = ctxOf({
    teams: [{ id: 'slow', carPace: 60 }, { id: 'fast', carPace: 90 }, { id: 'mid', carPace: 75 }],
  })
  it('ranks 1 = fastest car', () => {
    expect(paceRank(ctx, 'fast')).toBe(1)
    expect(paceRank(ctx, 'mid')).toBe(2)
    expect(paceRank(ctx, 'slow')).toBe(3)
  })
})

describe('tierWord', () => {
  it('classifies front / midfield / backmarker by rank within the grid', () => {
    expect(tierWord(1, 20)).toBe('front-running')
    expect(tierWord(10, 20)).toBe('midfield')
    expect(tierWord(20, 20)).toBe('backmarker')
  })
})
