/**
 * Simple rate limiter using Vercel KV
 *
 * Limits requests by IP address or custom identifier
 */

import { kv } from '@vercel/kv';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  identifier: string; // Unique identifier (IP, user ID, etc.)
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const RATE_LIMIT_PREFIX = 'm00n:ratelimit:';

const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

// In-memory fallback for when KV is not available
const memoryStore = new Map<string, { count: number; resetAt: number }>();

export async function checkRateLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  const { windowMs, maxRequests, identifier } = config;
  const key = `${RATE_LIMIT_PREFIX}${identifier}`;
  const now = Date.now();
  const windowEnd = now + windowMs;

  // Use KV if available, otherwise use memory
  if (isKvConfigured) {
    try {
      const current = await kv.get<{ count: number; resetAt: number }>(key);

      if (!current || now > current.resetAt) {
        // New window
        await kv.set(key, { count: 1, resetAt: windowEnd }, { px: windowMs });
        return { allowed: true, remaining: maxRequests - 1, resetAt: windowEnd };
      }

      if (current.count >= maxRequests) {
        return { allowed: false, remaining: 0, resetAt: current.resetAt };
      }

      // Increment counter
      await kv.set(
        key,
        { count: current.count + 1, resetAt: current.resetAt },
        {
          px: current.resetAt - now
        }
      );

      return {
        allowed: true,
        remaining: maxRequests - current.count - 1,
        resetAt: current.resetAt
      };
    } catch (error) {
      console.error('[rateLimit] KV error, falling back to memory:', error);
      // Fall through to memory store
    }
  }

  // Memory fallback
  const stored = memoryStore.get(key);

  if (!stored || now > stored.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: windowEnd });
    return { allowed: true, remaining: maxRequests - 1, resetAt: windowEnd };
  }

  if (stored.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: stored.resetAt };
  }

  stored.count++;
  return {
    allowed: true,
    remaining: maxRequests - stored.count,
    resetAt: stored.resetAt
  };
}

// Helper to get client IP from request
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  return 'unknown';
}

// Pre-configured rate limiters
export const RATE_LIMITS = {
  // Admin endpoints: 10 requests per minute
  admin: {
    windowMs: 60_000,
    maxRequests: 10
  },
  // Streak updates: 5 requests per minute
  streakUpdate: {
    windowMs: 60_000,
    maxRequests: 5
  },
  // General API: 100 requests per minute
  general: {
    windowMs: 60_000,
    maxRequests: 100
  }
} as const;
