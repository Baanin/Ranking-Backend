import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { HttpError } from '@/middleware/errorHandler';

const router = Router();

const playerCreateSchema = z.object({
  tag: z.string().min(2).max(32),
  name: z.string().min(2),
  country: z.string().length(2),
  mainGame: z.string(),
  character: z.string(),
  avatarColor: z.string().optional(),
});

// GET /api/players
router.get('/', async (_req, res, next) => {
  try {
    const players = await prisma.player.findMany({
      orderBy: { tag: 'asc' },
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
          include: { tournament: true },
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

// POST /api/players
router.post('/', async (req, res, next) => {
  try {
    const body = playerCreateSchema.parse(req.body);
    const player = await prisma.player.create({ data: body });
    res.status(201).json({ data: player });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/players/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.player.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
