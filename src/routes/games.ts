import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { HttpError } from '@/middleware/errorHandler';
import { requireAuth, requirePermission } from '@/middleware/auth';
import { AUDIT_ACTIONS, logAudit } from '@/lib/audit';

const router = Router();

const gameCreateSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/i),
  startggId: z.number().int().positive().nullable().optional(),
  iconColor: z.string().optional(),
  isActive: z.boolean().optional(),
});

const gameUpdateSchema = gameCreateSchema.partial();

// GET /api/games  — public
router.get('/', async (_req, res, next) => {
  try {
    const games = await prisma.game.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { tournaments: true, seasons: true } } },
    });
    res.json({ data: games });
  } catch (e) {
    next(e);
  }
});

const canManage = [requireAuth, requirePermission('MANAGE_TOURNAMENTS')];

router.post('/', canManage, async (req, res, next) => {
  try {
    const body = gameCreateSchema.parse(req.body);
    const game = await prisma.game.create({ data: body });
    await logAudit(req, {
      action: AUDIT_ACTIONS.GAME_CREATE,
      entity: 'Game',
      entityId: game.id,
      metadata: { name: game.name, slug: game.slug },
    });
    res.status(201).json({ data: game });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', canManage, async (req, res, next) => {
  try {
    const body = gameUpdateSchema.parse(req.body);
    const game = await prisma.game.update({
      where: { id: req.params.id },
      data: body,
    });
    await logAudit(req, {
      action: AUDIT_ACTIONS.GAME_UPDATE,
      entity: 'Game',
      entityId: game.id,
      metadata: { changes: body },
    });
    res.json({ data: game });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', canManage, async (req, res, next) => {
  try {
    const existing = await prisma.game.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { tournaments: true } } },
    });
    if (!existing) throw new HttpError(404, 'Game not found');
    if (existing._count.tournaments > 0) {
      throw new HttpError(
        409,
        `Cannot delete: ${existing._count.tournaments} tournament(s) still reference this game.`,
      );
    }
    await prisma.game.delete({ where: { id: req.params.id } });
    await logAudit(req, {
      action: AUDIT_ACTIONS.GAME_DELETE,
      entity: 'Game',
      entityId: req.params.id,
      metadata: { name: existing.name, slug: existing.slug },
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
