import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  REFRESH_COOKIE_MAX_AGE,
  REFRESH_COOKIE_NAME,
  buildAccessPayload,
  consumeRefreshToken,
  hashRefreshToken,
  issueRefreshToken,
  revokeRefreshToken,
  signAccessToken,
  verifyPassword,
} from '@/lib/auth';
import { parsePermissions } from '@/lib/permissions';
import { AUDIT_ACTIONS, logAudit } from '@/lib/audit';
import { HttpError } from '@/middleware/errorHandler';
import { requireAuth } from '@/middleware/auth';
import { loginRateLimiter, refreshRateLimiter } from '@/middleware/rateLimit';

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
router.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.adminUser.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      await logAudit(req, {
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
        entity: 'AdminUser',
        actorEmail: email,
        metadata: { reason: !user ? 'unknown_email' : 'inactive_account' },
      });
      throw new HttpError(401, 'Invalid credentials');
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      await logAudit(req, {
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
        entity: 'AdminUser',
        entityId: user.id,
        actorId: user.id,
        actorEmail: user.email,
        metadata: { reason: 'wrong_password' },
      });
      throw new HttpError(401, 'Invalid credentials');
    }

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = signAccessToken(buildAccessPayload(user));
    const { raw: refreshToken } = await issueRefreshToken(user.id, req.headers['user-agent']);

    await logAudit(req, {
      action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
      entity: 'AdminUser',
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
    });

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
router.post('/refresh', refreshRateLimiter, async (req, res, next) => {
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
    let actorId: string | null = null;
    let actorEmail: string | null = null;
    if (raw) {
      const token = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(raw) },
        include: { user: true },
      });
      if (token) {
        actorId = token.user.id;
        actorEmail = token.user.email;
      }
      await revokeRefreshToken(raw);
    }
    await logAudit(req, {
      action: AUDIT_ACTIONS.AUTH_LOGOUT,
      entity: actorId ? 'AdminUser' : undefined,
      entityId: actorId ?? undefined,
      actorId,
      actorEmail,
    });
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
