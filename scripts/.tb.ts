import { SPECIES, crownGeometry, trunkGeometry, cardsAtTier } from '@/lib/scene3d/tree-shapes'
for (const sp of SPECIES) {
  const g = crownGeometry(sp, 1, cardsAtTier(sp, 1))
  const t = trunkGeometry(sp, 1, true)
  t.computeBoundingBox()
  const tb = t.boundingBox!
  let line = `${sp.id.padEnd(7)} spread=${sp.spread} trunk y ${tb.min.y.toFixed(2)}..${tb.max.y.toFixed(2)} tris=${t.attributes.position.count/3}`
  if (g) {
    g.computeBoundingBox()
    const b = g.boundingBox!
    line += ` | crown x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)} y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)} w/h=${((b.max.x-b.min.x)/(b.max.y-b.min.y)).toFixed(2)} cards=${cardsAtTier(sp,1)} tris=${g.attributes.position.count/3}`
  }
  console.log(line)
}
