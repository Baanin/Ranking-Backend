/**
 * Ranking points engine.
 *
 * Formula (size-weighted):
 *   basePoints(placement)  — configurable lookup table stored in DB (1st=100, 2nd=70, ...)
 *   sizeMultiplier(n)      — grows with the number of entrants
 *   points = round(basePoints × sizeMultiplier)
 *
 * Example: winner of a 32-entrants tournament → 100 × 3 = 300 points.
 * Example: top 8 of a 128-entrants major     → 20 × 5  = 100 points.
 */

import { prisma } from '@/lib/prisma';

export interface PointsRuleData {
  id: string;
  label: string;
  placementMin: number;
  placementMax: number;
  points: number;
  sortOrder: number;
}

/**
 * Built-in defaults — used as fallback when the DB table is empty.
 */
export const DEFAULT_RULES: PointsRuleData[] = [
  { id: 'd1', label: '1er',        placementMin: 1,  placementMax: 1,  points: 100, sortOrder: 0 },
  { id: 'd2', label: '2ème',       placementMin: 2,  placementMax: 2,  points: 70,  sortOrder: 1 },
  { id: 'd3', label: '3ème',       placementMin: 3,  placementMax: 3,  points: 50,  sortOrder: 2 },
  { id: 'd4', label: '4ème',       placementMin: 4,  placementMax: 4,  points: 40,  sortOrder: 3 },
  { id: 'd5', label: '5ème-6ème',  placementMin: 5,  placementMax: 6,  points: 30,  sortOrder: 4 },
  { id: 'd6', label: '7ème-8ème',  placementMin: 7,  placementMax: 8,  points: 20,  sortOrder: 5 },
  { id: 'd7', label: '9ème-12ème', placementMin: 9,  placementMax: 12, points: 10,  sortOrder: 6 },
  { id: 'd8', label: '13ème-16ème',placementMin: 13, placementMax: 16, points: 5,   sortOrder: 7 },
];

/** Module-level cache — invalidated when rules are updated via the admin API. */
let rulesCache: PointsRuleData[] | null = null;

/**
 * Load rules from DB (cached). Falls back to DEFAULT_RULES if the table is empty.
 */
export async function getPointsRules(): Promise<PointsRuleData[]> {
  if (rulesCache !== null) return rulesCache;
  const dbRules = await prisma.pointsRule.findMany({ orderBy: { sortOrder: 'asc' } });
  const loaded: PointsRuleData[] = dbRules.length > 0
    ? dbRules.map((r) => ({
        id: r.id,
        label: r.label,
        placementMin: r.placementMin,
        placementMax: r.placementMax,
        points: r.points,
        sortOrder: r.sortOrder,
      }))
    : DEFAULT_RULES;
  rulesCache = loaded;
  return loaded;
}

/** Call after a PUT /admin/scoring-rules to force reload on next use. */
export function invalidateRulesCache(): void {
  rulesCache = null;
}

/**
 * Base points for a placement given a rules array (sync).
 */
export function basePointsFromRules(placement: number, rules: PointsRuleData[]): number {
  if (placement <= 0) return 0;
  const rule = rules.find((r) => placement >= r.placementMin && placement <= r.placementMax);
  return rule?.points ?? 0;
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
 * Final points (sync) — caller must supply pre-loaded rules.
 * Use this inside transactions or bulk operations.
 */
export function computePointsSync(
  placement: number,
  numEntrants: number,
  rules: PointsRuleData[],
): number {
  const base = basePointsFromRules(placement, rules);
  if (base === 0) return 0;
  return Math.round(base * sizeMultiplier(numEntrants));
}

/**
 * Convenience async version — loads rules from DB cache.
 */
export async function computePoints(placement: number, numEntrants: number): Promise<number> {
  const rules = await getPointsRules();
  return computePointsSync(placement, numEntrants, rules);
}

/**
 * Legacy sync basePoints using defaults (kept for backward compat).
 */
export function basePoints(placement: number): number {
  return basePointsFromRules(placement, DEFAULT_RULES);
}
