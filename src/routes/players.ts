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

// POST /api/players/:id/merge  { targetId: string }
// Merges the source player (id) INTO the target player (targetId).
// - Participations of source are moved to target (conflicts: keep best placement)
// - Tournament wins pointing to source are updated to target
// - Source is soft-deleted via mergedIntoId
router.post('/:id/merge', canManagePlayers, async (req, res, next) => {
  try {
    const sourceId = req.params.id;
    const { targetId } = z.object({ targetId: z.string().min(1) }).parse(req.body);

    if (sourceId === targetId) throw new HttpError(400, 'Cannot merge a player with themselves');

    const [source, target] = await Promise.all([
      prisma.player.findUnique({ where: { id: sourceId }, include: { participations: true } }),
      prisma.player.findUnique({ where: { id: targetId } }),
    ]);
    if (!source) throw new HttpError(404, 'Source player not found');
    if (!target) throw new HttpError(404, 'Target player not found');
    if (source.mergedIntoId) throw new HttpError(400, 'Source player is already merged');

    // Existing tournament IDs of target
    const targetParticipations = await prisma.participation.findMany({
      where: { playerId: targetId },
      select: { tournamentId: true },
    });
    const targetTournamentIds = new Set(targetParticipations.map((p) => p.tournamentId));

    await prisma.$transaction(async (tx) => {
      for (const p of source.participations) {
        if (targetTournamentIds.has(p.tournamentId)) {
          // Conflict: keep the entry with the best (lowest) placement, delete the other
          const existing = await tx.participation.findUnique({
            where: { tournamentId_playerId: { tournamentId: p.tournamentId, playerId: targetId } },
          });
          if (existing && p.placement < existing.placement) {
            await tx.participation.delete({
              where: { tournamentId_playerId: { tournamentId: p.tournamentId, playerId: targetId } },
            });
            await tx.participation.update({
              where: { id: p.id },
              data: { playerId: targetId },
            });
          } else {
            await tx.participation.delete({ where: { id: p.id } });
          }
        } else {
          await tx.participation.update({ where: { id: p.id }, data: { playerId: targetId } });
        }
      }

      // Reassign tournament wins
      await tx.tournament.updateMany({
        where: { winnerId: sourceId },
        data: { winnerId: targetId },
      });

      // Soft-delete source
      await tx.player.update({
        where: { id: sourceId },
        data: { mergedIntoId: targetId },
      });
    });

    await logAudit(req, {
      action: AUDIT_ACTIONS.PLAYER_MERGE,
      entity: 'Player',
      entityId: sourceId,
      metadata: { sourceTag: source.tag, targetId, targetTag: target.tag },
    });

    res.json({ data: { sourceId, targetId, participationsMerged: source.participations.length } });
  } catch (e) {
    next(e);
  }
});

// GET /api/players/:id/results?gameId=&seasonId=
router.get('/:id/results', async (req, res, next) => {
  try {
    const gameId = req.query.gameId as string | undefined;
    const seasonId = req.query.seasonId as string | undefined;

    const participations = await prisma.participation.findMany({
      where: {
        playerId: req.params.id,
        tournament: {
          ...(gameId ? { gameId } : {}),
          ...(seasonId ? { seasonId } : {}),
        },
      },
      include: {
        tournament: { select: { id: true, name: true, date: true, numEntrants: true } },
      },
      orderBy: { tournament: { date: 'desc' } },
      take: 20,
    });

    const data = participations.map((p) => ({
      tournamentId: p.tournament.id,
      tournamentName: p.tournament.name,
      date: p.tournament.date,
      placement: p.placement,
      points: p.pointsEarned,
      numEntrants: p.tournament.numEntrants,
    }));

    res.json({ data });
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
