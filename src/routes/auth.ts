import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  REFRESH_COOKIE_MAX_AGE,
  REFRESH_COOKIE_NAME,
  buildAccessPayload,
  consumeRefreshToken,
  issueRefreshToken,
  revokeRefreshToken,
  signAccessToken,
  verifyPassword,
} from '@/lib/auth';
import { parsePermissions } from '@/lib/permissions';
import { HttpError } from '@/middleware/errorHandler';
import { requireAuth } from '@/middleware/auth';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? ('none' as const) : ('lax' as const),
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: '/api/auth',
  };
}

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.adminUser.findUnique({ where: { email } });
    if (!user || !user.isActive) throw new HttpError(401, 'Invalid credentials');

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new HttpError(401, 'Invalid credentials');

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = signAccessToken(buildAccessPayload(user));
    const { raw: refreshToken } = await issueRefreshToken(user.id, req.headers['user-agent']);

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, cookieOptions());
    res.json({
      data: {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          permissions: parsePermissions(user.permissions),
        },
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!raw) throw new HttpError(401, 'No refresh token');

    const token = await consumeRefreshToken(raw);
    if (!token) throw new HttpError(401, 'Invalid refresh token');

    // Rotation: revoke old + issue new
    await revokeRefreshToken(raw);
    const { raw: newRefresh } = await issueRefreshToken(token.userId, req.headers['user-agent']);

    const accessToken = signAccessToken(buildAccessPayload(token.user));

    res.cookie(REFRESH_COOKIE_NAME, newRefresh, cookieOptions());
    res.json({
      data: {
        accessToken,
        user: {
          id: token.user.id,
          email: token.user.email,
          name: token.user.name,
          role: token.user.role,
          permissions: parsePermissions(token.user.permissions),
        },
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (raw) await revokeRefreshToken(raw);
    res.clearCookie(REFRESH_COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.adminUser.findUnique({ where: { id: req.user!.sub } });
    if (!user || !user.isActive) throw new HttpError(401, 'User not found');
    res.json({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: parsePermissions(user.permissions),
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
