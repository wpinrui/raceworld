'use client'

// The pit boxes and their crews (#live-engine), as their own memoised subtree.
//
// It is by far the largest thing in the race map's document: about a hundred SVG elements per garage,
// twenty teams' worth on a full grid, and roughly a third of them carrying a callback ref the rAF
// choreography drives every transform through. It is also completely static — the geometry comes off
// the pit slots and the team colours, neither of which moves during a race.
//
// Those two facts fought each other while this lived inline in RaceTrackMap. Every commit of that
// component re-created the whole tree as React elements and diffed it, and because callback refs are
// arrow functions their identity always differs, so every single one was detached and reattached on
// every commit. The map commits at least once a second on its own (the tooltip freshness tick), and
// nothing about a pit box had changed on any of those. Memoised out here it is built once and then
// skipped, and the refs stay attached to the elements the choreography is already holding.

import { memo } from 'react'
import { type Lighting, shadowFill, shadowOpacity } from '@/lib/ui/lighting'
import type { PitSlot } from '@/lib/ui/pit-zone'

/** Underside of the overhead gantry booms. Low: they clear a crew member's head and no more, so both
 *  the lift off the box floor and the shadow they throw are short. */
export const GANTRY_H_M = 2.2
/** Boom length: back to the building's front face, with a few centimetres of overlap so the join is
 *  visible rather than exact. Shared with its shadow, which has to stay exactly the same shape. */
export const GANTRY_REACH_M = 4.75

/** The element maps the render loop drives. Ref OBJECTS, so they are stable props and cannot be what
 *  invalidates the memo. */
export interface PitBoxRefs {
  /** Flipped so the garage faces away from the lane, per slot, by the layout pass. */
  inner: React.MutableRefObject<Map<number, SVGGElement>>
  /** Gantry booms, lifted off the box floor against the view bearing. */
  gantry: React.MutableRefObject<Map<number, SVGGElement>>
  /** The gantry's shadow, cast along the sun instead. */
  gantryShadow: React.MutableRefObject<Map<number, SVGGElement>>
}

export const PitBoxes = memo(function PitBoxes({ slots, u, lighting, refs }: {
  slots: PitSlot[]
  /** Metres to viewBox units. */
  u: (m: number) => number
  lighting: Lighting
  refs: PitBoxRefs
}) {
  return (
    <>
      {slots.map((s, i) => (
        <g key={`pl${i}`} transform={`translate(${s.x} ${s.y}) rotate(${(s.rot * 180) / Math.PI})`}>
          {/* Everything inside flips so the garage faces AWAY from the lane (measured per slot). */}
          <g ref={(el) => { if (el) refs.inner.current.set(i, el); else refs.inner.current.delete(i) }}>
          {/* Work pad + PIT MARKINGS (broadcast style): paired bars above and below the car
              with end/centre ticks and an exit arrow. Geometry anchor unchanged. */}
          <rect x={-u(3.2)} y={-u(1.9)} width={u(6.9)} height={u(3.8)} rx={u(0.3)} fill="#3C434F" opacity={0.45} />
          {([1, -1] as const).map((sy) => (
            <g key={sy}>
              <rect x={-u(3)} y={u(sy * 1.62) - u(0.07)} width={u(6)} height={u(0.14)} fill="#E8C33A" opacity={0.95} />
              {[-3, 0, 3].map((tx) => (
                <rect key={tx} x={u(tx) - u(0.07)} y={sy > 0 ? u(1.62) : -u(1.62) - u(0.55)} width={u(0.14)} height={u(0.55)} fill="#E8C33A" opacity={0.95} />
              ))}
            </g>
          ))}
          {/* Entry and exit arrows, long tails, both along the direction of travel. */}
          {([-4.7, 3.2] as const).map((ax) => (
            <path
              key={ax}
              d={`M ${u(ax)} 0 L ${u(ax + 1.5)} 0 M ${u(ax + 1.15)} ${-u(0.35)} L ${u(ax + 1.55)} 0 L ${u(ax + 1.15)} ${u(0.35)}`}
              fill="none" stroke="#E8C33A" strokeWidth={u(0.14)} strokeLinecap="round"
            />
          ))}
          {/* The booms sit four metres up over the box, so they throw the one shadow a pit stop
              is actually watched under. Placed by the layout pass, which is the only thing that
              knows which way this slot is flipped. */}
          <g
            ref={(el) => { if (el) refs.gantryShadow.current.set(i, el); else refs.gantryShadow.current.delete(i) }}
            fill={shadowFill(lighting)} opacity={shadowOpacity(lighting)}
          >
            {([1.5, -1.5] as const).map((bx) => (
              <rect key={bx} x={u(bx) - u(0.3)} y={-u(1.5)} width={u(0.6)} height={u(GANTRY_REACH_M)} rx={u(0.12)} />
            ))}
          </g>
          {/* Overhead gantry: two booms from the garage out over the box â€” black, team accents. */}
          <g ref={(el) => { if (el) refs.gantry.current.set(i, el); else refs.gantry.current.delete(i) }}>
          {([1.5, -1.5] as const).map((bx) => (
            <g key={bx}>
              {/* A metal beam seen from above: its length is the only thing that reads at this
                  scale, so it carries a highlight down one flank rather than a face â€” a face
                  would need the light direction, which the box only learns once it knows which
                  way it is flipped. Height comes from the lift and the shadow, not from paint. */}
              <rect x={u(bx) - u(0.3)} y={-u(1.5)} width={u(0.6)} height={u(GANTRY_REACH_M)} rx={u(0.12)} fill="#2E333C" />
              <rect x={u(bx) - u(0.3)} y={-u(1.5)} width={u(0.2)} height={u(GANTRY_REACH_M)} rx={u(0.08)} fill="#4C5460" />
            </g>
          ))}
          </g>
          {/* The crew itself lives in the GL scene now (#3d-port, lib/scene3d/crew3d.ts): the same
              choreography drives capsule people and real tyre props through the same slot-local
              metres these groups used to take. */}
          </g>
        </g>
      ))}
    </>
  )
})
