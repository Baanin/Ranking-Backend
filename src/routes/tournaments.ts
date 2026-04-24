import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { HttpError } from '@/middleware/errorHandler';
import { requireAuth, requirePermission } from '@/middleware/auth';
import { AUDIT_ACTIONS, logAudit } from '@/lib/audit';

const router = Router();

const canManageTournaments = [requireAuth, requirePermission('MANAGE_TOURNAMENTS')];

const tournamentCreateSchema = z.object({
  name: z.string().min(3),
  game: z.string(),
  date: z.string().datetime().or(z.string()),
  location: z.string(),
  participants: z.number().int().nonnegative().optional(),
  status: z.enum(['upcoming', 'ongoing', 'completed']).optional(),
  prizePool: z.string().optional(),
  winnerId: z.string().optional(),
});

// GET /api/tournaments?status=upcoming
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const tournaments = await prisma.tournament.findMany({
      where: status ? { status } : undefined,
      orderBy: { date: 'desc' },
      include: { winner: true },
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

// POST /api/tournaments
router.post('/', canManageTournaments, async (req, res, next) => {
  try {
    const body = tournamentCreateSchema.parse(req.body);
    const tournament = await prisma.tournament.create({
      data: { ...body, date: new Date(body.date) },
    });
    await logAudit(req, {
      action: AUDIT_ACTIONS.TOURNAMENT_CREATE,
      entity: 'Tournament',
      entityId: tournament.id,
      metadata: { name: tournament.name, game: tournament.game, date: tournament.date },
    });
    res.status(201).json({ data: tournament });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/tournaments/:id
router.delete('/:id', canManageTournaments, async (req, res, next) => {
  try {
    const existing = await prisma.tournament.findUnique({ where: { id: req.params.id } });
    await prisma.tournament.delete({ where: { id: req.params.id } });
    await logAudit(req, {
      action: AUDIT_ACTIONS.TOURNAMENT_DELETE,
      entity: 'Tournament',
      entityId: req.params.id,
      metadata: existing ? { name: existing.name, game: existing.game } : undefined,
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
