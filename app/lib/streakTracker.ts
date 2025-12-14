/**
 * Streak Tracker for LP Positions
 *
 * Tracks how long each position stays in-range continuously.
 * Points are calculated using weighted formula:
 * - 50% weight: Notional USD value
 * - 30% weight: Streak duration (days)
 * - 20% weight: Total time in range (hours)
 */

import { kv } from '@vercel/kv';
import { getTopM00nLpPositions } from '@/app/lib/m00nSolarSystem.server';
import type { LpPosition } from '@/app/lib/m00nSolarSystem.types';
import { getAddressLabel } from '@/app/lib/addressLabels';
import { calculateWeightedPoints, getStreakTier, getCurrentSeason } from '@/app/lib/tokenomics';

// Clanker pool should never appear in leaderboards
const CLANKER_TOKEN_ID = '6914';

// -----------------------------
// Types
// -----------------------------

export interface PositionStreak {
  tokenId: string;
  owner: string;
  label?: string | null;

  // Streak tracking
  currentStreakStartedAt: number | null; // timestamp when current in-range streak started
  currentStreakDuration: number; // seconds currently in-range
  longestStreakDuration: number; // best streak ever (seconds)
  longestStreakEndedAt: number | null; // when the best streak ended

  // Stats
  totalInRangeTime: number; // cumulative seconds in-range
  totalOutOfRangeTime: number; // cumulative seconds out-of-range
  totalPositionAge?: number; // total age since creation (regardless of range)
  createdAtTimestamp?: number; // when position was created
  checkCount: number; // number of times we've checked this position
  lastCheckedAt: number; // last update timestamp

  // Current state
  isCurrentlyInRange: boolean;
  rangeStatus: 'below-range' | 'in-range' | 'above-range';

  // Position details for display
  valueUsd?: number;
  tickLower?: number;
  tickUpper?: number;

  // Points calculation (weighted)
  points: number;
  pointsBreakdown?: {
    notionalPoints: number;
    streakPoints: number;
    timePoints: number;
  };

  // Tier info
  tier?: {
    name: string;
    emoji: string;
    multiplier: number;
  };

  // Season tracking
  seasonId?: string;
}

export interface StreakLeaderboardEntry {
  tokenId: string;
  owner: string;
  label?: string | null;
  currentStreakDuration: number;
  longestStreakDuration: number;
  isCurrentlyInRange: boolean;
  points: number;
  pointsBreakdown?: {
    notionalPoints: number;
    streakPoints: number;
    timePoints: number;
  };
  valueUsd?: number;
  rank?: number;
  tier?: {
    name: string;
    emoji: string;
    multiplier: number;
  };
}

export interface StreakLeaderboard {
  updatedAt: string;
  lastCheckAt: string;
  seasonId: string;
  totalPositionsTracked: number;
  totalSystemPoints: number;
  entries: StreakLeaderboardEntry[];
  topStreaks: StreakLeaderboardEntry[]; // Sorted by current streak
  topAllTime: StreakLeaderboardEntry[]; // Sorted by longest streak ever
  topPoints: StreakLeaderboardEntry[]; // Sorted by total points
  topNotional: StreakLeaderboardEntry[]; // Sorted by notional value
}

// -----------------------------
// Constants
// -----------------------------

const STREAK_DATA_KEY = 'm00n:lp-streaks';
const STREAK_LEADERBOARD_KEY = 'm00n:lp-streak-leaderboard';
const STREAK_LAST_CHECK_KEY = 'm00n:lp-streak-last-check';

const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

// -----------------------------
// Duration formatting
// -----------------------------

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

// -----------------------------
// KV Operations
// -----------------------------

async function kvSafeGet<T>(key: string): Promise<T | null> {
  if (!isKvConfigured) return null;
  try {
    return ((await kv.get<T>(key)) as T | null) ?? null;
  } catch (error) {
    console.error(`[streakTracker] Failed to read ${key} from KV`, error);
    return null;
  }
}

async function kvSafeSet<T>(key: string, value: T): Promise<void> {
  if (!isKvConfigured) return;
  try {
    await kv.set(key, value);
  } catch (error) {
    console.error(`[streakTracker] Failed to persist ${key} to KV`, error);
  }
}

// -----------------------------
// Core Tracking Logic
// -----------------------------

export async function getStreakData(): Promise<Record<string, PositionStreak>> {
  const data = await kvSafeGet<Record<string, PositionStreak>>(STREAK_DATA_KEY);
  return data ?? {};
}

export async function getLastCheckTimestamp(): Promise<number | null> {
  return await kvSafeGet<number>(STREAK_LAST_CHECK_KEY);
}

export async function updateStreaks(): Promise<{
  updated: number;
  newPositions: number;
  streaksStarted: number;
  streaksEnded: number;
  totalPoints: number;
}> {
  const now = Date.now();
  const lastCheck = await getLastCheckTimestamp();
  const timeSinceLastCheck = lastCheck ? (now - lastCheck) / 1000 : 0;

  // Get current season
  const currentSeason = await getCurrentSeason();
  const seasonId = currentSeason?.id ?? 'season-1';

  // Fetch current positions
  const positions = await getTopM00nLpPositions(200); // Get top 200 positions

  // Load existing streak data
  const streakData = await getStreakData();

  // Clanker pool should not appear on leaderboard
  const CLANKER_TOKEN_ID = '6914';

  let updated = 0;
  let newPositions = 0;
  let streaksStarted = 0;
  let streaksEnded = 0;
  let totalPoints = 0;

  for (const position of positions) {
    const tokenId = position.tokenId;

    // Skip Clanker pool
    if (tokenId === CLANKER_TOKEN_ID || position.isClankerPool) {
      continue;
    }

    // Skip positions with value < $5
    if (position.notionalUsd < 5) {
      continue;
    }

    const isInRange = position.rangeStatus === 'in-range';
    const existing = streakData[tokenId];

    if (!existing) {
      // New position - initialize tracking
      newPositions++;

      // Calculate total position age from creation timestamp
      // All positions get credit for their age, regardless of range status
      let totalPositionAge = 0;
      if (position.createdAtTimestamp) {
        totalPositionAge = now - position.createdAtTimestamp;
        // Sanity check - don't exceed 1 year
        if (totalPositionAge > 365 * 24 * 3600) {
          totalPositionAge = 365 * 24 * 3600;
        }
      }

      // In-range streak is separate from total age
      let initialStreakDuration = 0;
      let initialTotalInRange = 0;
      if (isInRange && position.createdAtTimestamp) {
        // Assume in-range since creation for simplicity
        initialStreakDuration = totalPositionAge;
        initialTotalInRange = totalPositionAge;
      }

      const streakDays = Math.floor(totalPositionAge / 86400);
      const tier = getStreakTier(streakDays);

      const streak: PositionStreak = {
        tokenId,
        owner: position.owner,
        label: position.label ?? getAddressLabel(position.owner),
        currentStreakStartedAt: isInRange ? (position.createdAtTimestamp ?? now) : null,
        currentStreakDuration: initialStreakDuration,
        longestStreakDuration: initialStreakDuration,
        longestStreakEndedAt: null,
        totalInRangeTime: initialTotalInRange,
        totalOutOfRangeTime: isInRange ? 0 : totalPositionAge,
        totalPositionAge, // Track total age regardless of range
        createdAtTimestamp: position.createdAtTimestamp ?? now,
        checkCount: 1,
        lastCheckedAt: now,
        isCurrentlyInRange: isInRange,
        rangeStatus: position.rangeStatus ?? 'in-range',
        valueUsd: position.notionalUsd,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        points: 0,
        pointsBreakdown: { notionalPoints: 0, streakPoints: 0, timePoints: 0 },
        tier,
        seasonId
      };

      // Calculate initial points based on position age
      const initialPointsResult = calculateWeightedPoints({
        notionalUsd: streak.valueUsd ?? 0,
        streakDurationSeconds: totalPositionAge, // Use total age
        totalInRangeSeconds: initialTotalInRange,
        isCurrentlyInRange: isInRange
      });

      streak.points = initialPointsResult.total;
      streak.pointsBreakdown = initialPointsResult.breakdown;
      totalPoints += streak.points;

      if (isInRange) {
        streaksStarted++;
      }

      streakData[tokenId] = streak;
    } else {
      // Existing position - update tracking
      updated++;

      const wasInRange = existing.isCurrentlyInRange;

      // Update cumulative time
      if (timeSinceLastCheck > 0) {
        if (wasInRange) {
          existing.totalInRangeTime += timeSinceLastCheck;
          existing.currentStreakDuration += timeSinceLastCheck;
        } else {
          existing.totalOutOfRangeTime += timeSinceLastCheck;
        }
      }

      // Check for state change
      if (isInRange && !wasInRange) {
        // Started a new streak!
        streaksStarted++;
        existing.currentStreakStartedAt = now;
        existing.currentStreakDuration = 0;
      } else if (!isInRange && wasInRange) {
        // Streak ended
        streaksEnded++;

        // Check if this was longest streak
        if (existing.currentStreakDuration > existing.longestStreakDuration) {
          existing.longestStreakDuration = existing.currentStreakDuration;
          existing.longestStreakEndedAt = now;
        }

        existing.currentStreakStartedAt = null;
        existing.currentStreakDuration = 0;
      }

      // Update state
      existing.isCurrentlyInRange = isInRange;
      existing.rangeStatus = position.rangeStatus ?? 'in-range';
      existing.lastCheckedAt = now;
      existing.checkCount++;
      existing.owner = position.owner;
      existing.label = position.label ?? getAddressLabel(position.owner);
      existing.valueUsd = position.notionalUsd;
      existing.tickLower = position.tickLower;
      existing.tickUpper = position.tickUpper;
      existing.seasonId = seasonId;

      // Update total position age from creation timestamp
      if (existing.createdAtTimestamp) {
        existing.totalPositionAge = Math.min(now - existing.createdAtTimestamp, 365 * 24 * 3600);
      } else if (position.createdAtTimestamp) {
        existing.createdAtTimestamp = position.createdAtTimestamp;
        existing.totalPositionAge = Math.min(now - position.createdAtTimestamp, 365 * 24 * 3600);
      }

      // Calculate weighted points using total position age (not just in-range time)
      const positionAgeDays = (existing.totalPositionAge ?? 0) / 86400;
      existing.tier = getStreakTier(positionAgeDays);

      const pointsResult = calculateWeightedPoints({
        notionalUsd: existing.valueUsd ?? 0,
        streakDurationSeconds: existing.totalPositionAge ?? 0, // Use total age, not just streak
        totalInRangeSeconds: existing.totalInRangeTime,
        isCurrentlyInRange: existing.isCurrentlyInRange
      });

      existing.points = pointsResult.total;
      existing.pointsBreakdown = pointsResult.breakdown;

      totalPoints += existing.points;
    }
  }

  // Persist updated data
  await kvSafeSet(STREAK_DATA_KEY, streakData);
  await kvSafeSet(STREAK_LAST_CHECK_KEY, now);

  return { updated, newPositions, streaksStarted, streaksEnded, totalPoints };
}

// -----------------------------
// Leaderboard Building
// -----------------------------

export async function buildStreakLeaderboard(): Promise<StreakLeaderboard> {
  const streakData = await getStreakData();
  const lastCheck = await getLastCheckTimestamp();
  const currentSeason = await getCurrentSeason();
  const seasonId = currentSeason?.id ?? 'season-1';

  // Get all qualifying positions
  const qualifyingPositions = Object.values(streakData).filter(
    (streak) =>
      streak.checkCount > 0 && (streak.valueUsd ?? 0) >= 5 && streak.tokenId !== CLANKER_TOKEN_ID
  );

  // Aggregate positions by owner address
  // IMPORTANT: We aggregate raw metrics first, then calculate points ONCE
  // This prevents gaming by splitting into multiple small positions
  const ownerAggregates = new Map<
    string,
    {
      owner: string;
      label: string;
      positions: string[]; // tokenIds
      totalValueUsd: number;
      // For time/streak, we use VALUE-WEIGHTED averages, not just best
      weightedStreakSeconds: number; // sum of (valueUsd * streakSeconds) for each position
      weightedTimeSeconds: number; // sum of (valueUsd * ageSeconds) for each position
      hasAnyInRange: boolean;
      inRangeValueUsd: number; // total value that is in-range (for bonus calc)
      bestTier?: { name: string; emoji: string; multiplier: number };
    }
  >();

  for (const streak of qualifyingPositions) {
    const posValue = streak.valueUsd ?? 0;
    const existing = ownerAggregates.get(streak.owner);

    if (existing) {
      // Aggregate with existing
      existing.positions.push(streak.tokenId);
      existing.totalValueUsd += posValue;
      // Value-weighted streak and time
      existing.weightedStreakSeconds += posValue * streak.currentStreakDuration;
      existing.weightedTimeSeconds +=
        posValue * (streak.totalPositionAge ?? streak.currentStreakDuration);
      existing.hasAnyInRange = existing.hasAnyInRange || streak.isCurrentlyInRange;
      if (streak.isCurrentlyInRange) {
        existing.inRangeValueUsd += posValue;
      }
      // Keep best tier
      if (
        streak.tier &&
        (!existing.bestTier || streak.tier.multiplier > existing.bestTier.multiplier)
      ) {
        existing.bestTier = streak.tier;
      }
    } else {
      // Create new entry
      ownerAggregates.set(streak.owner, {
        owner: streak.owner,
        label: streak.label ?? streak.owner.slice(0, 6) + '...' + streak.owner.slice(-4),
        positions: [streak.tokenId],
        totalValueUsd: posValue,
        weightedStreakSeconds: posValue * streak.currentStreakDuration,
        weightedTimeSeconds: posValue * (streak.totalPositionAge ?? streak.currentStreakDuration),
        hasAnyInRange: streak.isCurrentlyInRange,
        inRangeValueUsd: streak.isCurrentlyInRange ? posValue : 0,
        bestTier: streak.tier
      });
    }
  }

  // Convert aggregates to leaderboard entries (one per owner)
  // Calculate points from AGGREGATED totals, not sum of individual points
  const allEntries: StreakLeaderboardEntry[] = Array.from(ownerAggregates.values()).map((agg) => {
    // Calculate value-weighted averages
    const avgStreakSeconds =
      agg.totalValueUsd > 0 ? agg.weightedStreakSeconds / agg.totalValueUsd : 0;
    const avgTimeSeconds = agg.totalValueUsd > 0 ? agg.weightedTimeSeconds / agg.totalValueUsd : 0;

    // Calculate in-range bonus (proportional to how much value is in-range)
    const inRangeRatio = agg.totalValueUsd > 0 ? agg.inRangeValueUsd / agg.totalValueUsd : 0;
    // Bonus ranges from 1.0 (0% in range) to 1.2 (100% in range)
    const inRangeMultiplier = 1 + 0.2 * inRangeRatio;

    // Points formula: 50% value + 30% streak + 20% time
    // Applied to TOTALS, not per-position
    const notionalPoints = Math.floor(agg.totalValueUsd * 100); // $1 = 100 base points
    const streakPoints = Math.floor(avgStreakSeconds / 3600); // 1 point per hour of avg streak
    const timePoints = Math.floor(avgTimeSeconds / 3600); // 1 point per hour of avg age

    const rawPoints = Math.floor(notionalPoints * 0.5 + streakPoints * 0.3 + timePoints * 0.2);

    const finalPoints = Math.floor(rawPoints * inRangeMultiplier);

    return {
      tokenId: agg.positions.length === 1 ? agg.positions[0] : `${agg.positions.length} positions`,
      owner: agg.owner,
      label: agg.label,
      currentStreakDuration: Math.floor(avgStreakSeconds),
      longestStreakDuration: Math.floor(avgStreakSeconds), // Using avg for consistency
      isCurrentlyInRange: agg.hasAnyInRange,
      points: finalPoints,
      pointsBreakdown: {
        notionalPoints: Math.floor(notionalPoints * 0.5),
        streakPoints: Math.floor(streakPoints * 0.3),
        timePoints: Math.floor(timePoints * 0.2)
      },
      valueUsd: agg.totalValueUsd,
      tier: agg.bestTier
    };
  });

  const totalSystemPoints = allEntries.reduce((sum, e) => sum + e.points, 0);

  // Sort by current streak for "🔥 Hot Streaks"
  const topStreaks = [...allEntries]
    .filter((e) => e.isCurrentlyInRange && e.currentStreakDuration > 0)
    .sort((a, b) => b.currentStreakDuration - a.currentStreakDuration)
    .slice(0, 10)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  // Sort by longest streak ever for "🏆 All-Time Legends"
  const topAllTime = [...allEntries]
    .filter((e) => e.longestStreakDuration > 0)
    .sort((a, b) => b.longestStreakDuration - a.longestStreakDuration)
    .slice(0, 10)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  // Sort by points for "⭐ Top Earners"
  const topPoints = [...allEntries]
    .filter((e) => e.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 10)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  // Sort by notional value for "💰 Top Whales"
  const topNotional = [...allEntries]
    .filter((e) => (e.valueUsd ?? 0) > 0)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
    .slice(0, 10)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const leaderboard: StreakLeaderboard = {
    updatedAt: new Date().toISOString(),
    lastCheckAt: lastCheck ? new Date(lastCheck).toISOString() : new Date().toISOString(),
    seasonId,
    totalPositionsTracked: allEntries.length,
    totalSystemPoints,
    entries: allEntries,
    topStreaks,
    topAllTime,
    topPoints,
    topNotional
  };

  // Persist leaderboard
  await kvSafeSet(STREAK_LEADERBOARD_KEY, leaderboard);

  return leaderboard;
}

export async function getStreakLeaderboard(): Promise<StreakLeaderboard | null> {
  return await kvSafeGet<StreakLeaderboard>(STREAK_LEADERBOARD_KEY);
}

// -----------------------------
// Get streak for specific position
// -----------------------------

export async function getPositionStreak(tokenId: string): Promise<PositionStreak | null> {
  const data = await getStreakData();
  return data[tokenId] ?? null;
}

// -----------------------------
// Get all streaks for an owner
// -----------------------------

export async function getOwnerStreaks(ownerAddress: string): Promise<PositionStreak[]> {
  const data = await getStreakData();
  const lowerAddress = ownerAddress.toLowerCase();
  return Object.values(data).filter((streak) => streak.owner.toLowerCase() === lowerAddress);
}

// -----------------------------
// Get owner aggregate stats
// -----------------------------

export async function getOwnerStats(ownerAddress: string): Promise<{
  positionCount: number;
  totalPoints: number;
  totalNotionalUsd: number;
  bestStreakDays: number;
  totalHoursInRange: number;
  breakdown: {
    notionalPoints: number;
    streakPoints: number;
    timePoints: number;
  };
  tier: { name: string; emoji: string; multiplier: number };
} | null> {
  const streaks = await getOwnerStreaks(ownerAddress);
  if (streaks.length === 0) return null;

  const totalPoints = streaks.reduce((sum, s) => sum + s.points, 0);
  const totalNotionalUsd = streaks.reduce((sum, s) => sum + (s.valueUsd ?? 0), 0);
  const bestStreakSeconds = Math.max(...streaks.map((s) => s.currentStreakDuration));
  const bestStreakDays = bestStreakSeconds / 86400;
  const totalHoursInRange = streaks.reduce((sum, s) => sum + s.totalInRangeTime, 0) / 3600;

  const breakdown = streaks.reduce(
    (acc, s) => {
      const pb = s.pointsBreakdown ?? { notionalPoints: 0, streakPoints: 0, timePoints: 0 };
      return {
        notionalPoints: acc.notionalPoints + pb.notionalPoints,
        streakPoints: acc.streakPoints + pb.streakPoints,
        timePoints: acc.timePoints + pb.timePoints
      };
    },
    { notionalPoints: 0, streakPoints: 0, timePoints: 0 }
  );

  const tier = getStreakTier(bestStreakDays);

  return {
    positionCount: streaks.length,
    totalPoints,
    totalNotionalUsd,
    bestStreakDays: Math.floor(bestStreakDays),
    totalHoursInRange: Math.floor(totalHoursInRange),
    breakdown,
    tier
  };
}

// -----------------------------
// Admin: Reset all streaks
// -----------------------------

export async function resetAllStreaks(): Promise<void> {
  await kvSafeSet(STREAK_DATA_KEY, {});
  await kvSafeSet(STREAK_LEADERBOARD_KEY, null);
  await kvSafeSet(STREAK_LAST_CHECK_KEY, null);
}

// -----------------------------
// Admin: Reset streaks for new season
// -----------------------------

export async function resetStreaksForNewSeason(newSeasonId: string): Promise<{
  positionsReset: number;
}> {
  const streakData = await getStreakData();
  let positionsReset = 0;

  for (const tokenId of Object.keys(streakData)) {
    const streak = streakData[tokenId];
    // Reset points but keep streak tracking
    streak.points = 0;
    streak.pointsBreakdown = { notionalPoints: 0, streakPoints: 0, timePoints: 0 };
    streak.seasonId = newSeasonId;
    positionsReset++;
  }

  await kvSafeSet(STREAK_DATA_KEY, streakData);
  await kvSafeSet(STREAK_LEADERBOARD_KEY, null);

  return { positionsReset };
}
