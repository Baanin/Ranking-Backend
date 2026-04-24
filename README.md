# Ranking-Backend

REST API for the Versus Fighting association ranking platform.

Built with **Node.js**, **Express**, **TypeScript**, **Prisma**, and **SQLite**.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Database Setup](#database-setup)
- [Running in Development](#running-in-development)
- [Production Build](#production-build)
- [API Endpoints](#api-endpoints)
- [Environment Variables](#environment-variables)

## Tech Stack

- **Node.js** + **Express 4** — HTTP server
- **TypeScript** — Static typing
- **Prisma** — Type-safe ORM
- **SQLite** — Local file-based database (zero install)
- **Zod** — Request validation
- **Helmet** + **CORS** — Security middleware
- **Morgan** — HTTP request logging

## Project Structure

```
Ranking-Backend/
├── prisma/
│   ├── schema.prisma       # DB schema
│   └── seed.ts             # Seed script
├── src/
│   ├── lib/
│   │   └── prisma.ts       # Prisma client singleton
│   ├── middleware/
│   │   └── errorHandler.ts
│   ├── routes/
│   │   ├── players.ts
│   │   ├── tournaments.ts
│   │   └── rankings.ts
│   ├── app.ts              # Express app factory
│   └── server.ts           # Entry point
├── .env.example
├── .eslintrc.cjs
├── .gitignore
├── .prettierrc
├── package.json
├── tsconfig.json
└── README.md
```

## Prerequisites

- **Node.js** >= 18.0.0 (recommended: 20.x LTS)
- **npm** >= 9

## Installation

```powershell
cd C:\Users\bcandas\CascadeProjects\Ranking-Backend
npm install
copy .env.example .env
```

## Database Setup

Generate the Prisma client and run the initial migration:

```powershell
npm run prisma:migrate
```

When prompted for a migration name, use something like `init`.

Seed the database with sample data:

```powershell
npm run db:seed
```

Open Prisma Studio to browse the data visually:

```powershell
npm run prisma:studio
```

## Running in Development

```powershell
npm run dev
```

The API is available at [http://localhost:3000](http://localhost:3000).

Health check: [http://localhost:3000/health](http://localhost:3000/health)

## Production Build

```powershell
npm run build
npm start
```

## API Endpoints

Base URL: `http://localhost:3000`

### Health
- `GET /health`

### Players
- `GET /api/players` — List all players
- `GET /api/players/:id` — Get player by id (with participations)
- `POST /api/players` — Create a player
- `DELETE /api/players/:id` — Delete a player

### Tournaments
- `GET /api/tournaments?status=upcoming` — List tournaments (optional status filter)
- `GET /api/tournaments/:id` — Get tournament by id (with entries)
- `POST /api/tournaments` — Create a tournament
- `DELETE /api/tournaments/:id` — Delete a tournament

### Rankings
- `GET /api/rankings` — Computed leaderboard (sorted by points)

### Response Format

Successful responses:

```json
{ "data": ... }
```

Error responses:

```json
{ "error": "Message", "details": { ... } }
```

## Environment Variables

See `.env.example`. Copy it to `.env` before starting.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `development` or `production` |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins |
| `DATABASE_URL` | `file:./dev.db` | Prisma connection string |

## License

To be defined.
