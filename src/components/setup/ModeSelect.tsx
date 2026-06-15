'use client'

import { SlidersHorizontal, Users, User } from 'lucide-react'

// The standalone first screen of a new game: pick how you play. Each choice routes to its own setup flow
// (Sandbox = the grid editor; Team Manager = run a team; Driver = race as one driver). These are game
// modes, not config toggles, so they live on their own screen.

export type GameMode = 'sandbox' | 'team-manager' | 'driver'

const MODES: { id: GameMode; name: string; desc: string; Icon: typeof Users }[] = [
  { id: 'sandbox', name: 'Sandbox', desc: 'Edit the full grid, then race.', Icon: SlidersHorizontal },
  { id: 'team-manager', name: 'Team Manager', desc: 'Run a single team.', Icon: Users },
  { id: 'driver', name: 'Driver', desc: 'Race as a single driver.', Icon: User },
]

export function ModeSelect({ onSelect }: { onSelect: (mode: GameMode) => void }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-12">
      <div className="flex items-center gap-2.5 mb-8">
        <div className="w-1 h-6 rounded-sm bg-[#DC143C]" />
        <h1 className="font-display text-2xl tracking-wider uppercase text-[#FFFFFF]">New Career</h1>
      </div>
      <div className="grid gap-4 sm:grid-cols-3 w-full max-w-3xl">
        {MODES.map(({ id, name, desc, Icon }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className="rounded-xl bg-[#1E2431] border border-[#2A3142] hover:border-[#00D9FF] p-6 text-left transition-colors flex flex-col gap-3"
          >
            <Icon size={28} className="text-[#00D9FF]" />
            <h2 className="font-display text-lg tracking-wide uppercase text-[#FFFFFF]">{name}</h2>
            <p className="text-sm text-[#FFFFFF]">{desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
