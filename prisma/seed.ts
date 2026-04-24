import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed reference data: games and an initial season per game.
 * Players / tournaments are now imported from start.gg, so we don't seed them.
 *
 * start.gg videogame IDs are the canonical IDs returned by the GraphQL API.
 * Reference: https://developer.start.gg/reference (Videogame type)
 */

interface GameSeed {
  name: string;
  slug: string;
  startggId: number | null;
  iconColor: string;
}

const GAMES: GameSeed[] = [
  { name: 'Street Fighter 6',      slug: 'sf6',       startggId: 43868, iconColor: 'from-red-500 to-orange-500' },
  { name: 'Tekken 8',              slug: 'tekken8',   startggId: 49783, iconColor: 'from-purple-500 to-pink-500' },
  { name: 'Guilty Gear Strive',    slug: 'ggst',      startggId: 33945, iconColor: 'from-yellow-500 to-red-500' },
  { name: 'Super Smash Bros. Ultimate', slug: 'ssbu', startggId: 1386,  iconColor: 'from-blue-500 to-purple-500' },
  { name: 'Mortal Kombat 1',       slug: 'mk1',       startggId: 48548, iconColor: 'from-red-600 to-rose-800' },
  { name: 'Granblue Fantasy Versus: Rising', slug: 'gbvsr', startggId: 50203, iconColor: 'from-sky-500 to-indigo-500' },
];

async function main() {
  console.log('Seeding reference data...');

  const now = new Date();
  const year = now.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59));

  for (const g of GAMES) {
    const game = await prisma.game.upsert({
      where: { slug: g.slug },
      update: {
        name: g.name,
        startggId: g.startggId,
        iconColor: g.iconColor,
      },
      create: g,
    });

    // Create a default "Season {year}" per game if it doesn't exist
    await prisma.season.upsert({
      where: { gameId_name: { gameId: game.id, name: `Season ${year}` } },
      update: {},
      create: {
        name: `Season ${year}`,
        gameId: game.id,
        startDate: startOfYear,
        endDate: endOfYear,
        isActive: true,
      },
    });

    console.log(`  ✓ ${g.name}`);
  }

  console.log(`Seeded ${GAMES.length} games with a ${year} season each.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
