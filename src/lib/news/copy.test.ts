import { describe, it, expect } from 'vitest'
import { paras, poss, wxHeadlineBucket, texture } from './copy'
import type { RaceWeather } from '@/lib/sim/types'

describe('paras', () => {
  it('joins non-empty parts with blank lines and drops empties', () => {
    expect(paras('a', '', 'b')).toBe('a\n\nb')
    expect(paras('', '')).toBe('')
  })
})

describe('poss', () => {
  it('uses a bare apostrophe after a trailing s', () => {
    expect(poss('Mercedes')).toBe("Mercedes'")
    expect(poss('Williams')).toBe("Williams'")
  })
  it("uses 's otherwise", () => {
    expect(poss('Ferrari')).toBe("Ferrari's")
  })
})

describe('wxHeadlineBucket', () => {
  const wx = (shape: string, peakMoisture: number) => ({ shape, peakMoisture } as unknown as RaceWeather)
  it('reads a drying day as drying regardless of peak', () => {
    expect(wxHeadlineBucket(wx('drying', 0.9))).toBe('drying')
  })
  it('escalates by peak moisture otherwise', () => {
    expect(wxHeadlineBucket(wx('wet', 0.8))).toBe('heavy')
    expect(wxHeadlineBucket(wx('wet', 0.5))).toBe('wet')
    expect(wxHeadlineBucket(wx('wet', 0.2))).toBe('damp')
  })
})

describe('texture', () => {
  it('returns empty for an empty pool', () => {
    expect(texture('seed', [], {}, 100)).toBe('')
  })
  it('is gated by the chance roll: pct 0 suppresses, pct 100 emits the (only) line', () => {
    expect(texture('seed', ['calm in the paddock'], {}, 0)).toBe('')
    expect(texture('seed', ['calm in the paddock'], {}, 100)).toBe('calm in the paddock')
  })
})
