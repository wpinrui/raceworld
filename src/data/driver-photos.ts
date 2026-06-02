// Real square headshots for the real-world drivers on the starting grid, served from
// /public/drivers/. Generated rookies/free agents have no entry and fall back to the
// DiceBear avatar. A god-mode photoUrl on a driver overrides everything.
//
// Generated from the files in public/drivers/ — keep keys in sync with driver ids in
// src/data/2026-grid.ts.

export const DRIVER_PHOTOS: Record<string, string> = {
  'alexander-albon': '/drivers/alexander-albon.jpg',
  'arvid-lindblad': '/drivers/arvid-lindblad.jpg',
  'carlos-sainz': '/drivers/carlos-sainz.jpg',
  'charles-leclerc': '/drivers/charles-leclerc.jpg',
  'esteban-ocon': '/drivers/esteban-ocon.jpg',
  'fernando-alonso': '/drivers/fernando-alonso.jpg',
  'franco-colapinto': '/drivers/franco-colapinto.jpg',
  'gabriel-bortoleto': '/drivers/gabriel-bortoleto.jpg',
  'george-russell': '/drivers/george-russell.jpg',
  'isack-hadjar': '/drivers/isack-hadjar.jpg',
  'kimi-antonelli': '/drivers/kimi-antonelli.jpg',
  'lance-stroll': '/drivers/lance-stroll.jpg',
  'lando-norris': '/drivers/lando-norris.jpg',
  'lewis-hamilton': '/drivers/lewis-hamilton.jpg',
  'liam-lawson': '/drivers/liam-lawson.jpg',
  'max-verstappen': '/drivers/max-verstappen.jpg',
  'nico-hulkenberg': '/drivers/nico-hulkenberg.jpg',
  'oliver-bearman': '/drivers/oliver-bearman.jpg',
  'oscar-piastri': '/drivers/oscar-piastri.jpg',
  'pierre-gasly': '/drivers/pierre-gasly.png',
  'sergio-perez': '/drivers/sergio-perez.jpg',
  'valtteri-bottas': '/drivers/valtteri-bottas.jpg',
}

export function realPhotoFor(driverId: string): string | undefined {
  return DRIVER_PHOTOS[driverId]
}
