/**
 * Streak Tracker for LP Positions
 *
 * Tracks how long each position stays in-range continuously.
 * Points are awarded based on streak duration.
 */

import { kv } from '@vercel/kv';
import { getTopM00nLpPositions } from '@/app/lib/m00nSolarSystem.server';
import type { LpPosition } from '@/app/lib/m00nSolarSystem.types';
import { getAddressLabel } from '@/app/lib/addressLabels';

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
  checkCount: number; // number of times we've checked this position
  lastCheckedAt: number; // last update timestamp

  // Current state
  isCurrentlyInRange: boolean;
  rangeStatus: 'below-range' | 'in-range' | 'above-range';

  // Position details for display
  valueUsd?: number;
  tickLower?: number;
  tickUpper?: number;

  // Points calculation
  points: number;
}

export interface StreakLeaderboardEntry {
  tokenId: string;
  owner: string;
  label?: string | null;
  currentStreakDuration: number;
  longestStreakDuration: number;
  isCurrentlyInRange: boolean;
  points: number;
  valueUsd?: number;
  rank?: number;
}

export interface StreakLeaderboard {
  updatedAt: string;
  lastCheckAt: string;
  totalPositionsTracked: number;
  entries: StreakLeaderboardEntry[];
  topStreaks: StreakLeaderboardEntry[]; // Sorted by current streak
  topAllTime: StreakLeaderboardEntry[]; // Sorted by longest streak ever
  topPoints: StreakLeaderboardEntry[]; // Sorted by total points
}

// -----------------------------
// Constants
// -----------------------------

const STREAK_DATA_KEY = 'm00n:lp-streaks';
const STREAK_LEADERBOARD_KEY = 'm00n:lp-streak-leaderboard';
const STREAK_LAST_CHECK_KEY = 'm00n:lp-streak-last-check';

// Points formula constants
const POINTS_PER_HOUR_IN_RANGE = 10;
const POINTS_BONUS_PER_DAY_STREAK = 50; // Bonus for maintaining streak
const POINTS_MULTIPLIER_WEEK_STREAK = 2; // 2x points after 7 days continuous

const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

// -----------------------------
// Points Calculation
// -----------------------------

function calculatePoints(streak: PositionStreak): number {
  const hoursInRange = streak.totalInRangeTime / 3600;
  const basePoints = hoursInRange * POINTS_PER_HOUR_IN_RANGE;

  // Current streak bonus
  const currentStreakDays = streak.currentStreakDuration / 86400;
  const streakBonus = Math.floor(currentStreakDays) * POINTS_BONUS_PER_DAY_STREAK;

  // Week streak multiplier
  const weekMultiplier = currentStreakDays >= 7 ? POINTS_MULTIPLIER_WEEK_STREAK : 1;

  return Math.floor((basePoints + streakBonus) * weekMultiplier);
}

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
}> {
  const now = Date.now();
  const lastCheck = await getLastCheckTimestamp();
  const timeSinceLastCheck = lastCheck ? (now - lastCheck) / 1000 : 0;

  // Fetch current positions
  const positions = await getTopM00nLpPositions(200); // Get top 200 positions

  // Load existing streak data
  const streakData = await getStreakData();

  let updated = 0;
  let newPositions = 0;
  let streaksStarted = 0;
  let streaksEnded = 0;

  for (const position of positions) {
    const tokenId = position.tokenId;
    const isInRange = position.rangeStatus === 'in-range';
    const existing = streakData[tokenId];

    if (!existing) {
      // New position - initialize tracking
      newPositions++;
      const streak: PositionStreak = {
        tokenId,
        owner: position.owner,
        label: position.label ?? getAddressLabel(position.owner),
        currentStreakStartedAt: isInRange ? now : null,
        currentStreakDuration: 0,
        longestStreakDuration: 0,
        longestStreakEndedAt: null,
        totalInRangeTime: 0,
        totalOutOfRangeTime: 0,
        checkCount: 1,
        lastCheckedAt: now,
        isCurrentlyInRange: isInRange,
        rangeStatus: position.rangeStatus ?? 'in-range',
        valueUsd: position.notionalUsd,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        points: 0
      };

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

      // Recalculate points
      existing.points = calculatePoints(existing);
    }
  }

  // Persist updated data
  await kvSafeSet(STREAK_DATA_KEY, streakData);
  await kvSafeSet(STREAK_LAST_CHECK_KEY, now);

  return { updated, newPositions, streaksStarted, streaksEnded };
}

// -----------------------------
// Leaderboard Building
// -----------------------------

export async function buildStreakLeaderboard(): Promise<StreakLeaderboard> {
  const streakData = await getStreakData();
  const lastCheck = await getLastCheckTimestamp();

  const allEntries: StreakLeaderboardEntry[] = Object.values(streakData)
    .filter((streak) => streak.checkCount > 0)
    .map((streak) => ({
      tokenId: streak.tokenId,
      owner: streak.owner,
      label: streak.label,
      currentStreakDuration: streak.currentStreakDuration,
      longestStreakDuration: streak.longestStreakDuration,
      isCurrentlyInRange: streak.isCurrentlyInRange,
      points: streak.points,
      valueUsd: streak.valueUsd
    }));

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

  const leaderboard: StreakLeaderboard = {
    updatedAt: new Date().toISOString(),
    lastCheckAt: lastCheck ? new Date(lastCheck).toISOString() : new Date().toISOString(),
    totalPositionsTracked: allEntries.length,
    entries: allEntries,
    topStreaks,
    topAllTime,
    topPoints
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
// Admin: Reset all streaks
// -----------------------------

export async function resetAllStreaks(): Promise<void> {
  await kvSafeSet(STREAK_DATA_KEY, {});
  await kvSafeSet(STREAK_LEADERBOARD_KEY, null);
  await kvSafeSet(STREAK_LAST_CHECK_KEY, null);
}
