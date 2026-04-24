import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import authRouter from '@/routes/auth';
import playersRouter from '@/routes/players';
import tournamentsRouter from '@/routes/tournaments';
import rankingsRouter from '@/routes/rankings';
import { errorHandler, notFoundHandler } from '@/middleware/errorHandler';

export function createApp() {
  const app = express();

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

  app.use('/api/auth', authRouter);
  app.use('/api/players', playersRouter);
  app.use('/api/tournaments', tournamentsRouter);
  app.use('/api/rankings', rankingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
