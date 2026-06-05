'use client'

import { useCallback, useRef, useState } from 'react'

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

  // If the key changes while the component stays mounted (e.g. navigating between two driver pages that
  // share the same route component), swap to the new key's retained value. Setting state during render
  // is the React-sanctioned way to adjust state when an input changes; it's guarded, so it can't loop.
  const keyRef = useRef(key)
  if (keyRef.current !== key) {
    keyRef.current = key
    setValue(store.has(key) ? (store.get(key) as T) : initial)
  }

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      store.set(keyRef.current, resolved)
      return resolved
    })
  }, [])

  return [value, set]
}

// Drop everything retained (called when the player abandons a save / starts a new game, so a stale
// newsroom selection or tab from the previous world doesn't bleed into the next one).
export function clearRetainedState(): void {
  store.clear()
}
