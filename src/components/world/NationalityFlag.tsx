'use client'

import ReactCountryFlag from 'react-country-flag'
import { Globe } from 'lucide-react'

// A nationality flag with a graceful "rest of the world" fallback: a valid ISO 3166-1 alpha-2 code
// renders the country flag; anything missing/unknown renders a neutral globe (NOT a default country).
export function NationalityFlag({ code, size = '1.1em' }: { code?: string | null; size?: string }) {
  const c = (code ?? '').trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(c)) {
    return <ReactCountryFlag countryCode={c} svg style={{ width: size, height: size, borderRadius: '2px', flexShrink: 0 }} title={c} aria-label={c} />
  }
  return <Globe aria-label="Rest of the world" className="shrink-0 text-[#6B7280]" style={{ width: size, height: size }} />
}
