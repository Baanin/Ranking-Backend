import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Clean up
  await prisma.participation.deleteMany();
  await prisma.tournament.deleteMany();
  await prisma.player.deleteMany();

  // Players
  const players = await Promise.all([
    prisma.player.create({
      data: {
        tag: 'ShadowKing',
        name: 'Alexandre Martin',
        country: 'FR',
        mainGame: 'Street Fighter 6',
        character: 'Ken',
        avatarColor: 'from-red-500 to-orange-500',
      },
    }),
    prisma.player.create({
      data: {
        tag: 'NeoStrike',
        name: 'Julie Dubois',
        country: 'FR',
        mainGame: 'Tekken 8',
        character: 'Jin',
        avatarColor: 'from-purple-500 to-pink-500',
      },
    }),
    prisma.player.create({
      data: {
        tag: 'BlazeFury',
        name: 'Karim Benali',
        country: 'FR',
        mainGame: 'Guilty Gear Strive',
        character: 'Sol Badguy',
        avatarColor: 'from-yellow-500 to-red-500',
      },
    }),
    prisma.player.create({
      data: {
        tag: 'IronFist',
        name: 'Léa Moreau',
        country: 'BE',
        mainGame: 'Tekken 8',
        character: 'Kazuya',
        avatarColor: 'from-gray-500 to-slate-700',
      },
    }),
    prisma.player.create({
      data: {
        tag: 'CrimsonEdge',
        name: 'Thomas Laurent',
        country: 'FR',
        mainGame: 'Mortal Kombat 1',
        character: 'Scorpion',
        avatarColor: 'from-red-600 to-rose-800',
      },
    }),
  ]);

  // Tournaments
  await prisma.tournament.create({
    data: {
      name: 'Paris Fighting Arena #12',
      game: 'Street Fighter 6',
      date: new Date('2026-05-18'),
      location: 'Paris, France',
      participants: 64,
      status: 'upcoming',
      prizePool: '1 500 €',
    },
  });

  await prisma.tournament.create({
    data: {
      name: 'Tekken Masters Cup',
      game: 'Tekken 8',
      date: new Date('2026-05-04'),
      location: 'Lyon, France',
      participants: 48,
      status: 'upcoming',
      prizePool: '1 000 €',
    },
  });

  const winterCup = await prisma.tournament.create({
    data: {
      name: 'Versus Winter Cup 2026',
      game: 'Street Fighter 6',
      date: new Date('2026-02-15'),
      location: 'Marseille, France',
      participants: 96,
      status: 'completed',
      prizePool: '2 500 €',
      winnerId: players[0].id,
    },
  });

  // Example participations
  await prisma.participation.createMany({
    data: [
      { tournamentId: winterCup.id, playerId: players[0].id, placement: 1, pointsEarned: 500 },
      { tournamentId: winterCup.id, playerId: players[1].id, placement: 2, pointsEarned: 350 },
      { tournamentId: winterCup.id, playerId: players[2].id, placement: 3, pointsEarned: 250 },
    ],
  });

  console.log(`Seeded ${players.length} players and tournaments.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
