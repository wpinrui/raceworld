'use client'

import { useSyncExternalStore } from 'react'

// Always-stable subscribe: the "store" never changes, so we never need to re-notify.
const noopSubscribe = () => () => {}

// True once the component has hydrated in the browser; false on the server and during the very first
// client render (so the two match and React doesn't flag a hydration mismatch). Use it to gate
// client-only content that would otherwise differ between server and client:
//
//   const hydrated = useHydrated()
//   if (!hydrated) return null
//
// This replaces the older `useState(false)` + `useEffect(() => setHydrated(true), [])` pattern, which
// fired an extra render and tripped react-hooks/set-state-in-effect. useSyncExternalStore flips the
// value during the hydration commit instead, with no effect and no synchronous setState.
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true, // client: hydrated
    () => false, // server / first paint: not yet hydrated
  )
}
