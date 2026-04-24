import { prisma } from '@/lib/prisma';
import {
  fetchEventWithStandings,
  parseEventSlug,
  type StartggEvent,
  type StartggStandingEntrant,
} from '@/lib/startgg';
import { computePoints } from '@/lib/ranking';
import { HttpError } from '@/middleware/errorHandler';

export interface ImportResult {
  tournamentId: string;
  tournamentName: string;
  game: { id: string; name: string };
  season: { id: string; name: string };
  totalEntrants: number;
  participationsCreated: number;
  playersCreated: number;
  playersSkipped: number;
  status: string;
}

export interface ImportOptions {
  /** start.gg URL or canonical slug. */
  urlOrSlug: string;
  /** Optional forced gameId; if omitted we match by startggId from the event's videogame. */
  gameId?: string;
  /** Optional forced seasonId; if omitted we pick the active season for the resolved game that contains the event date. */
  seasonId?: string;
}

/**
 * Imports a tournament from start.gg into the local database.
 *
 * - Creates/updates the Tournament row (keyed by startggSlug).
 * - Creates missing Players (matched by startggUserId, created for unknowns).
 * - Recomputes Participation rows + points atomically.
 *
 * Throws HttpError on invalid input / API errors.
 */
export async function importTournamentFromStartgg(
  opts: ImportOptions,
): Promise<ImportResult> {
  const slug = parseEventSlug(opts.urlOrSlug);
  if (!slug) {
    throw new HttpError(400, 'Invalid start.gg URL or slug');
  }

  // Refuse to import twice — caller must use resync instead
  const already = await prisma.tournament.findUnique({ where: { startggSlug: slug } });
  if (already) {
    throw new HttpError(
      409,
      `Tournament already imported (id=${already.id}). Use resync to refresh it.`,
    );
  }

  return runImport(slug, opts, { mode: 'create' });
}

/**
 * Re-syncs an already-imported tournament: refetches standings and recomputes
 * participations + points. Safe to call multiple times.
 */
export async function resyncTournament(tournamentId: string): Promise<ImportResult> {
  const existing = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!existing) throw new HttpError(404, 'Tournament not found');
  if (!existing.startggSlug) {
    throw new HttpError(400, 'Tournament has no startgg slug — cannot resync');
  }
  return runImport(
    existing.startggSlug,
    { urlOrSlug: existing.startggSlug, gameId: existing.gameId, seasonId: existing.seasonId },
    { mode: 'update', existingId: existing.id },
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runImport(
  slug: string,
  opts: ImportOptions,
  ctx: { mode: 'create' | 'update'; existingId?: string },
): Promise<ImportResult> {
  const fetched = await fetchEventWithStandings(slug);
  if (!fetched) throw new HttpError(404, 'start.gg event not found');
  const { event, standings } = fetched;

  // Resolve Game
  const game = await resolveGame(event, opts.gameId);
  // Resolve Season
  const season = await resolveSeason(game.id, event, opts.seasonId);

  // Upsert players first (parallel-safe but we do it sequentially for simplicity)
  let playersCreated = 0;
  let playersSkipped = 0;
  const placementMap: Array<{ playerId: string; placement: number }> = [];

  for (const row of standings) {
    const resolved = await upsertPlayerFromStanding(row);
    if (!resolved) {
      playersSkipped += 1;
      continue;
    }
    if (resolved.created) playersCreated += 1;
    placementMap.push({ playerId: resolved.playerId, placement: row.placement });
  }

  const numEntrants = event.numEntrants ?? standings.length;
  const status = mapEventState(event.state);

  const tournamentData = {
    name: event.name,
    date: event.startAt ? new Date(event.startAt * 1000) : new Date(),
    location: buildLocation(event),
    numEntrants,
    status,
    startggSlug: slug,
    startggEventId: event.id,
    lastSyncedAt: new Date(),
    gameId: game.id,
    seasonId: season.id,
  };

  // Replace the tournament + its participations atomically.
  const tournament = await prisma.$transaction(async (tx) => {
    const t =
      ctx.mode === 'create'
        ? await tx.tournament.create({ data: tournamentData })
        : await tx.tournament.update({
            where: { id: ctx.existingId! },
            data: tournamentData,
          });

    // Wipe old participations (idempotent)
    await tx.participation.deleteMany({ where: { tournamentId: t.id } });

    // Create fresh participations
    await tx.participation.createMany({
      data: placementMap.map((p) => ({
        tournamentId: t.id,
        playerId: p.playerId,
        placement: p.placement,
        pointsEarned: computePoints(p.placement, numEntrants),
      })),
    });

    // Set winner FK (placement 1) if present
    const winnerRow = placementMap.find((p) => p.placement === 1);
    if (winnerRow) {
      await tx.tournament.update({
        where: { id: t.id },
        data: { winnerId: winnerRow.playerId },
      });
    }

    return t;
  });

  return {
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    game: { id: game.id, name: game.name },
    season: { id: season.id, name: season.name },
    totalEntrants: numEntrants,
    participationsCreated: placementMap.length,
    playersCreated,
    playersSkipped,
    status,
  };
}

async function resolveGame(
  event: StartggEvent,
  forcedGameId?: string,
): Promise<{ id: string; name: string }> {
  if (forcedGameId) {
    const g = await prisma.game.findUnique({ where: { id: forcedGameId } });
    if (!g) throw new HttpError(404, `Game not found: ${forcedGameId}`);
    return g;
  }
  if (!event.videogame) {
    throw new HttpError(400, 'start.gg event has no videogame info — please specify gameId');
  }
  const g = await prisma.game.findUnique({ where: { startggId: event.videogame.id } });
  if (!g) {
    throw new HttpError(
      400,
      `No local Game mapped to start.gg videogame "${event.videogame.name}" (id=${event.videogame.id}). Create it in the admin panel first.`,
    );
  }
  return g;
}

async function resolveSeason(
  gameId: string,
  event: StartggEvent,
  forcedSeasonId?: string,
): Promise<{ id: string; name: string }> {
  if (forcedSeasonId) {
    const s = await prisma.season.findUnique({ where: { id: forcedSeasonId } });
    if (!s) throw new HttpError(404, `Season not found: ${forcedSeasonId}`);
    if (s.gameId !== gameId) {
      throw new HttpError(400, 'Season does not belong to the resolved game');
    }
    return s;
  }

  const eventDate = event.startAt ? new Date(event.startAt * 1000) : new Date();
  const season = await prisma.season.findFirst({
    where: {
      gameId,
      isActive: true,
      startDate: { lte: eventDate },
      endDate: { gte: eventDate },
    },
    orderBy: { startDate: 'desc' },
  });
  if (!season) {
    throw new HttpError(
      400,
      `No active season for this game covers ${eventDate.toISOString().slice(0, 10)}. Create one first or pass seasonId explicitly.`,
    );
  }
  return season;
}

/**
 * Upserts a Player from a standing entrant.
 * Returns null if we skip (team event, no user, etc.).
 */
async function upsertPlayerFromStanding(
  row: StartggStandingEntrant,
): Promise<{ playerId: string; created: boolean } | null> {
  const participants = row.entrant.participants ?? [];
  // Only handle singles events for now
  if (participants.length !== 1) return null;

  const participant = participants[0];
  const user = participant.user;
  const tag = (participant.gamerTag || row.entrant.name || '').trim();
  if (!tag) return null;

  // If we have a linked start.gg user, look up by startggUserId first
  if (user) {
    const existing = await prisma.player.findUnique({
      where: { startggUserId: user.id },
    });
    if (existing) return { playerId: existing.id, created: false };

    const created = await prisma.player.create({
      data: {
        tag,
        name: user.name,
        country: user.location?.country ?? 'XX',
        startggUserId: user.id,
        startggSlug: user.slug,
      },
    });
    return { playerId: created.id, created: true };
  }

  // Fallback: no linked user account (guest). Try to match by tag; otherwise create.
  const byTag = await prisma.player.findFirst({
    where: { tag, startggUserId: null },
  });
  if (byTag) return { playerId: byTag.id, created: false };

  const created = await prisma.player.create({
    data: { tag, country: 'XX' },
  });
  return { playerId: created.id, created: true };
}

function mapEventState(state: string): string {
  // start.gg: CREATED | ACTIVE | COMPLETED | READY | INVALID | QUEUED ...
  switch (state) {
    case 'COMPLETED':
      return 'completed';
    case 'ACTIVE':
    case 'READY':
    case 'CALLED':
    case 'QUEUED':
      return 'ongoing';
    default:
      return 'upcoming';
  }
}

function buildLocation(event: StartggEvent): string {
  const t = event.tournament;
  const parts = [t.city, t.countryCode].filter(Boolean);
  return parts.join(', ') || 'Online';
}
