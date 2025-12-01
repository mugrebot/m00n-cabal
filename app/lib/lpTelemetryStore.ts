import { kv } from '@vercel/kv';
import type { LeaderboardSnapshot, SolarSystemPayload } from '@/app/lib/lpTelemetry';

const SOLAR_KEY = 'm00n:lp-solar-system';
const LEADERBOARD_KEY = 'm00n:lp-leaderboard';

const MEMORY_TTL_MS = Number(process.env.LP_TELEMETRY_MEMORY_TTL_MS ?? 60_000);

type CacheEntry<T> = { value: T; expiresAt: number };

const memoryCache = new Map<string, CacheEntry<unknown>>();

const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

const getFromMemory = <T>(key: string): T | null => {
  if (MEMORY_TTL_MS <= 0) return null;
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value as T;
};

const setInMemory = <T>(key: string, value: T) => {
  if (MEMORY_TTL_MS <= 0) return;
  memoryCache.set(key, { value, expiresAt: Date.now() + MEMORY_TTL_MS });
};

async function kvSafeGet<T>(key: string): Promise<T | null> {
  if (!isKvConfigured) return null;
  try {
    return ((await kv.get<T>(key)) as T | null) ?? null;
  } catch (error) {
    console.error(`[lpTelemetryStore] Failed to read ${key} from KV`, error);
    return null;
  }
}

async function kvSafeSet<T>(key: string, value: T): Promise<void> {
  if (!isKvConfigured) return;
  try {
    await kv.set(key, value);
  } catch (error) {
    console.error(`[lpTelemetryStore] Failed to persist ${key} to KV`, error);
  }
}

export async function readSolarSystemSnapshot(): Promise<SolarSystemPayload | null> {
  const memoryValue = getFromMemory<SolarSystemPayload>(SOLAR_KEY);
  if (memoryValue) return memoryValue;

  const kvValue = await kvSafeGet<SolarSystemPayload>(SOLAR_KEY);
  if (kvValue) {
    setInMemory(SOLAR_KEY, kvValue);
  }
  return kvValue;
}

export async function writeSolarSystemSnapshot(payload: SolarSystemPayload): Promise<void> {
  setInMemory(SOLAR_KEY, payload);
  await kvSafeSet(SOLAR_KEY, payload);
}

export async function readLeaderboardSnapshot(): Promise<LeaderboardSnapshot | null> {
  const memoryValue = getFromMemory<LeaderboardSnapshot>(LEADERBOARD_KEY);
  if (memoryValue) return memoryValue;

  const kvValue = await kvSafeGet<LeaderboardSnapshot>(LEADERBOARD_KEY);
  if (kvValue) {
    setInMemory(LEADERBOARD_KEY, kvValue);
  }
  return kvValue;
}

export async function writeLeaderboardSnapshot(payload: LeaderboardSnapshot): Promise<void> {
  setInMemory(LEADERBOARD_KEY, payload);
  await kvSafeSet(LEADERBOARD_KEY, payload);
}

export const LP_TELEMETRY_ADMIN_SECRET = process.env.LP_TELEMETRY_SECRET ?? '';

export const isTelemetryStorageBacked = isKvConfigured;
