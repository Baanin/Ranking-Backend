import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import {
  ALL_PERMISSIONS,
  parsePermissions,
  serializePermissions,
  type Permission,
} from '@/lib/permissions';
import { AUDIT_ACTIONS, logAudit } from '@/lib/audit';
import { HttpError } from '@/middleware/errorHandler';
import { requireAuth, requirePermission } from '@/middleware/auth';

const router = Router();

const permissionSchema = z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]);

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(8),
  role: z.string().min(1).default('ADMIN'),
  permissions: z.array(permissionSchema).default([]),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.string().min(1).optional(),
  permissions: z.array(permissionSchema).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

function toDto(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: parsePermissions(user.permissions),
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// All routes require authentication + MANAGE_USERS permission
router.use(requireAuth, requirePermission('MANAGE_USERS'));

// GET /api/admin/users
router.get('/', async (_req, res, next) => {
  try {
    const users = await prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: users.map(toDto) });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/users/:id
router.get('/:id', async (req, res, next) => {
  try {
    const user = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!user) throw new HttpError(404, 'Admin not found');
    res.json({ data: toDto(user) });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/users
router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);

    const existing = await prisma.adminUser.findUnique({ where: { email: body.email } });
    if (existing) throw new HttpError(409, 'Email already in use');

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.adminUser.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash,
        role: body.role,
        permissions: serializePermissions(body.permissions),
      },
    });
    await logAudit(req, {
      action: AUDIT_ACTIONS.ADMIN_USER_CREATE,
      entity: 'AdminUser',
      entityId: user.id,
      metadata: {
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: body.permissions,
      },
    });
    res.status(201).json({ data: toDto(user) });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/users/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const target = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!target) throw new HttpError(404, 'Admin not found');

    // Prevent deactivating / downgrading yourself in ways that would lock you out.
    if (target.id === req.user!.sub) {
      if (body.isActive === false) {
        throw new HttpError(400, 'You cannot deactivate your own account');
      }
      if (body.permissions && !body.permissions.includes('MANAGE_USERS')) {
        throw new HttpError(400, 'You cannot remove MANAGE_USERS from yourself');
      }
    }

    // Prevent removing the last active admin with MANAGE_USERS
    if (
      (body.isActive === false ||
        (body.permissions && !body.permissions.includes('MANAGE_USERS'))) &&
      target.isActive &&
      parsePermissions(target.permissions).includes('MANAGE_USERS')
    ) {
      const remaining = await prisma.adminUser.count({
        where: {
          id: { not: target.id },
          isActive: true,
          permissions: { contains: 'MANAGE_USERS' },
        },
      });
      if (remaining === 0) {
        throw new HttpError(400, 'Cannot leave the platform without any admin able to manage users');
      }
    }

    const data: {
      name?: string;
      role?: string;
      permissions?: string;
      isActive?: boolean;
      passwordHash?: string;
    } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.role !== undefined) data.role = body.role;
    if (body.permissions !== undefined) data.permissions = serializePermissions(body.permissions);
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.password !== undefined) data.passwordHash = await hashPassword(body.password);

    // If deactivating or changing password, revoke all existing refresh tokens
    if (body.isActive === false || body.password !== undefined) {
      await prisma.refreshToken.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const user = await prisma.adminUser.update({
      where: { id: target.id },
      data,
    });
    await logAudit(req, {
      action: AUDIT_ACTIONS.ADMIN_USER_UPDATE,
      entity: 'AdminUser',
      entityId: user.id,
      metadata: {
        targetEmail: user.email,
        changes: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.role !== undefined && { role: body.role }),
          ...(body.permissions !== undefined && { permissions: body.permissions }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.password !== undefined && { password: '***changed***' }),
        },
      },
    });
    res.json({ data: toDto(user) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/users/:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.user!.sub) {
      throw new HttpError(400, 'You cannot delete your own account');
    }

    const target = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!target) throw new HttpError(404, 'Admin not found');

    // Prevent deleting the last user with MANAGE_USERS
    if (target.isActive && parsePermissions(target.permissions).includes('MANAGE_USERS')) {
      const remaining = await prisma.adminUser.count({
        where: {
          id: { not: target.id },
          isActive: true,
          permissions: { contains: 'MANAGE_USERS' },
        },
      });
      if (remaining === 0) {
        throw new HttpError(400, 'Cannot delete the last admin able to manage users');
      }
    }

    await prisma.adminUser.delete({ where: { id: target.id } });
    await logAudit(req, {
      action: AUDIT_ACTIONS.ADMIN_USER_DELETE,
      entity: 'AdminUser',
      entityId: target.id,
      metadata: { email: target.email, name: target.name, role: target.role },
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
