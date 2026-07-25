'use client'

import { memo } from 'react'
import { COMPOUND_COLORS } from './TyreIndicator'
import { shade } from '@/lib/color'
import type { TyreCompound } from '@/lib/sim/types'
import {
  LEVEL, SPRITE, bodyTransform, shadowTransform, sheenTransform, type Attitude, type CarLight,
} from '@/lib/ui/car-sprite'

// The user-authored top-down F1 sprite (designs/F1 car.dc.html): three livery roles over fixed
// neutrals. PRIMARY = nose/chassis/sidepods/mid wing flaps, SECONDARY = wing planes/stripe/blades/
// helmet, TERTIARY = floor/endplates/halo/beam wing/fin. Memoised: ~90 elements per car, and only the
// livery/scale ever change.
//
// Three groups inside it move every frame, written straight to their transform attributes by the map's
// rAF loop (#sim-2d):
//   [data-car-shadow] the contact shadow, displaced along the world light and OUTSIDE the body group
//     so the body slides over a shadow that stays with the tyres;
//   [data-car-body]   everything drawn, carrying roll and brake dive;
//   [data-car-sheen]  the world-locked highlight, counter-rotated against the sprite's heading.
// `spriteRot` seeds all three at render time, which is what a still (the preview script, a test) sees;
// live, the loop overwrites them from the next frame on.

// Shared by the visible bodywork and by the clip the sheen is painted through, so the highlight can
// never drift off the shape it is meant to be lying on.
const NOSE_D = 'M120 8 C112 8 108 24 106 48 L102 110 Q100 142 95 166 L145 166 Q140 142 138 110 L134 48 C132 24 128 8 120 8 Z'
const CHASSIS_D = 'M95 166 L145 166 L146 202 C154 204 161 205 168 206 C179 208 190 214 190 224 L188 290 C186 316 170 332 156 342 C150 350 148 356 148 366 L148 448 L92 448 L92 366 C92 356 90 350 84 342 C70 332 54 316 52 290 L50 224 C50 214 61 208 72 206 C79 205 86 204 94 202 Z'
// The parts of the car that are nearly ON the tarmac: the same bodywork, plus the four tyres. One path
// of subpaths rather than a shape each, because this layer redraws every frame for twenty cars.
const FOOTPRINT_D = `${NOSE_D} ${CHASSIS_D} M6 64h48v88h-48Z M186 64h48v88h-48Z M4 350h52v96h-52Z M184 350h52v96h-52Z`

export const CarSprite = memo(function CarSprite({ id, color, length, compound, light, spriteRot = 0, attitude = LEVEL }: {
  /** Only used to key this sprite's own gradients and clip; ids are document-wide. */
  id: string
  color: string
  length: number
  compound?: TyreCompound
  light: CarLight
  spriteRot?: number
  attitude?: Attitude
}) {
  const band = compound ? COMPOUND_COLORS[compound] : null
  const p = color
  const sec = shade(color, 0.62)
  const t = '#969CA6'
  const key = id.replace(/[^A-Za-z0-9_-]/g, '') || 'car'
  const shId = `car-sh-${key}`
  const sheenId = `car-sheen-${key}`
  const clipId = `car-body-${key}`
  return (
    <svg width={length * SPRITE.aspect} height={length} viewBox={SPRITE.viewBox} className="block" style={{ overflow: 'visible' }}>
      <defs>
        {/* Soft edges out of stops rather than a blur: this layer is the only one that genuinely
            redraws every frame, and it carries 20 cars. */}
        <radialGradient id={shId}>
          <stop offset="0" stopColor={light.shadow.fill} stopOpacity="0.55" />
          <stop offset="0.5" stopColor={light.shadow.fill} stopOpacity="0.44" />
          <stop offset="1" stopColor={light.shadow.fill} stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={sheenId}
          gradientUnits="userSpaceOnUse"
          x1={light.sheen.x1} y1={light.sheen.y1} x2={light.sheen.x2} y2={light.sheen.y2}
        >
          {light.sheen.stops.map((s, i) => (
            <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
          ))}
        </linearGradient>
        <clipPath id={clipId}>
          <path d={`${NOSE_D} ${CHASSIS_D}`} />
        </clipPath>
      </defs>
      {/* Contact shadow. Inside the sprite's own svg (which does not clip), so it scales with the car
          and costs no extra positioning: the price is that it cannot fall across a NEIGHBOURING car,
          only its own. At this offset and opacity, in a side-by-side battle, that is not visible. */}
      <g data-car-shadow transform={shadowTransform(light, spriteRot)} opacity={light.shadow.opacity}>
        {/* Soft bloom for the body, which is held off the ground, then the crisp footprint of the parts
            that very nearly touch it. Sharp under the tyres and soft further out is what a real contact
            shadow does, and it is what stops the car reading as one slab hovering over the road. */}
        <ellipse cx={SPRITE.cx} cy={SPRITE.cy} rx="110" ry="240" fill={`url(#${shId})`} />
        <path d={FOOTPRINT_D} fill={light.shadow.fill} fillOpacity="0.7" />
      </g>
      <g data-car-body transform={bodyTransform(attitude)}>
      {/* floor, visible through coke bottle */}
      <path d="M60 190 L120 164 L180 190 L180 450 Q180 460 170 460 L70 460 Q60 460 60 450 Z" fill="#14171E" />
      {/* front suspension: upper + lower wishbone + pushrod */}
      <path d="M52 84 L106 104 L106 110 L52 92 Z" fill="#2E3138" />
      <path d="M188 84 L134 104 L134 110 L188 92 Z" fill="#2E3138" />
      <path d="M52 126 L106 126 L106 131 L52 132 Z" fill="#2E3138" />
      <path d="M188 126 L134 126 L134 131 L188 132 Z" fill="#2E3138" />
      <path d="M54 106 L104 118 L104 122 L54 110 Z" fill="#43474F" />
      <path d="M186 106 L136 118 L136 122 L186 110 Z" fill="#43474F" />
      {/* rear suspension: 3 elements */}
      <path d="M56 374 L100 380 L100 385 L56 380 Z" fill="#2E3138" />
      <path d="M184 374 L140 380 L140 385 L184 380 Z" fill="#2E3138" />
      <path d="M56 397 L100 397 L100 404 L56 404 Z" fill="#43474F" />
      <path d="M184 397 L140 397 L140 404 L184 404 Z" fill="#43474F" />
      <path d="M56 424 L100 420 L100 425 L56 430 Z" fill="#2E3138" />
      <path d="M184 424 L140 420 L140 425 L184 430 Z" fill="#2E3138" />
      {/* front wing: swept elements, angular endplates */}
      <rect x="62" y="44" width="3" height="10" fill={p} />
      <rect x="88" y="44" width="3" height="10" fill={p} />
      <rect x="149" y="44" width="3" height="10" fill={p} />
      <rect x="175" y="44" width="3" height="10" fill={p} />
      <path d="M30 42 Q120 30 210 42 L210 51 Q120 41 30 51 Z" fill={sec} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <path d="M36 31 Q120 19 204 31 L204 40 Q120 29 36 40 Z" fill={p} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <path d="M44 21 Q120 11 196 21 L196 29 Q120 19 44 29 Z" fill={sec} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <path d="M56 13 Q120 5 184 13 L184 19 Q120 11 56 19 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />
      <path d="M28 12 L40 9 L32 52 L20 50 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      <path d="M212 12 L200 9 L208 52 L220 50 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      {/* nose */}
      <path d={NOSE_D} fill={p} stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
      <path d="M120 12 C115 12 113 26 112 48 L109 118 L131 118 L128 48 C127 26 125 12 120 12 Z" fill={sec} />
      <path d="M94 174 Q74 218 58 218 L58 213 Q77 213 90 172 Z" fill={p} stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
      <path d="M146 174 Q166 218 182 218 L182 213 Q163 213 150 172 Z" fill={p} stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
      {/* chassis + sidepods, coke bottle */}
      <path d={CHASSIS_D} fill={p} stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
      {/* sidepod inlets */}
      <path d="M56 218 L94 212 L92 228 L54 234 Z" fill="#0B0D10" />
      <path d="M184 218 L146 212 L148 228 L186 234 Z" fill="#0B0D10" />
      {/* sidepod edge blades */}
      <path d="M52 224 C52 214 61 209 72 207 L94 203 L95 210 L74 214 C63 215 58 219 58 226 L60 288 C62 310 78 328 89 338 L84 344 C68 332 54 316 52 290 Z" fill={sec} />
      <path d="M188 224 C188 214 179 209 168 207 L146 203 L145 210 L166 214 C177 215 182 219 182 226 L180 288 C178 310 162 328 151 338 L156 344 C172 332 186 316 188 290 Z" fill={sec} />
      <path d="M62 246 L82 242 L82 245 L62 249 Z" fill="rgba(0,0,0,0.2)" />
      <path d="M63 258 L83 254 L83 257 L63 261 Z" fill="rgba(0,0,0,0.2)" />
      <path d="M64 270 L84 266 L84 269 L64 273 Z" fill="rgba(0,0,0,0.2)" />
      <path d="M178 246 L158 242 L158 245 L178 249 Z" fill="rgba(0,0,0,0.2)" />
      <path d="M177 258 L157 254 L157 257 L177 261 Z" fill="rgba(0,0,0,0.2)" />
      <path d="M176 270 L156 266 L156 269 L176 273 Z" fill="rgba(0,0,0,0.2)" />
      {/* engine cover spine + fin */}
      <path d="M113 262 L127 262 L124 446 L116 446 Z" fill={sec} />
      <rect x="117" y="352" width="6" height="94" fill={t} />
      {/* mirrors */}
      <rect x="90" y="202" width="11" height="6" rx="2" fill={t} />
      <rect x="139" y="202" width="11" height="6" rx="2" fill={t} />
      {/* cockpit + halo + helmet */}
      <rect x="104" y="194" width="32" height="60" rx="14" fill="#0B0D10" />
      <path d="M105 210 C105 190 135 190 135 210" fill="none" stroke={t} strokeWidth="5" strokeLinecap="round" />
      <rect x="118" y="190" width="4" height="16" fill={t} />
      <circle cx="120" cy="234" r="10" fill={sec} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      <rect x="113" y="228" width="14" height="3" rx="1.5" fill="#0B0D10" />
      {/* tyres: tagged so the pit choreography can take each wheel OFF the car while its tyre
          is being carried (#live-engine) */}
      <g data-wheel="fl">
        <rect x="6" y="64" width="48" height="88" rx="18" fill="#16181D" />
        <rect x="16" y="82" width="28" height="52" rx="11" fill="#2E3138" />
      </g>
      <g data-wheel="fr">
        <rect x="186" y="64" width="48" height="88" rx="18" fill="#16181D" />
        <rect x="196" y="82" width="28" height="52" rx="11" fill="#2E3138" />
      </g>
      <g data-wheel="rl">
        <rect x="4" y="350" width="52" height="96" rx="19" fill="#16181D" />
        <rect x="15" y="370" width="30" height="56" rx="12" fill="#2E3138" />
      </g>
      <g data-wheel="rr">
        <rect x="184" y="350" width="52" height="96" rx="19" fill="#16181D" />
        <rect x="195" y="370" width="30" height="56" rx="12" fill="#2E3138" />
      </g>
      {/* Compound band: a thin line on each tyre's OUTER edge, spanning ~the rim diameter. */}
      {band && (
        <g>
          <rect x="6" y="92" width="3" height="32" rx="1.5" fill={band} />
          <rect x="231" y="92" width="3" height="32" rx="1.5" fill={band} />
          <rect x="4" y="381" width="3" height="34" rx="1.5" fill={band} />
          <rect x="233" y="381" width="3" height="34" rx="1.5" fill={band} />
        </g>
      )}
      {/* diffuser */}
      <path d="M84 448 L156 448 L164 468 L76 468 Z" fill="#0B0D10" />
      <rect x="96" y="450" width="3" height="16" fill="#2E3138" />
      <rect x="110" y="450" width="3" height="17" fill="#2E3138" />
      <rect x="127" y="450" width="3" height="17" fill="#2E3138" />
      <rect x="141" y="450" width="3" height="16" fill="#2E3138" />
      {/* rear wing: pylon + beam wing attach it to the body */}
      <rect x="66" y="476" width="3" height="12" fill={p} />
      <rect x="92" y="478" width="3" height="12" fill={p} />
      <rect x="145" y="478" width="3" height="12" fill={p} />
      <rect x="171" y="476" width="3" height="12" fill={p} />
      <rect x="116" y="412" width="8" height="36" fill="#2E3138" />
      <path d="M44 446 Q120 436 196 446 L196 453 Q120 444 44 453 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      <path d="M44 453 Q120 445 196 453 L196 464 Q120 456 44 464 Z" fill={p} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <path d="M42 466 Q120 458 198 466 L198 481 Q120 473 42 481 Z" fill={sec} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <rect x="113" y="448" width="14" height="9" rx="2" fill="#0B0D10" />
      <path d="M30 420 L42 415 L44 490 L32 487 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      <path d="M210 420 L198 415 L196 490 L208 487 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      {/* shading */}
      <path d="M95 166 L94 202 C86 204 79 205 72 206 C61 208 50 214 50 224 L52 290 C54 316 70 332 84 342 C90 350 92 356 92 366 L92 448 L100 448 L100 366 C100 354 96 346 89 338 C76 327 62 311 60 288 L58 226 C58 218 63 214 72 212 L98 208 L104 166 Z" fill="rgba(255,255,255,0.16)" />
      <path d="M145 166 L146 202 C154 204 161 205 168 206 C179 208 190 214 190 224 L188 290 C186 316 170 332 156 342 C150 350 148 356 148 366 L148 448 L140 448 L140 366 C140 354 144 346 151 338 C164 327 178 311 180 288 L182 226 C182 218 177 214 168 212 L142 208 L138 166 Z" fill="rgba(0,0,0,0.14)" />
      <path d="M120 8 C112 8 108 24 106 48 L102 110 Q100 142 95 166 L102 166 Q106 142 108 110 L111 48 C112 30 114 16 118 10 Z" fill="rgba(255,255,255,0.16)" />
      {/* The world-locked sheen, over the artwork's own fixed shading (which describes the shape) and
          clipped to the bodywork, so wings and tyres keep their flat neutrals. Counter-rotated, so it
          slides round the body as the car corners instead of turning with it. */}
      <g clipPath={`url(#${clipId})`}>
        <g data-car-sheen transform={sheenTransform(spriteRot, attitude)}>
          <rect x={SPRITE.cx - 280} y={SPRITE.cy - 280} width="560" height="560" fill={`url(#${sheenId})`} />
        </g>
      </g>
      </g>
    </svg>
  )
})
