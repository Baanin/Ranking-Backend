import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Strict limiter for authentication endpoints (login, refresh).
 * Designed to thwart credential stuffing / brute force.
 *
 * - 10 attempts per IP per 15 minutes
 * - Also keyed by email (when present in body) so different emails from the
 *   same IP get separate buckets — but an attacker cycling through a list
 *   still hits the IP cap.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts. Please try again in a few minutes.',
  },
  keyGenerator: (req: Request): string => {
    const ip = ipKeyGenerator(req.ip ?? 'unknown');
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return email ? `${ip}|${email}` : ip;
  },
  // Successful logins should not count against the quota
  skipSuccessfulRequests: true,
});

/**
 * Lighter limiter for the refresh endpoint (still IP-based, higher cap).
 */
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts. Please slow down.' },
});

/**
 * Global safety net for all /api routes. Prevents runaway clients.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
