/**
 * Daily Check-In System for m00n
 *
 * Inspired by BR's "Creativity as a variable resource" concept:
 * - Users "check in" daily to boost their creative energy
 * - Consistent check-ins build a streak (like rest/rhythm for creativity)
 * - Streak multiplier: rewards sustained engagement without burnout
 *
 * Multiplier tiers:
 * - 1x: No check-ins
 * - 1.1x: 1-2 days streak
 * - 1.25x: 3-6 days streak
 * - 1.5x: 7-13 days streak (1 week)
 * - 1.75x: 14-29 days streak (2 weeks)
 * - 2x: 30+ days streak (1 month) 🌙
 */

import { kv } from '@vercel/kv';

// KV keys
const CHECKIN_DATA_KEY = 'm00n:checkin:data';
const CHECKIN_LEADERBOARD_KEY = 'm00n:checkin:leaderboard';

// Check if KV is configured
const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

// Grace period: allow missing 1 day without breaking streak
const STREAK_GRACE_HOURS = 48; // 48 hours to check in without losing streak

export interface CheckInStats {
  fid: number;
  username: string;
  address?: string;

  // Check-in tracking
  currentStreak: number; // Days in a row
  longestStreak: number; // Best streak ever
  totalCheckIns: number; // Lifetime check-ins

  // Timestamps
  lastCheckInAt: number; // Unix timestamp
  streakStartedAt: number; // When current streak began
  firstCheckInAt: number; // First ever check-in

  // Calculated multiplier
  multiplier: number;
  multiplierTier: string;

  // Next check-in window
  nextCheckInAvailableAt: number; // When user can check in again
  streakExpiresAt: number; // When streak will break if no check-in
}

export interface CheckInLeaderboard {
  updatedAt: string;
  topStreakers: CheckInStats[];
  totalActiveUsers: number;
}

export interface CheckInResult {
  success: boolean;
  message: string;
  stats: CheckInStats;
  isNewStreak?: boolean;
  streakBroken?: boolean;
  reward?: {
    type: 'streak_milestone' | 'first_checkin' | 'weekly' | 'monthly';
    message: string;
  };
}

// Calculate multiplier based on streak
export function calculateCheckInMultiplier(streak: number): {
  multiplier: number;
  tier: string;
} {
  if (streak >= 30) {
    return { multiplier: 2.0, tier: '🌙 MOON RHYTHM' };
  }
  if (streak >= 14) {
    return { multiplier: 1.75, tier: '💫 DEEP FLOW' };
  }
  if (streak >= 7) {
    return { multiplier: 1.5, tier: '⭐ STEADY' };
  }
  if (streak >= 3) {
    return { multiplier: 1.25, tier: '✨ WARMING UP' };
  }
  if (streak >= 1) {
    return { multiplier: 1.1, tier: '🌱 STARTED' };
  }
  return { multiplier: 1, tier: '—' };
}

// Get start of day in UTC
function getStartOfDayUTC(timestamp: number): number {
  const date = new Date(timestamp);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

// Check if user can check in (new day started)
export function canCheckIn(lastCheckInAt: number | null): {
  canCheckIn: boolean;
  nextAvailableAt: number;
  hoursUntilAvailable: number;
} {
  if (!lastCheckInAt) {
    return { canCheckIn: true, nextAvailableAt: Date.now(), hoursUntilAvailable: 0 };
  }

  const now = Date.now();
  const todayStart = getStartOfDayUTC(now);
  const lastCheckInDay = getStartOfDayUTC(lastCheckInAt);

  // Can check in if it's a new day
  if (todayStart > lastCheckInDay) {
    return { canCheckIn: true, nextAvailableAt: now, hoursUntilAvailable: 0 };
  }

  // Next check-in is tomorrow
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const hoursUntil = (tomorrowStart - now) / (60 * 60 * 1000);

  return {
    canCheckIn: false,
    nextAvailableAt: tomorrowStart,
    hoursUntilAvailable: Math.ceil(hoursUntil)
  };
}

// Check if streak is still valid
export function isStreakValid(lastCheckInAt: number): boolean {
  const now = Date.now();
  const hoursSinceLastCheckIn = (now - lastCheckInAt) / (60 * 60 * 1000);
  return hoursSinceLastCheckIn <= STREAK_GRACE_HOURS;
}

// Get all check-in data
export async function getCheckInData(): Promise<Record<string, CheckInStats>> {
  if (!isKvConfigured) return {};
  try {
    const data = await kv.get<Record<string, CheckInStats>>(CHECKIN_DATA_KEY);
    return data ?? {};
  } catch {
    return {};
  }
}

// Get check-in stats for a specific FID
export async function getCheckInStats(fid: number): Promise<CheckInStats | null> {
  const data = await getCheckInData();
  const stats = data[fid.toString()] ?? null;

  // If stats exist, check if streak is still valid
  if (stats && stats.lastCheckInAt) {
    if (!isStreakValid(stats.lastCheckInAt)) {
      // Streak has expired but don't update KV here - just report it
      return {
        ...stats,
        currentStreak: 0,
        multiplier: 1,
        multiplierTier: '—'
      };
    }
  }

  return stats;
}

// Perform a check-in
export async function performCheckIn(
  fid: number,
  username: string,
  address?: string
): Promise<CheckInResult> {
  const now = Date.now();
  const data = await getCheckInData();
  const existing = data[fid.toString()];

  // Check if user can check in today
  const { canCheckIn: canDoCheckIn, hoursUntilAvailable } = canCheckIn(
    existing?.lastCheckInAt ?? null
  );

  if (!canDoCheckIn) {
    return {
      success: false,
      message: `Already checked in today! Come back in ${hoursUntilAvailable}h`,
      stats: existing!
    };
  }

  let newStreak = 1;
  let isNewStreak = false;
  let streakBroken = false;
  let reward: CheckInResult['reward'];

  if (existing) {
    // Check if streak is still valid
    if (isStreakValid(existing.lastCheckInAt)) {
      // Continue streak
      newStreak = existing.currentStreak + 1;
    } else {
      // Streak broken - start fresh
      newStreak = 1;
      streakBroken = true;
      isNewStreak = true;
    }
  } else {
    // First check-in ever
    isNewStreak = true;
    reward = {
      type: 'first_checkin',
      message: '🎉 First check-in! Welcome to the rhythm.'
    };
  }

  // Check for milestone rewards
  if (!reward) {
    if (newStreak === 7) {
      reward = {
        type: 'weekly',
        message: '🌟 One week streak! You are finding your rhythm.'
      };
    } else if (newStreak === 30) {
      reward = {
        type: 'monthly',
        message: '🌙 MOON RHYTHM achieved! 30 days of consistency!'
      };
    } else if (newStreak % 10 === 0) {
      reward = {
        type: 'streak_milestone',
        message: `🔥 ${newStreak} day streak! Keep the energy flowing.`
      };
    }
  }

  const { multiplier, tier } = calculateCheckInMultiplier(newStreak);
  const todayStart = getStartOfDayUTC(now);
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;

  const stats: CheckInStats = {
    fid,
    username,
    address,
    currentStreak: newStreak,
    longestStreak: Math.max(newStreak, existing?.longestStreak ?? 0),
    totalCheckIns: (existing?.totalCheckIns ?? 0) + 1,
    lastCheckInAt: now,
    streakStartedAt: isNewStreak ? now : (existing?.streakStartedAt ?? now),
    firstCheckInAt: existing?.firstCheckInAt ?? now,
    multiplier,
    multiplierTier: tier,
    nextCheckInAvailableAt: tomorrowStart,
    streakExpiresAt: now + STREAK_GRACE_HOURS * 60 * 60 * 1000
  };

  // Save to KV
  if (isKvConfigured) {
    try {
      data[fid.toString()] = stats;
      await kv.set(CHECKIN_DATA_KEY, data);
    } catch (err) {
      console.error('[dailyCheckIn] Failed to save check-in:', err);
    }
  }

  return {
    success: true,
    message: streakBroken
      ? `Streak reset! Starting fresh with day 1.`
      : newStreak === 1
        ? `First check-in of your streak! 🌱`
        : `Day ${newStreak} complete! ${tier}`,
    stats,
    isNewStreak,
    streakBroken,
    reward
  };
}

// Build check-in leaderboard
export async function buildCheckInLeaderboard(): Promise<CheckInLeaderboard> {
  const data = await getCheckInData();
  const allStats = Object.values(data);

  // Filter for active users (checked in within grace period)
  const now = Date.now();
  const activeStats = allStats.filter((s) => isStreakValid(s.lastCheckInAt));

  // Sort by current streak (highest first)
  const sorted = activeStats.sort((a, b) => {
    if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak;
    return b.totalCheckIns - a.totalCheckIns;
  });

  const leaderboard: CheckInLeaderboard = {
    updatedAt: new Date().toISOString(),
    topStreakers: sorted.slice(0, 20),
    totalActiveUsers: activeStats.length
  };

  if (isKvConfigured) {
    try {
      await kv.set(CHECKIN_LEADERBOARD_KEY, leaderboard);
    } catch (err) {
      console.error('[dailyCheckIn] Failed to save leaderboard:', err);
    }
  }

  return leaderboard;
}

// Get cached leaderboard
export async function getCheckInLeaderboard(): Promise<CheckInLeaderboard | null> {
  if (!isKvConfigured) return null;
  try {
    return await kv.get<CheckInLeaderboard>(CHECKIN_LEADERBOARD_KEY);
  } catch {
    return null;
  }
}

// Format time until next check-in
export function formatTimeUntilCheckIn(nextAvailableAt: number): string {
  const now = Date.now();
  const diff = nextAvailableAt - now;

  if (diff <= 0) return 'Available now!';

  const hours = Math.floor(diff / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
