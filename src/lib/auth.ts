import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';
import { parsePermissions, type Permission } from './permissions';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'change-me-access';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh';
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
const REFRESH_EXPIRES_DAYS = Number(process.env.JWT_REFRESH_EXPIRES_DAYS ?? 30);
const BCRYPT_ROUNDS = 12;

export type AccessTokenPayload = {
  sub: string; // user id
  email: string;
  role: string;
  permissions: Permission[];
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

/**
 * Refresh tokens are opaque random strings stored hashed in DB.
 * We also sign a JWT wrapper so the cookie value carries type info.
 */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export function hashRefreshToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function issueRefreshToken(userId: string, userAgent?: string) {
  const { raw, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { tokenHash: hash, userId, expiresAt, userAgent },
  });
  return { raw, expiresAt };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  const hash = hashRefreshToken(raw);
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Validates a refresh token and returns the associated user, or null if invalid.
 */
export async function consumeRefreshToken(raw: string) {
  const hash = hashRefreshToken(raw);
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
    include: { user: true },
  });
  if (!token || token.revokedAt || token.expiresAt < new Date()) return null;
  if (!token.user.isActive) return null;
  return token;
}

export function buildAccessPayload(user: {
  id: string;
  email: string;
  role: string;
  permissions: string;
}): AccessTokenPayload {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    permissions: parsePermissions(user.permissions),
  };
}

export const REFRESH_COOKIE_NAME = 'rf_token';
export const REFRESH_COOKIE_MAX_AGE = REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000;

// unused import suppression if REFRESH_SECRET is not used; kept for future rotation
void REFRESH_SECRET;
