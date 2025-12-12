/**
 * Yap Multiplier System
 *
 * Users can boost their LP points by up to 5x by yapping about $m00n.
 *
 * Multiplier tiers:
 * - 1x: No qualifying casts
 * - 1.5x: 1-2 casts mentioning $m00n in last 7 days
 * - 2x: 3-5 casts
 * - 3x: 6-10 casts
 * - 4x: 11-20 casts
 * - 5x: 21+ casts OR viral cast (50+ likes/recasts)
 */

import { kv } from '@vercel/kv';

// KV keys
const YAP_DATA_KEY = 'm00n:yap:data';
const YAP_LEADERBOARD_KEY = 'm00n:yap:leaderboard';

// Check if KV is configured
const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

export interface YapStats {
  fid: number;
  username: string;
  address?: string;

  // Cast stats (last 7 days)
  castCount: number;
  totalLikes: number;
  totalRecasts: number;

  // Best performing cast
  bestCastHash?: string;
  bestCastLikes?: number;
  bestCastRecasts?: number;

  // Calculated multiplier
  multiplier: number;
  multiplierTier: string;

  // Tracking
  lastUpdatedAt: number;
  castsChecked: string[]; // Cast hashes we've counted
}

export interface YapLeaderboard {
  updatedAt: string;
  topYappers: YapStats[];
  totalQualifiedYappers: number;
}

// Calculate multiplier based on cast activity
export function calculateYapMultiplier(stats: {
  castCount: number;
  totalLikes: number;
  totalRecasts: number;
}): {
  multiplier: number;
  tier: string;
} {
  const { castCount, totalLikes, totalRecasts } = stats;
  const totalEngagement = totalLikes + totalRecasts;

  // Viral bonus: 50+ engagement on any cast = instant 5x
  if (totalEngagement >= 50) {
    return { multiplier: 5, tier: '🔥 VIRAL' };
  }

  // Cast count tiers
  if (castCount >= 21) {
    return { multiplier: 5, tier: '🏆 MEGA YAPPER' };
  }
  if (castCount >= 11) {
    return { multiplier: 4, tier: '💜 SUPER YAPPER' };
  }
  if (castCount >= 6) {
    return { multiplier: 3, tier: '⭐ ACTIVE YAPPER' };
  }
  if (castCount >= 3) {
    return { multiplier: 2, tier: '🌙 YAPPER' };
  }
  if (castCount >= 1) {
    return { multiplier: 1.5, tier: '✨ STARTER' };
  }

  return { multiplier: 1, tier: '—' };
}

// Search for $m00n mentions using Neynar
export async function searchMoonCasts(
  fid: number,
  since: Date
): Promise<{
  casts: Array<{
    hash: string;
    text: string;
    likes: number;
    recasts: number;
    timestamp: string;
  }>;
  error?: string;
}> {
  const neynarApiKey = process.env.NEYNAR_API_KEY;
  if (!neynarApiKey) {
    return { casts: [], error: 'neynar_not_configured' };
  }

  try {
    // Get user's casts
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/feed?feed_type=filter&filter_type=fids&fids=${fid}&limit=100`,
      {
        headers: {
          accept: 'application/json',
          'x-api-key': neynarApiKey
        }
      }
    );

    if (!response.ok) {
      throw new Error(`neynar_${response.status}`);
    }

    const data = await response.json();
    const casts = (data.casts ?? []) as Array<{
      hash: string;
      text: string;
      reactions: { likes_count: number; recasts_count: number };
      timestamp: string;
    }>;

    // Filter for $m00n mentions in the time window
    const sinceTs = since.getTime();
    const moonPattern = /\$m00n|\$moon|m00nad|m00nlander/i;

    const qualifyingCasts = casts
      .filter((cast) => {
        const castTime = new Date(cast.timestamp).getTime();
        return castTime >= sinceTs && moonPattern.test(cast.text);
      })
      .map((cast) => ({
        hash: cast.hash,
        text: cast.text,
        likes: cast.reactions?.likes_count ?? 0,
        recasts: cast.reactions?.recasts_count ?? 0,
        timestamp: cast.timestamp
      }));

    return { casts: qualifyingCasts };
  } catch (err) {
    console.error('[yapMultiplier] Search failed:', err);
    return { casts: [], error: String(err) };
  }
}

// Update yap stats for a user
export async function updateYapStats(
  fid: number,
  username: string,
  address?: string
): Promise<YapStats | null> {
  // Get casts from last 7 days
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const { casts, error } = await searchMoonCasts(fid, since);

  if (error) {
    console.warn(`[yapMultiplier] Failed to get casts for FID ${fid}:`, error);
    return null;
  }

  // Calculate stats
  const castCount = casts.length;
  const totalLikes = casts.reduce((sum, c) => sum + c.likes, 0);
  const totalRecasts = casts.reduce((sum, c) => sum + c.recasts, 0);

  // Find best performing cast
  let bestCast = casts[0];
  for (const cast of casts) {
    const score = cast.likes + cast.recasts;
    const bestScore = (bestCast?.likes ?? 0) + (bestCast?.recasts ?? 0);
    if (score > bestScore) {
      bestCast = cast;
    }
  }

  const { multiplier, tier } = calculateYapMultiplier({ castCount, totalLikes, totalRecasts });

  const stats: YapStats = {
    fid,
    username,
    address,
    castCount,
    totalLikes,
    totalRecasts,
    bestCastHash: bestCast?.hash,
    bestCastLikes: bestCast?.likes,
    bestCastRecasts: bestCast?.recasts,
    multiplier,
    multiplierTier: tier,
    lastUpdatedAt: Date.now(),
    castsChecked: casts.map((c) => c.hash)
  };

  // Save to KV
  if (isKvConfigured) {
    try {
      const allData = await getYapData();
      allData[fid.toString()] = stats;
      await kv.set(YAP_DATA_KEY, allData);
    } catch (err) {
      console.error('[yapMultiplier] Failed to save stats:', err);
    }
  }

  return stats;
}

// Get all yap data
export async function getYapData(): Promise<Record<string, YapStats>> {
  if (!isKvConfigured) return {};
  try {
    const data = await kv.get<Record<string, YapStats>>(YAP_DATA_KEY);
    return data ?? {};
  } catch {
    return {};
  }
}

// Get yap stats for a specific FID
export async function getYapStats(fid: number): Promise<YapStats | null> {
  const data = await getYapData();
  return data[fid.toString()] ?? null;
}

// Build yap leaderboard
export async function buildYapLeaderboard(): Promise<YapLeaderboard> {
  const data = await getYapData();
  const allStats = Object.values(data);

  // Sort by multiplier, then by cast count
  const sorted = allStats
    .filter((s) => s.multiplier > 1)
    .sort((a, b) => {
      if (b.multiplier !== a.multiplier) return b.multiplier - a.multiplier;
      return b.castCount - a.castCount;
    });

  const leaderboard: YapLeaderboard = {
    updatedAt: new Date().toISOString(),
    topYappers: sorted.slice(0, 20),
    totalQualifiedYappers: sorted.length
  };

  if (isKvConfigured) {
    try {
      await kv.set(YAP_LEADERBOARD_KEY, leaderboard);
    } catch (err) {
      console.error('[yapMultiplier] Failed to save leaderboard:', err);
    }
  }

  return leaderboard;
}

// Get cached yap leaderboard
export async function getYapLeaderboard(): Promise<YapLeaderboard | null> {
  if (!isKvConfigured) return null;
  try {
    return await kv.get<YapLeaderboard>(YAP_LEADERBOARD_KEY);
  } catch {
    return null;
  }
}

// Get multiplier for applying to points
export async function getMultiplierForFid(fid: number): Promise<number> {
  const stats = await getYapStats(fid);
  return stats?.multiplier ?? 1;
}
