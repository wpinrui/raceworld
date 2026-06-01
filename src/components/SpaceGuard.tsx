'use client'

import { useEffect } from 'react'

// Prevent the browser from using spacebar to activate focused buttons/links.
// Space is a reserved game key (play/pause) and the browser's built-in
// focus-activation model interferes with it.
export function SpaceGuard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      const tag = (e.target as HTMLElement).tagName
      const isTextInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if (!isTextInput) e.preventDefault()
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [])

  return null
}
