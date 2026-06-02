// Real square headshots for the real-world drivers on the starting grid, served from
// /public/drivers/<id>.png. Generated rookies/free agents have no entry and fall back to
// the DiceBear avatar. A god-mode photoUrl on a driver overrides everything.
//
// Keep keys in sync with driver ids in src/data/2026-grid.ts.

export const DRIVER_PHOTOS: Record<string, string> = {
  'lando-norris': '/drivers/lando-norris.png',
  'oscar-piastri': '/drivers/oscar-piastri.png',
  'charles-leclerc': '/drivers/charles-leclerc.png',
  'lewis-hamilton': '/drivers/lewis-hamilton.png',
  'max-verstappen': '/drivers/max-verstappen.png',
  'isack-hadjar': '/drivers/isack-hadjar.png',
  'george-russell': '/drivers/george-russell.png',
  'kimi-antonelli': '/drivers/kimi-antonelli.png',
  'fernando-alonso': '/drivers/fernando-alonso.png',
  'lance-stroll': '/drivers/lance-stroll.png',
  'pierre-gasly': '/drivers/pierre-gasly.png', // PNG on Commons; others are JPG
  'franco-colapinto': '/drivers/franco-colapinto.png',
  'alexander-albon': '/drivers/alexander-albon.png',
  'carlos-sainz': '/drivers/carlos-sainz.png',
  'liam-lawson': '/drivers/liam-lawson.png',
  'arvid-lindblad': '/drivers/arvid-lindblad.png',
  'oliver-bearman': '/drivers/oliver-bearman.png',
  'esteban-ocon': '/drivers/esteban-ocon.png',
  'nico-hulkenberg': '/drivers/nico-hulkenberg.png',
  'gabriel-bortoleto': '/drivers/gabriel-bortoleto.png',
  'sergio-perez': '/drivers/sergio-perez.png',
  'valtteri-bottas': '/drivers/valtteri-bottas.png',
}

export function realPhotoFor(driverId: string): string | undefined {
  return DRIVER_PHOTOS[driverId]
}
