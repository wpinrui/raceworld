'use client'

import { useLayoutEffect, useRef } from 'react'

// Remembers the scroll position of a scrollable container across unmount/remount within a session, keyed
// by a string. Attach the returned ref to the element that actually scrolls (the page's
// `overflow-y-auto` container, or an inner scrolling list). Like useRetainedState, it lives in memory
// only — a full reload starts at the top.
const scrollStore = new Map<string, number>()

export function useScrollRestore<T extends HTMLElement = HTMLDivElement>(key: string) {
  const ref = useRef<T | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const saved = scrollStore.get(key) ?? 0
    el.scrollTop = saved
    // Re-apply after the next frame: content height may settle (async data, images) just after mount,
    // which would otherwise clamp the restore to a shorter scrollHeight.
    const raf = requestAnimationFrame(() => { if (ref.current) ref.current.scrollTop = saved })

    const onScroll = () => scrollStore.set(key, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      scrollStore.set(key, el.scrollTop)
      el.removeEventListener('scroll', onScroll)
    }
  }, [key])

  return ref
}
