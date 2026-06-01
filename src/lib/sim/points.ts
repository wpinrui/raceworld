const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]

export function getPoints(finishPosition: number | null): number {
  if (finishPosition === null) return 0
  return F1_POINTS[finishPosition - 1] ?? 0
}
