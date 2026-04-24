import type { Request } from 'express';
import { prisma } from '@/lib/prisma';

/**
 * Canonical action codes. Keep uppercase with underscores.
 */
export const AUDIT_ACTIONS = {
  AUTH_LOGIN_SUCCESS: 'AUTH_LOGIN_SUCCESS',
  AUTH_LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  AUTH_LOGOUT: 'AUTH_LOGOUT',
  AUTH_REFRESH_FAILED: 'AUTH_REFRESH_FAILED',

  ADMIN_USER_CREATE: 'ADMIN_USER_CREATE',
  ADMIN_USER_UPDATE: 'ADMIN_USER_UPDATE',
  ADMIN_USER_DELETE: 'ADMIN_USER_DELETE',

  TOURNAMENT_CREATE: 'TOURNAMENT_CREATE',
  TOURNAMENT_DELETE: 'TOURNAMENT_DELETE',

  PLAYER_CREATE: 'PLAYER_CREATE',
  PLAYER_DELETE: 'PLAYER_DELETE',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface LogAuditOptions {
  action: AuditAction;
  entity?: string;
  entityId?: string;
  actorId?: string | null;
  actorEmail?: string | null;
  metadata?: Record<string, unknown>;
}

function extractIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}

/**
 * Record an audit entry. Never throws — failures are logged but never block the request.
 */
export async function logAudit(req: Request, opts: LogAuditOptions): Promise<void> {
  try {
    const actorId = opts.actorId ?? req.user?.sub ?? null;
    const actorEmail = opts.actorEmail ?? req.user?.email ?? null;
    await prisma.auditLog.create({
      data: {
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId,
        actorId,
        actorEmail,
        ipAddress: extractIp(req),
        userAgent: (req.headers['user-agent'] as string) ?? null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to record audit log:', err);
  }
}
