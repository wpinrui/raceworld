// The crowd in a grandstand: one camera-facing billboard per occupied seat.
//
// Billboards rather than figures, and the reason is the count. A filled main stand is four thousand
// people, and four thousand of anything modelled is the whole triangle budget of a circuit spent on
// spectators nobody looks at directly. Two triangles each, turning to face the camera about the
// world's up axis, reads as a packed stand from every angle the game ever puts the camera at.
//
// Sixteen figures, each its own texture and its own instanced draw. An atlas with per-instance UVs
// would be one draw call instead of sixteen, but sixteen draws is nothing and this way the variety
// is authored in plain 2D canvas code that can be read and changed, rather than in packing maths.

import * as THREE from 'three'

/** Big enough to hold a collar, a sleeve hem and a face at two metres, which is the range the model
 *  is judged at. A quarter of this reads fine from the far side of the circuit and as a paper cutout
 *  from the front row, and the front row is the bar. 72 KB of texture each. */
const TEX_W = 96
const TEX_H = 232
/** How tall the billboard is, head to heel, for each pose.
 *
 *  A person standing up is half a metre taller than the same person sitting down, and one quad size
 *  for both is why a standing spectator read as a seated one who had floated upward. The width
 *  follows from the texture's aspect, so a figure is never stretched. */
const FIG_H_M = { standing: 1.74, seated: 1.36 }
/** Anchored on the tread itself, because a spectator now HAS feet and they stand on something. */
const FIG_BASE_M = 0.02
/** How far in front of the seat's back panel a spectator is, toward the track. Per pose, because a
 *  sitter and a stander are not in the same place.
 *
 *  The seat position IS the back panel's plane, so anchoring there puts half the billboard behind the
 *  backrest and the seat renders as a diagonal across the person's chest. But push a SEATED figure
 *  right out over the front of the pan and it reads as somebody standing in front of an empty seat,
 *  which is the other failure and the more obvious one: what says "sitting" is the seat's own pan and
 *  wings framing the body, and that only happens when the body is back in the seat. So a sitter sits
 *  just clear of the backrest, and a stander stands out in the legroom, which is where people stand. */
const FIG_FWD_M = { standing: 0.34, seated: 0.13 }

// What a crowd is actually wearing, as a deck dealt one shirt per variant rather than a palette
// sampled at random. Uniform draws from a list of colours give a rainbow, because every colour is
// equally likely and none of them is white. Real clothing is overwhelmingly neutral, with saturated
// colour a minority and only a few people in anything loud, and dealing a fixed deck GUARANTEES that
// mix. The three groups' LENGTHS are the distribution: 22 / 6 / 4 is roughly 69% neutral, 19% muted,
// 12% loud. Add to a group and you have changed the crowd's character on purpose.

/** Whites, greys, blacks, denim and earth. What most people in a stand are wearing. */
const NEUTRAL = [
  '#F0EFEB', '#E4E2DC', '#D4D0C8', '#C6C1B6', '#B9B2A4',
  '#B0B4B8', '#9AA0A6', '#868C93', '#6E747C', '#565C64',
  '#3C4149', '#2A2E35', '#22262C', '#16181D',
  '#2E3A52', '#3A4A66', '#44577A', '#546A8C',
  '#8C7B62', '#A08D72', '#6E5F4A', '#5A4C3C',
]
/** Colour, but dusty: the shirt that has been washed a hundred times. */
const MUTED = ['#7A3A38', '#4F6152', '#3E5F6B', '#6B4A5E', '#8A6A3A', '#3F5B45']
/** The few people you actually pick out of a crowd. Also every cap. */
const LOUD = ['#C0392B', '#DDA321', '#2E6BB8', '#D8642A']

const SHIRT_DECK = [...NEUTRAL, ...MUTED, ...LOUD]

/** How many distinct people the stand is built out of: one per shirt in the deck, so the two can
 *  never drift apart and every colour in the deck is guaranteed to appear. */
const VARIANTS = SHIRT_DECK.length

/** Trousers. Narrower than the shirt palette on purpose: legwear really is nearly all denim, black,
 *  grey and khaki, and giving it the shirt deck's range would put the crowd back in a rainbow from
 *  the waist down. */
const TROUSERS = ['#3A4A63', '#2B3546', '#26292E', '#4A4E55', '#7A6E58', '#3E4238', '#5A6070']
const SHOES = ['#1C1E22', '#2E2A26', '#D8D9DB', '#43331F']
const SKINS = ['#E8C09A', '#C68B5E', '#8D5A38', '#5C3A24', '#F0D3B4']
/** Hair, and nothing in it is saturated. A pillar-box red is fine on a 17 px crown and becomes a
 *  scarlet cape the moment the same colour is drawn as hair down past the shoulders. */
const HAIRS = [
  '#2A2018', '#1A1614', '#4A3423', '#6B4A2E', '#8C5A34', '#7A5A34',
  '#9A8468', '#C4A87A', '#8E8C88', '#D6D2CA',
]

/** Perceived brightness of a hex colour, 0 to 255. */
function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
}

/** Move a colour toward white (positive) or black (negative), as a css colour with alpha. */
function shift(hex: string, t: number, alpha = 1): string {
  const n = parseInt(hex.slice(1), 16)
  const to = t > 0 ? 255 : 0
  const k = Math.abs(t)
  const ch = (s: number) => Math.round(((n >> s) & 255) * (1 - k) + to * k)
  return `rgba(${ch(16)}, ${ch(8)}, ${ch(0)}, ${alpha})`
}

/** Hair that can be told apart from the face under it.
 *
 *  Drawing the two independently lets a sandy blonde land on pale skin, and at the size a spectator
 *  is on screen that is not a fair-haired person, it is a bald one: the crown vanishes into the
 *  forehead and the head loses its top. The rule is the one real heads follow. Hair is either clearly
 *  DARKER than the skin it frames, which is almost all hair, or clearly lighter, which is what a
 *  blonde or a grey head is. What never happens is the two being the same value. */
function pickHair(skin: string, rng: () => number): string {
  const face = luma(skin)
  const ok = HAIRS.filter((h) => luma(h) <= face - 28 || luma(h) >= face + 55)
  const from = ok.length > 0 ? ok : HAIRS
  return from[Math.floor(rng() * from.length)]
}

/** Deterministic per-seat noise, so a stand looks the same every time it is built and two stands at
 *  one circuit do not end up wearing identical rows of shirts. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One spectator, drawn front-on: head, hair, shoulders and arms over a torso, with the detail a
 *  person has at arm's length. Seated by default, with a standing pose and an arms-up pose in the
 *  mix, because a real stand is never all one thing.
 *
 *  `variant` picks the shirt off the deck rather than rolling for it, which is what makes the crowd's
 *  colour mix a decision instead of an accident. */
function drawFigure(
  ctx: CanvasRenderingContext2D, rng: () => number, variant: number,
): { standing: boolean } {
  const shirt = SHIRT_DECK[variant % SHIRT_DECK.length]
  const skin = SKINS[Math.floor(rng() * SKINS.length)]
  const hair = pickHair(skin, rng)
  const trousers = TROUSERS[Math.floor(rng() * TROUSERS.length)]
  const shoes = SHOES[Math.floor(rng() * SHOES.length)]
  const pose = rng()
  // A standing spectator is drawn STANDING, not the seated one nudged upward: the seated pose has
  // its thighs coming at the viewer and its shins dropping away, the standing one has neither. That
  // difference is most of what makes a row read as uneven rather than as a printed pattern.
  const standing = pose < 0.22
  const armsUp = pose > 0.9
  // Half the crowd, drawn as a build rather than as the same body with different hair: narrower
  // shoulders, a waist, wider hips. Getting a mixed crowd by hair alone gives you one physique in
  // wigs, which is exactly as obvious as it sounds.
  const female = variant % 2 === 1
  // Long hair is the loudest silhouette difference in a stand, because it breaks the head's outline
  // where every other head is a smooth dome. Not all women and not no men.
  const longHair = female ? rng() < 0.62 : rng() < 0.08
  const ponytail = longHair && rng() < 0.42
  const capped = rng() < (longHair ? 0.14 : 0.32)
  const cx = TEX_W / 2
  // Every WIDTH in this drawing is divided by how much taller than a seated figure this one is.
  //
  // The quad's width follows its height, to keep the texture's aspect; so a standing figure, being
  // 1.28 times a seated one, was getting a head and a pair of shoulders 1.28 times the size as well.
  // A person's head is the same head whether they are standing or sitting. Vertical landmarks are
  // already authored per pose, so only the widths need it.
  const wide = standing ? FIG_H_M.seated / FIG_H_M.standing : 1
  const headR = 17 * wide
  const headY = standing ? 22 : 32
  const shoulderY = headY + headR + 12
  // Where the shirt stops and the trousers start, and where the feet are. A person's hip is a bit
  // over half their standing height, and when they sit down it drops to the height of the seat pan
  // they are on. Getting this wrong is what makes a seated crowd look like it is standing in front of
  // its own seats: at 0.63 m the hip was 200 mm above a 420 mm pan, so every spectator was hovering.
  const hipY = standing ? 110 : 153
  const footY = TEX_H - 10

  ctx.clearRect(0, 0, TEX_W, TEX_H)

  // Long hair goes down FIRST, behind everything: behind the shirt, so the clothes cover its length
  // and only what falls beside the shoulders shows, and behind the head, so it never paints over the
  // face. Drawn on top instead, a fall reaching to the chest is a long beard.
  if (longHair) {
    ctx.fillStyle = hair
    const fall = shoulderY + (ponytail ? 8 : 40) + rng() * 18
    ctx.beginPath()
    ctx.moveTo(cx - headR - 3, headY - 2)
    ctx.quadraticCurveTo(cx - headR - 8, fall - 14, cx - headR + 2, fall)
    ctx.quadraticCurveTo(cx, fall + 8, cx + headR - 2, fall)
    ctx.quadraticCurveTo(cx + headR + 8, fall - 14, cx + headR + 3, headY - 2)
    ctx.fill()
    if (ponytail) {
      // Gathered back and hanging clear of the shoulder line, narrower than loose hair.
      const tail = shoulderY + 44 + rng() * 24
      ctx.beginPath()
      ctx.moveTo(cx - 8, shoulderY - 4)
      ctx.quadraticCurveTo(cx - 12, tail - 12, cx - 4, tail)
      ctx.quadraticCurveTo(cx, tail + 6, cx + 4, tail)
      ctx.quadraticCurveTo(cx + 12, tail - 12, cx + 8, shoulderY - 4)
      ctx.fill()
    }
  }

  // Legs first, so the shirt's hem overlaps them rather than butting against them.
  ctx.strokeStyle = trousers
  ctx.lineCap = 'butt'
  if (standing) {
    ctx.lineWidth = 19 * wide
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + side * 11 * wide, hipY)
      ctx.lineTo(cx + side * 12 * wide, footY - 6)
      ctx.stroke()
    }
  } else {
    // Seated, head on. The thigh runs AWAY from the viewer, so it is almost pure foreshortening: a
    // wide block only a few pixels deep, with the knee ending up at very nearly hip height. Then the
    // shin drops from there. Drawing the knee well below the hip is what made these read as standing
    // people with slightly bent legs, because a dropped knee is exactly what a standing leg has.
    ctx.lineWidth = 27
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + side * 13, hipY - 2)
      ctx.lineTo(cx + side * 16, hipY + 9)
      ctx.stroke()
    }
    ctx.lineWidth = 18
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + side * 16, hipY + 7)
      ctx.lineTo(cx + side * 15, footY - 6)
      ctx.stroke()
    }
    // The knee is the nearest part of a seated person and catches the light square on. It is the one
    // mark that says this leg is folded rather than standing.
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.ellipse(cx + side * 16, hipY + 8, 10, 6, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    // And the shadow the thigh casts into the gap between the knees, which is dark on a real one.
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath()
    ctx.ellipse(cx, hipY + 12, 9, 11, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // Shoes: a flat sole and a toe, seen end-on.
  ctx.fillStyle = shoes
  for (const side of [-1, 1]) {
    const fx = cx + side * (standing ? 12 : 14) * wide
    ctx.beginPath()
    ctx.ellipse(fx, footY - 4, 9 * wide, 7, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(fx - 9 * wide, footY - 4, 18 * wide, 5)
  }
  // Torso: a tapered body, wider at the shoulders, cut off at the bottom of the quad where the seat
  // in front hides everything anyway.
  ctx.fillStyle = shirt
  const shoulderW = (female ? 22 : 26) * wide
  const waistW = (female ? 18 : 26) * wide
  const hipW = (female ? 26 : 27) * wide
  ctx.beginPath()
  ctx.moveTo(cx - shoulderW, shoulderY + 4)
  ctx.quadraticCurveTo(cx - waistW, shoulderY + 44, cx - hipW, hipY + 9)
  ctx.lineTo(cx + hipW, hipY + 9)
  ctx.quadraticCurveTo(cx + waistW, shoulderY + 44, cx + shoulderW, shoulderY + 4)
  ctx.quadraticCurveTo(cx, shoulderY - 10, cx - shoulderW, shoulderY + 4)
  ctx.fill()
  // Arms, either down along the body or raised.
  ctx.strokeStyle = shirt
  ctx.lineWidth = 14
  ctx.lineCap = 'round'
  ctx.lineWidth = (female ? 11 : 14) * wide
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx + side * (shoulderW - 4), shoulderY + 8)
    if (armsUp) ctx.lineTo(cx + side * 34, shoulderY - 44)
    else ctx.lineTo(cx + side * (hipW + 4), hipY - 4)
    ctx.stroke()
  }
  // Hands at the end of the arms that are down, resting on the lap or the seat.
  if (!armsUp) {
    ctx.fillStyle = skin
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(cx + side * (hipW + 4), hipY + 1, 6.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // Sleeve hem: the seam where a short sleeve ends and the arm starts. Two strokes, and it is most
  // of what separates a person in a t-shirt from a coloured blob with limbs.
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'
  ctx.lineWidth = 2
  for (const side of [-1, 1]) {
    const t = armsUp
      ? { x: cx + side * 27, y: shoulderY - 14 }
      : { x: cx + side * 26, y: shoulderY + 32 }
    ctx.beginPath()
    ctx.moveTo(t.x - 7, t.y - 3)
    ctx.lineTo(t.x + 7, t.y + 3)
    ctx.stroke()
  }
  if (armsUp) {
    ctx.fillStyle = skin
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(cx + side * 34, shoulderY - 48, 8, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // Neck and head.
  ctx.fillStyle = skin
  ctx.fillRect(cx - 7, headY + headR - 6, 14, 16)
  ctx.beginPath()
  ctx.arc(cx, headY, headR, 0, Math.PI * 2)
  ctx.fill()
  // Light ON the face, from the same side the sun comes from. A face is a curved surface catching
  // the sky and hair absorbs almost everything, so the two separate by LIGHT rather than by hue: a
  // dark-skinned spectator in dark hair and a dark shirt is one unreadable mass without this, however
  // far apart the two colours are on paper, and in shade it gets worse.
  const glow = ctx.createRadialGradient(
    cx - headR * 0.45, headY - headR * 0.45, 1, cx, headY, headR * 1.25,
  )
  glow.addColorStop(0, shift(skin, 0.42))
  glow.addColorStop(0.55, shift(skin, 0.16, 0.75))
  glow.addColorStop(1, shift(skin, 0.16, 0))
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, headY, headR, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = skin
  // Ears.
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(cx + side * headR, headY + 2, 3.5, 5, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // The face, as shadow rather than as drawing: a brow line, two eye sockets, the shade under the
  // nose and the mouth. Nothing here is a feature you could name at two metres, which is right,
  // because a face you CAN read at two metres reads as a mask at ten.
  //
  // Shaded DOWN from the skin rather than painted in a fixed brown, so the features hold their
  // relationship to the face at every skin tone. A fixed dark brown is invisible on dark skin, which
  // is the tone that needs the help most.
  ctx.fillStyle = shift(skin, -0.62, 0.75)
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(cx + side * 6, headY - 1, 3, 2.2, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = shift(skin, -0.42, 0.55)
  ctx.fillRect(cx - 11, headY - 6, 22, 2)
  ctx.fillRect(cx - 2, headY + 2, 4, 5)
  ctx.beginPath()
  ctx.ellipse(cx, headY + 10, 5, 1.8, 0, 0, Math.PI * 2)
  ctx.fill()
  // The crown, which every head gets, long or short.
  ctx.fillStyle = hair
  const crown = Math.PI * (1 + rng() * 0.12)
  ctx.beginPath()
  ctx.arc(cx, headY, headR + 1, crown, Math.PI * (2 - rng() * 0.12))
  ctx.fill()
  // A lit forehead under the hairline: the strip of face that catches the sky right where the hair
  // stops. Black hair over dark skin has almost no colour difference to work with, and this one
  // stroke is what draws the boundary between them.
  ctx.strokeStyle = shift(skin, 0.34, 0.9)
  ctx.lineWidth = 2.6
  ctx.beginPath()
  ctx.arc(cx, headY + 1.5, headR - 2, Math.PI * 1.06, Math.PI * 1.94)
  ctx.stroke()
  if (longHair) {
    // The strands falling past the ears, drawn narrow and OUTSIDE the face. The rest of the length
    // was laid down before the head, behind it: hair drawn after the face is hair painted over the
    // face, and the fill of a long fall covers the whole lower head, which is why the women had no
    // faces at all.
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + side * (headR - 2), headY - 8)
      ctx.quadraticCurveTo(cx + side * (headR + 5), headY + 12, cx + side * (headR + 1), headY + 24)
      ctx.quadraticCurveTo(cx + side * (headR - 3), headY + 12, cx + side * (headR - 5), headY - 5)
      ctx.fill()
    }
  }
  if (capped) {
    // A cap in one of the loud deck colours, whoever's shirt: merchandise is where the bright colour
    // in a race crowd actually lives.
    ctx.fillStyle = SHIRT_DECK[SHIRT_DECK.length - 1 - Math.floor(rng() * 2)]
    ctx.beginPath()
    ctx.arc(cx, headY - 1, headR + 1.5, Math.PI, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(cx, headY - 2, headR + 9, 4.5, 0, Math.PI * 0.06, Math.PI * 0.94)
    ctx.fill()
  }
  // Collar: a crew neck, drawn as the shirt's own shadow where it meets the neck. Skipped under long
  // hair, which is over the neckline: drawing it anyway lays a collar line across the hair.
  if (!longHair) {
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, shoulderY - 2, 11, Math.PI * 0.12, Math.PI * 0.88)
    ctx.stroke()
  }
  // Two soft folds down the torso: cloth hangs, it does not stretch flat over a person.
  ctx.strokeStyle = 'rgba(0,0,0,0.10)'
  ctx.lineWidth = 4
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx + side * 9, shoulderY + 16)
    ctx.quadraticCurveTo(cx + side * 16, shoulderY + 44, cx + side * 11, hipY + 6)
    ctx.stroke()
  }

  // Round the whole figure off with a shading pass, painted only where something was already drawn.
  // Flat fills read as paper at point-blank range no matter how good the silhouette is: a body is
  // dark at its edges and catches light down one side, and baking that into the texture is the only
  // place a two-triangle billboard can get it. The light falls from the same side the sun does.
  ctx.globalCompositeOperation = 'source-atop'
  const across = ctx.createLinearGradient(0, 0, TEX_W, 0)
  across.addColorStop(0, 'rgba(0,0,0,0.30)')
  across.addColorStop(0.3, 'rgba(255,255,255,0.10)')
  across.addColorStop(0.62, 'rgba(0,0,0,0.06)')
  across.addColorStop(1, 'rgba(0,0,0,0.32)')
  ctx.fillStyle = across
  ctx.fillRect(0, 0, TEX_W, TEX_H)
  // And down: the chin shades the neck, the lap sits in the seat's shadow.
  const down = ctx.createLinearGradient(0, headY + headR, 0, TEX_H)
  down.addColorStop(0, 'rgba(0,0,0,0.34)')
  down.addColorStop(0.16, 'rgba(0,0,0,0)')
  down.addColorStop(0.72, 'rgba(0,0,0,0)')
  down.addColorStop(1, 'rgba(0,0,0,0.45)')
  ctx.fillStyle = down
  ctx.fillRect(0, 0, TEX_W, TEX_H)
  ctx.globalCompositeOperation = 'source-over'
  return { standing }
}

/** One drawn person: the texture, how tall they are, and where they sit or stand relative to their
 *  seat's back panel. */
export interface CrowdFigure { map: THREE.Texture; heightM: number; fwdM: number }

/** The whole cast, as textures. Browser-only: it needs a canvas, exactly like `textures3d`. */
export function crowdTextures(seed = 1): CrowdFigure[] {
  const rng = mulberry32(seed)
  const out: CrowdFigure[] = []
  for (let i = 0; i < VARIANTS; i++) {
    const canvas = document.createElement('canvas')
    canvas.width = TEX_W
    canvas.height = TEX_H
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    const { standing } = drawFigure(ctx, rng, i)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    out.push({
      map,
      heightM: standing ? FIG_H_M.standing : FIG_H_M.seated,
      fwdM: standing ? FIG_FWD_M.standing : FIG_FWD_M.seated,
    })
  }
  return out
}

/** Turn a material's quad to face the camera about the world's up axis, at draw time.
 *
 *  Up-axis only, not a full facing billboard: people stand upright. A billboard that also tips to
 *  face a camera looking down from the roof lays the whole crowd on its back, which is the classic
 *  way this effect goes wrong.
 *
 *  The instance matrix carries only a position, so the anchor is its translation column and the quad
 *  is spanned from there along the camera's horizontal right and the world's up. The normal is set
 *  to the facing direction too, so a spectator under the roof takes the roof's shade instead of
 *  lighting as if it were not there. */
function billboard(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec3 anchor = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 toCam = cameraPosition - anchor;
      toCam.y = 0.0;
      float len = max(length(toCam), 1e-4);
      toCam /= len;
      vec3 right = vec3(-toCam.z, 0.0, toCam.x);
      // The quad is spanned in WORLD space, so its corner offsets have to be carried into world
      // space too. transformed is a LOCAL coordinate: using it raw draws the billboard at its local
      // size whatever the parent is scaled by. That is invisible wherever the scale happens to be 1
      // (the probe, where the world IS metres) and multiplies every spectator by metresPerUnit
      // everywhere else. No CPU bounding box can catch it either, because the box applies exactly
      // the scale the shader is ignoring.
      //
      // Uniform scale throughout, so one column's length is the whole story.
      float bbScale = length(modelMatrix[0].xyz) * length(instanceMatrix[0].xyz);
      vec3 worldPos = anchor
        + right * transformed.x * bbScale
        + vec3(0.0, 1.0, 0.0) * transformed.y * bbScale;
      vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      `,
    )
    shader.vertexShader = shader.vertexShader.replace(
      '#include <defaultnormal_vertex>',
      `
      vec3 bbCam = cameraPosition - (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      bbCam.y = 0.0;
      vec3 transformedNormal = normalize(mat3(viewMatrix) * normalize(bbCam));
      `,
    )
  }
  // Two materials that compile different shaders must not share a program.
  mat.customProgramCacheKey = () => 'crowd-billboard'
}

/** One seat's place in the world, and which way the person in it faces.
 *
 *  The direction is carried per seat rather than taken from a parent transform because the whole
 *  circuit's crowd is ONE set of instanced draws. Thirty grandstands each building their own
 *  thirty-two figure banks is a thousand draw calls for spectators; pooling them into one is
 *  thirty-two, and the price is that the group has no stand's rotation to inherit, so "forward" has
 *  to travel with the seat. `fx, fz` is a unit vector in world XZ pointing at the track. */
export interface CrowdSeat { x: number; y: number; z: number; fx: number; fz: number }

/** Every spectator in the stand. `fill` is the fraction of seats occupied: a stand is never quite
 *  full, and the gaps are most of what stops a crowd reading as a printed texture. */
export function buildCrowd(
  seats: readonly CrowdSeat[], fill = 0.9, seed = 1, scale = 1,
): THREE.Group {
  const group = new THREE.Group()
  const rng = mulberry32(seed ^ 0x9E3779B9)
  const textures = crowdTextures(seed)
  if (textures.length === 0) return group
  const taken: CrowdSeat[][] = textures.map(() => [])
  for (const seat of seats) {
    if (rng() > fill) continue
    taken[Math.floor(rng() * textures.length)].push(seat)
  }
  textures.forEach(({ map, heightM, fwdM }, i) => {
    const people = taken[i]
    if (people.length === 0) return
    // A quad per figure height, at the texture's own aspect so nobody is stretched, anchored at its
    // bottom edge so the figure stands ON its row rather than being centred on it.
    // `scale` is a look control, not a unit conversion: the figures measure life-size against a
    // car and against a ruler, so anything other than 1 here is a deliberate stylisation of how big
    // a spectator reads, and it moves the forward offset with them so they stay in their seats.
    const h = heightM * scale
    const geo = new THREE.PlaneGeometry(h * (TEX_W / TEX_H), h)
    geo.translate(0, h / 2, 0)
    const mat = new THREE.MeshStandardMaterial({
      map,
      // Cut out rather than blended: a blended crowd needs sorting, and four thousand unsorted
      // transparent quads punch holes in each other wherever two rows overlap.
      alphaTest: 0.5,
      transparent: false,
      roughness: 1,
      side: THREE.DoubleSide,
    })
    billboard(mat)
    const inst = new THREE.InstancedMesh(geo, mat, people.length)
    // No casting: a cutout shadow needs its own depth material carrying the same billboard turn,
    // and a crowd's shadow lands on the row behind it where nothing can see it anyway.
    inst.castShadow = false
    inst.receiveShadow = true
    // The bounding sphere is computed from the untransformed quad, which sits at the origin; the
    // instances are metres away and the whole stand would be culled the moment the origin left the
    // frustum. The billboard turn happens in the shader, so three cannot know the real bounds.
    inst.frustumCulled = false
    const m = new THREE.Matrix4()
    const tint = new THREE.Color()
    people.forEach((p, k) => {
      m.makeTranslation(p.x + p.fx * fwdM * scale, p.y + FIG_BASE_M, p.z + p.fz * fwdM * scale)
      inst.setMatrixAt(k, m)
      // A per-person brightness wobble, on top of sixteen figures. Without it a big stand reads as
      // sixteen stamps repeated in a grid, which is exactly what it is; with it the repeat stops
      // being findable long before the variant count would have to go up.
      const v = 0.82 + rng() * 0.26
      inst.setColorAt(k, tint.setRGB(v, v, v))
    })
    group.add(inst)
  })
  return group
}
