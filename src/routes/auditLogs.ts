import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, requirePermission } from '@/middleware/auth';

const router = Router();

router.use(requireAuth, requirePermission('VIEW_AUDIT_LOGS'));

const querySchema = z.object({
  action: z.string().optional(),
  entity: z.string().optional(),
  actorId: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});

// GET /api/admin/audit-logs
router.get('/', async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);

    const where: Record<string, unknown> = {};
    if (q.action) where.action = q.action;
    if (q.entity) where.entity = q.entity;
    if (q.actorId) where.actorId = q.actorId;
    if (q.from || q.to) {
      const createdAt: Record<string, Date> = {};
      if (q.from) createdAt.gte = new Date(q.from);
      if (q.to) createdAt.lte = new Date(q.to);
      where.createdAt = createdAt;
    }
    if (q.search) {
      where.OR = [
        { actorEmail: { contains: q.search } },
        { entityId: { contains: q.search } },
        { metadata: { contains: q.search } },
      ];
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = logs.length > q.limit;
    const items = hasMore ? logs.slice(0, q.limit) : logs;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    res.json({
      data: items.map((l) => ({
        id: l.id,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        actorId: l.actorId,
        actorEmail: l.actorEmail,
        ipAddress: l.ipAddress,
        userAgent: l.userAgent,
        metadata: l.metadata ? safeParse(l.metadata) : null,
        createdAt: l.createdAt,
      })),
      pagination: { nextCursor, hasMore },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/audit-logs/actions — distinct action codes for filter dropdown
router.get('/actions', async (_req, res, next) => {
  try {
    const rows = await prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    res.json({ data: rows.map((r) => r.action) });
  } catch (e) {
    next(e);
  }
});

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

export default router;
