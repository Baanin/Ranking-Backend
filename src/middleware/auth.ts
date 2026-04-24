import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, type AccessTokenPayload } from '@/lib/auth';
import { hasPermission, type Permission } from '@/lib/permissions';
import { HttpError } from './errorHandler';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AccessTokenPayload;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new HttpError(401, 'Missing or invalid Authorization header'));
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, 'Unauthenticated'));
    const missing = required.filter((p) => !hasPermission(req.user!.permissions, p));
    if (missing.length > 0) {
      return next(new HttpError(403, `Missing permission(s): ${missing.join(', ')}`));
    }
    next();
  };
}
