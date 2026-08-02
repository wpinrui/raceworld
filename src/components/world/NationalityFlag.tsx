'use client'

import ReactCountryFlag from 'react-country-flag'
import { Globe } from 'lucide-react'

// A nationality flag with a graceful "rest of the world" fallback: a valid ISO 3166-1 alpha-2 code
// renders the country flag; anything missing/unknown renders a neutral globe (NOT a default country).
// Where `react-country-flag` fetches its artwork. Exported so SVG-native callers can draw the SAME
// flag: inside an <svg>, an HTML <img> needs a <foreignObject> and will not skew into a plane, so the
// race map uses <image href> instead. Returns null for anything that is not an ISO alpha-2 code,
// which is the caller's cue to fall back rather than render a wrong country.
const FLAG_CDN = 'https://cdn.jsdelivr.net/gh/lipis/flag-icons/flags/4x3/'

export function flagSvgUrl(code?: string | null): string | null {
  const c = (code ?? '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(c) ? `${FLAG_CDN}${c.toLowerCase()}.svg` : null
}

export function NationalityFlag({ code, size = '1.1em' }: { code?: string | null; size?: string }) {
  const c = (code ?? '').trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(c)) {
    return <ReactCountryFlag countryCode={c} svg style={{ width: size, height: size, borderRadius: '2px', flexShrink: 0 }} title={c} aria-label={c} />
  }
  return <Globe aria-label="Rest of the world" className="shrink-0 text-[#6B7280]" style={{ width: size, height: size }} />
}
