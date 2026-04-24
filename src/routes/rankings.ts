import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const router = Router();

const querySchema = z.object({
  gameId: z.string().optional(),
  gameSlug: z.string().optional(),
  seasonId: z.string().optional(),
});

/**
 * GET /api/rankings?gameId=xxx&seasonId=yyy
 * or  /api/rankings?gameSlug=sf6&seasonId=yyy
 *
 * Aggregates player points from participations in tournaments matching the
 * given game and season (both optional but typically at least gameId).
 * When nothing is provided, returns all-time points across all games/seasons.
 */
router.get('/', async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);

    // Resolve gameId if only a slug was provided
    let gameId = q.gameId;
    if (!gameId && q.gameSlug) {
      const game = await prisma.game.findUnique({ where: { slug: q.gameSlug } });
      gameId = game?.id;
      if (!gameId) {
        res.json({ data: [], meta: { gameId: null, seasonId: q.seasonId ?? null } });
        return;
      }
    }

    const tournamentWhere: Record<string, unknown> = {};
    if (gameId) tournamentWhere.gameId = gameId;
    if (q.seasonId) tournamentWhere.seasonId = q.seasonId;

    // Fetch participations with player + tournament, filtered by tournament criteria
    const participations = await prisma.participation.findMany({
      where: { tournament: tournamentWhere },
      include: {
        player: true,
        tournament: { select: { id: true, winnerId: true } },
      },
    });

    // Aggregate per player
    const byPlayer = new Map<
      string,
      {
        playerId: string;
        tag: string;
        name: string | null;
        country: string;
        avatarColor: string;
        points: number;
        tournamentsPlayed: number;
        wins: number;
      }
    >();

    for (const p of participations) {
      const key = p.player.id;
      const entry = byPlayer.get(key) ?? {
        playerId: p.player.id,
        tag: p.player.tag,
        name: p.player.name,
        country: p.player.country,
        avatarColor: p.player.avatarColor,
        points: 0,
        tournamentsPlayed: 0,
        wins: 0,
      };
      entry.points += p.pointsEarned;
      entry.tournamentsPlayed += 1;
      if (p.tournament.winnerId === p.player.id) entry.wins += 1;
      byPlayer.set(key, entry);
    }

    const rankings = [...byPlayer.values()]
      .sort((a, b) => b.points - a.points || b.wins - a.wins)
      .map((entry, idx) => ({ rank: idx + 1, ...entry }));

    res.json({
      data: rankings,
      meta: { gameId: gameId ?? null, seasonId: q.seasonId ?? null, total: rankings.length },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
