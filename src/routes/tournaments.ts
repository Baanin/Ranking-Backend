import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { HttpError } from '@/middleware/errorHandler';
import { requireAuth, requirePermission } from '@/middleware/auth';
import { AUDIT_ACTIONS, logAudit } from '@/lib/audit';

const router = Router();

const canManageTournaments = [requireAuth, requirePermission('MANAGE_TOURNAMENTS')];

const listQuerySchema = z.object({
  status: z.enum(['upcoming', 'ongoing', 'completed']).optional(),
  gameId: z.string().optional(),
  gameSlug: z.string().optional(),
  seasonId: z.string().optional(),
});

// GET /api/tournaments?status=...&gameId=...&seasonId=...
router.get('/', async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);

    let gameId = q.gameId;
    if (!gameId && q.gameSlug) {
      const g = await prisma.game.findUnique({ where: { slug: q.gameSlug } });
      gameId = g?.id;
      if (!gameId) {
        res.json({ data: [] });
        return;
      }
    }

    const tournaments = await prisma.tournament.findMany({
      where: {
        ...(q.status && { status: q.status }),
        ...(gameId && { gameId }),
        ...(q.seasonId && { seasonId: q.seasonId }),
      },
      orderBy: { date: 'desc' },
      include: {
        game: true,
        season: true,
        winner: true,
        _count: { select: { entries: true } },
      },
    });
    res.json({ data: tournaments });
  } catch (e) {
    next(e);
  }
});

// GET /api/tournaments/:id
router.get('/:id', async (req, res, next) => {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      include: {
        game: true,
        season: true,
        winner: true,
        entries: {
          include: { player: true },
          orderBy: { placement: 'asc' },
        },
      },
    });
    if (!tournament) throw new HttpError(404, 'Tournament not found');
    res.json({ data: tournament });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/tournaments/:id
 * Creation / re-sync happens via /api/admin/tournaments/import (step 6.4).
 */
router.delete('/:id', canManageTournaments, async (req, res, next) => {
  try {
    const existing = await prisma.tournament.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Tournament not found');
    await prisma.tournament.delete({ where: { id: req.params.id } });
    await logAudit(req, {
      action: AUDIT_ACTIONS.TOURNAMENT_DELETE,
      entity: 'Tournament',
      entityId: req.params.id,
      metadata: {
        name: existing.name,
        gameId: existing.gameId,
        startggSlug: existing.startggSlug,
      },
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
