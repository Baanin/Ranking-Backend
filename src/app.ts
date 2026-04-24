import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import authRouter from '@/routes/auth';
import adminUsersRouter from '@/routes/adminUsers';
import adminTournamentsRouter from '@/routes/adminTournaments';
import auditLogsRouter from '@/routes/auditLogs';
import gamesRouter from '@/routes/games';
import seasonsRouter from '@/routes/seasons';
import playersRouter from '@/routes/players';
import tournamentsRouter from '@/routes/tournaments';
import rankingsRouter from '@/routes/rankings';
import { errorHandler, notFoundHandler } from '@/middleware/errorHandler';
import { apiRateLimiter } from '@/middleware/rateLimit';

export function createApp() {
  const app = express();

  // Trust the first proxy hop so express-rate-limit / req.ip see the real
  // client IP when the API is behind a reverse proxy (nginx, load balancer, etc.)
  // Set TRUST_PROXY=false in .env to disable.
  if (process.env.TRUST_PROXY !== 'false') {
    app.set('trust proxy', 1);
  }

  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());

  app.use(helmet());
  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Global safety net on all API routes
  app.use('/api', apiRateLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api/admin/users', adminUsersRouter);
  app.use('/api/admin/tournaments', adminTournamentsRouter);
  app.use('/api/admin/audit-logs', auditLogsRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/seasons', seasonsRouter);
  app.use('/api/players', playersRouter);
  app.use('/api/tournaments', tournamentsRouter);
  app.use('/api/rankings', rankingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
