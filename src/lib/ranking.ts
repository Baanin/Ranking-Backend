/**
 * Ranking points engine.
 *
 * Formula (size-weighted):
 *   basePoints(placement)  — fixed lookup table (1st=100, 2nd=70, ...)
 *   sizeMultiplier(n)      — grows with the number of entrants
 *   points = round(basePoints × sizeMultiplier)
 *
 * Example: winner of a 32-entrants tournament → 100 × 3 = 300 points.
 * Example: top 8 of a 128-entrants major     → 20 × 5  = 100 points.
 */

/**
 * Base points awarded for a given placement, regardless of tournament size.
 * Placements beyond the table earn 0 points.
 */
export function basePoints(placement: number): number {
  if (placement <= 0) return 0;
  if (placement === 1) return 100;
  if (placement === 2) return 70;
  if (placement === 3) return 50;
  if (placement === 4) return 40;
  if (placement <= 6) return 30;
  if (placement <= 8) return 20;
  if (placement <= 12) return 10;
  if (placement <= 16) return 5;
  return 0;
}

/**
 * Multiplier based on how large the tournament is.
 *
 *    entrants | multiplier
 *   ----------|-----------
 *        ≤ 8  |    1.0
 *         16  |    2.0
 *         32  |    3.0
 *         64  |    4.0
 *        128  |    5.0
 *        256  |    6.0
 *
 *   Formula: max(1, 1 + log2(entrants / 8))
 */
export function sizeMultiplier(numEntrants: number): number {
  if (numEntrants <= 8) return 1;
  return 1 + Math.log2(numEntrants / 8);
}

/**
 * Final points a player earns given their placement and the tournament size.
 */
export function computePoints(placement: number, numEntrants: number): number {
  const base = basePoints(placement);
  if (base === 0) return 0;
  return Math.round(base * sizeMultiplier(numEntrants));
}
