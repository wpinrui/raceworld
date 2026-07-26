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
import { CAR_SCALE } from '@/lib/ui/car-sprite'
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
  /** Each crew's root, shown from the pit call and hidden again after the retreat. */
  crew: React.MutableRefObject<Map<number, SVGGElement>>
  /** `slot:role` -> the member or prop the choreography moves. */
  parts: React.MutableRefObject<Map<string, SVGGElement>>
}

export const PitBoxes = memo(function PitBoxes({ slots, u, colors, lighting, refs }: {
  slots: PitSlot[]
  /** Metres to viewBox units. */
  u: (m: number) => number
  /** Team colour per garage index. */
  colors: string[]
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
          {/* Crew: static parts registered by role; the rAF choreography drives every
              transform (deploy from the garage, jacks on stop, tyre swaps, retreat). */}
          <g
            ref={(el) => { if (el) refs.crew.current.set(i, el); else refs.crew.current.delete(i) }}
            style={{ visibility: 'hidden' }}
          >
            {(['jack0', 'jack1'] as const).map((role, ji) => (
              <g key={role} ref={(el) => { if (el) refs.parts.current.set(`${i}:${role}`, el); else refs.parts.current.delete(`${i}:${role}`) }}>
                <rect x={0} y={-u(0.1)} width={u(0.85) * (ji === 0 ? 1 : -1)} height={u(0.2)} rx={u(0.08)} fill="#8B929E" />
                <circle r={u(0.38)} fill={colors[i] ?? '#9AA3B2'} stroke="#FFFFFF" strokeWidth={u(0.09)} />
              </g>
            ))}
            {[0, 1, 2, 3].map((c) => (
              <g key={`corner${c}`}>
                <g ref={(el) => { if (el) refs.parts.current.set(`${i}:gun${c}`, el); else refs.parts.current.delete(`${i}:gun${c}`) }}>
                  <rect x={-u(0.09)} y={-u(0.5)} width={u(0.18)} height={u(0.34)} rx={u(0.05)} fill="#5E6673" />
                  <circle r={u(0.36)} fill={colors[i] ?? '#9AA3B2'} stroke="#FFFFFF" strokeWidth={u(0.09)} />
                </g>
                <g ref={(el) => { if (el) refs.parts.current.set(`${i}:handA${c}`, el); else refs.parts.current.delete(`${i}:handA${c}`) }}>
                  <circle r={u(0.34)} fill={colors[i] ?? '#9AA3B2'} stroke="#FFFFFF" strokeWidth={u(0.08)} />
                </g>
                <g ref={(el) => { if (el) refs.parts.current.set(`${i}:handB${c}`, el); else refs.parts.current.delete(`${i}:handB${c}`) }}>
                  <circle r={u(0.34)} fill={colors[i] ?? '#9AA3B2'} stroke="#FFFFFF" strokeWidth={u(0.08)} />
                </g>
                {(['oldT', 'newT'] as const).map((tk) => {
                  // Pixel-matched to the car sprite's wheels (long axis = travel = local x).
                  // The sprite's REAR wheels are larger than the fronts: 96x52 vs 88x48
                  // sprite-units at scale 5.63/520 â€” a single prop size shrank the rears
                  // visibly at the swap. Corners 0/2 are the front axle, 1/3 the rear.
                  const front = c === 0 || c === 2
                  const tw = (front ? 0.9528 : 1.0394) * CAR_SCALE
                  const th = (front ? 0.5197 : 0.563) * CAR_SCALE
                  const rw = (front ? 0.563 : 0.6063) * CAR_SCALE
                  const rh = (front ? 0.3032 : 0.3248) * CAR_SCALE
                  const outer = c <= 1 ? 1 : -1 // garage corners face out +y, lane corners -y
                  return (
                    <g key={tk} ref={(el) => { if (el) refs.parts.current.set(`${i}:${tk}${c}`, el); else refs.parts.current.delete(`${i}:${tk}${c}`) }} style={{ visibility: 'hidden' }}>
                      <rect x={-u(tw / 2)} y={-u(th / 2)} width={u(tw)} height={u(th)} rx={u((front ? 0.195 : 0.206) * CAR_SCALE)} fill="#16181D" />
                      <rect x={-u(rw / 2)} y={-u(rh / 2)} width={u(rw)} height={u(rh)} rx={u(0.12)} fill="#2E3138" />
                      <rect
                        ref={(el) => { if (el) refs.parts.current.set(`${i}:${tk}line${c}`, el as unknown as SVGGElement); else refs.parts.current.delete(`${i}:${tk}line${c}`) }}
                        x={-u(rw * 0.3)} y={outer > 0 ? u(th / 2) - u(0.065) : -u(th / 2)} width={u(rw * 0.6)} height={u(0.065)} rx={u(0.03)} fill="#FFD700"
                      />
                    </g>
                  )
                })}
              </g>
            ))}
            <g ref={(el) => { if (el) refs.parts.current.set(`${i}:lolli`, el); else refs.parts.current.delete(`${i}:lolli`) }}>
              <rect x={-u(0.055)} y={-u(1.05)} width={u(0.11)} height={u(1.05)} fill="#8B929E" />
              <circle cy={-u(1.2)} r={u(0.27)} fill="#E8C33A" />
              <circle r={u(0.38)} fill={colors[i] ?? '#9AA3B2'} stroke="#FFFFFF" strokeWidth={u(0.09)} />
            </g>
          </g>
          </g>
        </g>
      ))}
    </>
  )
})
