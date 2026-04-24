import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { HttpError } from '@/middleware/errorHandler';
import { requireAuth, requirePermission } from '@/middleware/auth';
import { AUDIT_ACTIONS, logAudit } from '@/lib/audit';

const router = Router();

const seasonCreateSchema = z.object({
  name: z.string().min(1).max(100),
  gameId: z.string().min(1),
  startDate: z.string().datetime().or(z.string()),
  endDate: z.string().datetime().or(z.string()),
  isActive: z.boolean().optional(),
});

const seasonUpdateSchema = z
  .object({
    name: z.string().min(1).max(100),
    startDate: z.string(),
    endDate: z.string(),
    isActive: z.boolean(),
  })
  .partial();

// GET /api/seasons?gameId=xxx  — public
router.get('/', async (req, res, next) => {
  try {
    const gameId = typeof req.query.gameId === 'string' ? req.query.gameId : undefined;
    const seasons = await prisma.season.findMany({
      where: gameId ? { gameId } : undefined,
      orderBy: [{ gameId: 'asc' }, { startDate: 'desc' }],
      include: {
        game: { select: { id: true, name: true, slug: true } },
        _count: { select: { tournaments: true } },
      },
    });
    res.json({ data: seasons });
  } catch (e) {
    next(e);
  }
});

const canManage = [requireAuth, requirePermission('MANAGE_TOURNAMENTS')];

router.post('/', canManage, async (req, res, next) => {
  try {
    const body = seasonCreateSchema.parse(req.body);
    const start = new Date(body.startDate);
    const end = new Date(body.endDate);
    if (end < start) throw new HttpError(400, 'endDate must be after startDate');

    const season = await prisma.season.create({
      data: {
        name: body.name,
        gameId: body.gameId,
        startDate: start,
        endDate: end,
        isActive: body.isActive ?? true,
      },
    });
    await logAudit(req, {
      action: AUDIT_ACTIONS.SEASON_CREATE,
      entity: 'Season',
      entityId: season.id,
      metadata: { name: season.name, gameId: season.gameId },
    });
    res.status(201).json({ data: season });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', canManage, async (req, res, next) => {
  try {
    const body = seasonUpdateSchema.parse(req.body);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.startDate !== undefined) data.startDate = new Date(body.startDate);
    if (body.endDate !== undefined) data.endDate = new Date(body.endDate);

    const season = await prisma.season.update({
      where: { id: req.params.id },
      data,
    });
    await logAudit(req, {
      action: AUDIT_ACTIONS.SEASON_UPDATE,
      entity: 'Season',
      entityId: season.id,
      metadata: { changes: body },
    });
    res.json({ data: season });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', canManage, async (req, res, next) => {
  try {
    const existing = await prisma.season.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { tournaments: true } } },
    });
    if (!existing) throw new HttpError(404, 'Season not found');
    if (existing._count.tournaments > 0) {
      throw new HttpError(
        409,
        `Cannot delete: ${existing._count.tournaments} tournament(s) still reference this season.`,
      );
    }
    await prisma.season.delete({ where: { id: req.params.id } });
    await logAudit(req, {
      action: AUDIT_ACTIONS.SEASON_DELETE,
      entity: 'Season',
      entityId: req.params.id,
      metadata: { name: existing.name, gameId: existing.gameId },
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
