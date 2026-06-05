'use client'

import { useCallback, useState } from 'react'

// In-session retained UI state. Behaves like useState, but the value is kept in a module-level store
// keyed by a string, so it SURVIVES the component unmounting and remounting while the player browses
// (e.g. leaving a page and coming back). It is deliberately NOT persisted to disk: a full page reload
// starts fresh. Use it for tabs, filters, selections, accordion open-state — anything that should stay
// where the player left it within a session, not be saved to a profile.
//
// Pair it with useScrollRestore for scroll position. Together they make navigation non-destructive: go
// read a driver page from a news article, come back, and the feed is exactly where you left it.
const store = new Map<string, unknown>()

export function useRetainedState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial))

  // When the key changes while the component stays mounted (e.g. navigating between two driver pages
  // that share the route component), swap to the new key's retained value. Tracking the previous key in
  // STATE and adjusting during render is the React-sanctioned pattern for this; it's guarded, so it
  // cannot loop.
  const [prevKey, setPrevKey] = useState(key)
  if (key !== prevKey) {
    setPrevKey(key)
    setValue(store.has(key) ? (store.get(key) as T) : initial)
  }

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      store.set(key, resolved)
      return resolved
    })
  }, [key])

  return [value, set]
}

// Drop everything retained (called when the player abandons a save / starts a new game, so a stale
// newsroom selection or tab from the previous world doesn't bleed into the next one).
export function clearRetainedState(): void {
  store.clear()
}
