import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/middleware/auth';
import { AUDIT_ACTIONS, logAudit } from '@/lib/audit';
import {
  importTournamentFromStartgg,
  resyncTournament,
} from '@/services/tournamentImport';

const router = Router();

router.use(requireAuth, requirePermission('MANAGE_TOURNAMENTS'));

const importSchema = z.object({
  url: z.string().min(1),
  gameId: z.string().optional(),
  seasonId: z.string().optional(),
});

/**
 * POST /api/admin/tournaments/import
 * body: { url: string, gameId?: string, seasonId?: string }
 *
 * Imports a tournament from a start.gg URL/slug.
 */
router.post('/import', async (req, res, next) => {
  try {
    const body = importSchema.parse(req.body);
    const result = await importTournamentFromStartgg({
      urlOrSlug: body.url,
      gameId: body.gameId,
      seasonId: body.seasonId,
    });
    await logAudit(req, {
      action: AUDIT_ACTIONS.TOURNAMENT_IMPORT,
      entity: 'Tournament',
      entityId: result.tournamentId,
      metadata: {
        name: result.tournamentName,
        game: result.game.name,
        season: result.season.name,
        entrants: result.totalEntrants,
        playersCreated: result.playersCreated,
        playersSkipped: result.playersSkipped,
      },
    });
    res.status(201).json({ data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/admin/tournaments/:id/resync
 * Re-fetches standings from start.gg for an already-imported tournament and
 * recomputes the participations + points.
 */
router.post('/:id/resync', async (req, res, next) => {
  try {
    const result = await resyncTournament(req.params.id);
    await logAudit(req, {
      action: AUDIT_ACTIONS.TOURNAMENT_RESYNC,
      entity: 'Tournament',
      entityId: result.tournamentId,
      metadata: {
        name: result.tournamentName,
        entrants: result.totalEntrants,
        status: result.status,
      },
    });
    res.json({ data: result });
  } catch (e) {
    next(e);
  }
});

export default router;
