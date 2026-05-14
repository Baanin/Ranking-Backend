import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, requirePermission } from '@/middleware/auth';
import { AUDIT_ACTIONS, logAudit } from '@/lib/audit';
import {
  getPointsRules,
  invalidateRulesCache,
  computePointsSync,
  DEFAULT_RULES,
} from '@/lib/ranking';

const router = Router();

const canManage = [requireAuth, requirePermission('MANAGE_TOURNAMENTS')];

const ruleSchema = z.object({
  label: z.string().min(1).max(50),
  placementMin: z.number().int().min(1),
  placementMax: z.number().int().min(1),
  points: z.number().int().min(0),
  sortOrder: z.number().int().min(0),
});

const putBodySchema = z.object({
  rules: z.array(ruleSchema).min(1).max(50),
});

/** GET /api/scoring-rules — public */
router.get('/', async (_req, res, next) => {
  try {
    const rules = await getPointsRules();
    res.json({ data: rules });
  } catch (e) {
    next(e);
  }
});

/** PUT /api/scoring-rules — replace the full table (protected) */
router.put('/', canManage, async (req, res, next) => {
  try {
    const { rules } = putBodySchema.parse(req.body);

    await prisma.$transaction(async (tx) => {
      await tx.pointsRule.deleteMany();
      await tx.pointsRule.createMany({
        data: rules.map((r, i) => ({
          label: r.label,
          placementMin: r.placementMin,
          placementMax: r.placementMax,
          points: r.points,
          sortOrder: r.sortOrder ?? i,
        })),
      });
    });

    invalidateRulesCache();

    await logAudit(req, {
      action: AUDIT_ACTIONS.SCORING_UPDATE,
      entity: 'PointsRule',
      metadata: { rulesCount: rules.length },
    });

    const saved = await getPointsRules();
    res.json({ data: saved });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/scoring-rules — reset to built-in defaults (protected) */
router.delete('/', canManage, async (req, res, next) => {
  try {
    await prisma.pointsRule.deleteMany();
    invalidateRulesCache();
    await logAudit(req, {
      action: AUDIT_ACTIONS.SCORING_UPDATE,
      entity: 'PointsRule',
      metadata: { action: 'reset_to_defaults' },
    });
    res.json({ data: DEFAULT_RULES });
  } catch (e) {
    next(e);
  }
});

/** POST /api/scoring-rules/recalculate — recompute all participations (protected) */
router.post('/recalculate', canManage, async (req, res, next) => {
  try {
    const rules = await getPointsRules();

    const tournaments = await prisma.tournament.findMany({
      select: {
        id: true,
        numEntrants: true,
        entries: { select: { id: true, placement: true } },
      },
    });

    let updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const t of tournaments) {
        for (const entry of t.entries) {
          const newPoints = computePointsSync(entry.placement, t.numEntrants, rules);
          await tx.participation.update({
            where: { id: entry.id },
            data: { pointsEarned: newPoints },
          });
          updated++;
        }
      }
    });

    await logAudit(req, {
      action: AUDIT_ACTIONS.SCORING_RECALCULATE,
      entity: 'Participation',
      metadata: { participationsUpdated: updated, tournamentsProcessed: tournaments.length },
    });

    res.json({ data: { updated, tournaments: tournaments.length } });
  } catch (e) {
    next(e);
  }
});

export default router;
