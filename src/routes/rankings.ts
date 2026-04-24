import { Router } from 'express';
import { prisma } from '@/lib/prisma';

const router = Router();

// GET /api/rankings
// Computes total points per player from completed tournament participations.
router.get('/', async (_req, res, next) => {
  try {
    const players = await prisma.player.findMany({
      include: {
        participations: {
          include: { tournament: true },
        },
        wonTournaments: true,
      },
    });

    const rankings = players
      .map((p) => {
        const points = p.participations.reduce((sum, part) => sum + part.pointsEarned, 0);
        return {
          playerId: p.id,
          tag: p.tag,
          name: p.name,
          country: p.country,
          mainGame: p.mainGame,
          character: p.character,
          avatarColor: p.avatarColor,
          points,
          tournamentsPlayed: p.participations.length,
          wins: p.wonTournaments.length,
        };
      })
      .sort((a, b) => b.points - a.points)
      .map((entry, idx) => ({ rank: idx + 1, ...entry }));

    res.json({ data: rankings });
  } catch (e) {
    next(e);
  }
});

export default router;
