// Monaco (Monte Carlo) stylized silhouette, north up. Race direction: up the pit straight (Blvd Albert 1er,
// heading N with a slight E lean), Sainte Devote right, the Beau Rivage climb to Massenet/Casino at the top,
// down through Mirabeau to the tight Fairmont hairpin, Portier onto the coast, the long tunnel sweep east,
// the Nouvelle Chicane drop, then west along the harbour front (Tabac, the Piscine wiggle), Rascasse and
// Anthony Noghes closing the loop back onto the pit straight.

import type { TrackPoint } from '@/lib/ui/track-path'

export const MONACO_VIEWBOX = '310 75 480 445'

export const MONACO_POINTS: TrackPoint[] = [
  { x: 365, y: 340, r: 16 }, // Sainte Devote
  { x: 405, y: 240, r: 45 }, // Beau Rivage (climbing sweep)
  { x: 455, y: 125, r: 30 }, // Massenet
  { x: 525, y: 115, r: 18 }, // Casino Square
  { x: 585, y: 175, r: 13 }, // Mirabeau
  { x: 560, y: 250, r: 7 },  // Fairmont hairpin
  { x: 630, y: 275, r: 12 }, // Portier
  { x: 700, y: 300, r: 70 }, // tunnel (long sweep)
  { x: 735, y: 350, r: 50 }, // tunnel exit
  { x: 738, y: 408, r: 8 },  // Nouvelle Chicane in
  { x: 712, y: 428, r: 8 },  // Nouvelle Chicane out
  { x: 660, y: 448, r: 14 }, // Tabac
  { x: 600, y: 462, r: 12 }, // Piscine entry
  { x: 565, y: 482, r: 10 }, // Piscine 2
  { x: 510, y: 488, r: 10 }, // Piscine 3
  { x: 470, y: 472, r: 10 }, // Piscine exit
  { x: 385, y: 478, r: 9 },  // Rascasse
  { x: 350, y: 452, r: 11 }, // Anthony Noghes (closing edge = pit straight)
]
