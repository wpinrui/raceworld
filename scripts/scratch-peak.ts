// Throwaway: peak heights along the fresh ours-silhouette. Deleted at loop close.
import sharp from 'sharp'

async function main() {
  const img = sharp('scripts/.preview/car-sil-ours-oside.png')
  const meta = await img.metadata()
  const raw = await img.raw().toBuffer()
  const ch = meta.channels ?? 3
  const w = meta.width!
  const h = meta.height!
  const topAt: number[] = new Array(w).fill(h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch
      if ((raw[i] < 245 || raw[i + 1] < 245 || raw[i + 2] < 245) && y < topAt[x]) topAt[x] = y
    }
  }
  const worldY = (px: number) => 285 - 0.5 * px
  // Rear third: the wing zone. Screen-left is the rear.
  const rear = Math.min(...topAt.slice(80, 320))
  const all = Math.min(...topAt.filter((v) => v < h))
  console.log('rear-zone peak', worldY(rear).toFixed(0), 'units; overall peak', worldY(all).toFixed(0))
}

main()
