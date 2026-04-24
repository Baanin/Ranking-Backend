import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { HttpError } from '@/middleware/errorHandler';
import { requireAuth, requirePermission } from '@/middleware/auth';
import { AUDIT_ACTIONS, logAudit } from '@/lib/audit';

const router = Router();

const canManagePlayers = [requireAuth, requirePermission('MANAGE_PLAYERS')];

const playerUpdateSchema = z.object({
  tag: z.string().min(1).max(64).optional(),
  name: z.string().nullable().optional(),
  country: z.string().length(2).optional(),
  avatarColor: z.string().optional(),
  startggUserId: z.number().int().nullable().optional(),
  startggSlug: z.string().nullable().optional(),
});

// GET /api/players
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    const players = await prisma.player.findMany({
      where: q
        ? {
            OR: [
              { tag: { contains: q } },
              { name: { contains: q } },
              { startggSlug: { contains: q } },
            ],
          }
        : undefined,
      orderBy: { tag: 'asc' },
      take: 200,
    });
    res.json({ data: players });
  } catch (e) {
    next(e);
  }
});

// GET /api/players/:id
router.get('/:id', async (req, res, next) => {
  try {
    const player = await prisma.player.findUnique({
      where: { id: req.params.id },
      include: {
        participations: {
          include: {
            tournament: { include: { game: true, season: true } },
          },
          orderBy: { tournament: { date: 'desc' } },
        },
      },
    });
    if (!player) throw new HttpError(404, 'Player not found');
    res.json({ data: player });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/players/:id
 * Manual edits: fix tag typos, set country, attach startgg identity, etc.
 * New players are usually created automatically during tournament import.
 */
router.patch('/:id', canManagePlayers, async (req, res, next) => {
  try {
    const body = playerUpdateSchema.parse(req.body);
    const player = await prisma.player.update({
      where: { id: req.params.id },
      data: body,
    });
    await logAudit(req, {
      action: AUDIT_ACTIONS.PLAYER_UPDATE,
      entity: 'Player',
      entityId: player.id,
      metadata: { changes: body },
    });
    res.json({ data: player });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/players/:id — be careful: cascades to participations
router.delete('/:id', canManagePlayers, async (req, res, next) => {
  try {
    const existing = await prisma.player.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Player not found');
    await prisma.player.delete({ where: { id: req.params.id } });
    await logAudit(req, {
      action: AUDIT_ACTIONS.PLAYER_DELETE,
      entity: 'Player',
      entityId: req.params.id,
      metadata: { tag: existing.tag, name: existing.name, startggSlug: existing.startggSlug },
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
