/**
 * Harvest Tracking System for m00n
 *
 * Tracks fee harvests from LP positions and awards bonus points based on:
 * - Harvest value (USD)
 * - User's Ascension tier (harvest multiplier)
 *
 * Weekly harvest points contribute to seasonal allocation.
 */

import { kv } from '@vercel/kv';
import { getHarvestMultiplier, type AscensionTier, TIER_DEFINITIONS } from './ascension';

// KV keys
const HARVEST_DATA_KEY = 'm00n:harvests:data';
const HARVEST_WEEKLY_KEY = (weekId: string) => `m00n:harvests:week:${weekId}`;
const HARVEST_USER_WEEKLY_KEY = (fid: number, weekId: string) =>
  `m00n:harvests:user:${fid}:week:${weekId}`;
const HARVEST_TOTALS_KEY = 'm00n:harvests:totals';

// Check if KV is configured
const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

// Points per dollar harvested (base rate)
const POINTS_PER_USD = 100;

// Types
export interface HarvestRecord {
  id: string; // Unique harvest ID
  fid: number;
  username: string;
  address: string;
  tokenId: string; // LP position token ID

  // What was harvested
  wmonAmountWei: string;
  moonAmountWei: string;
  totalValueUsd: number;

  // Points calculation
  userTier: AscensionTier;
  tierMultiplier: number;
  basePoints: number; // Before multiplier
  bonusPoints: number; // From multiplier
  totalPoints: number; // base + bonus

  // Tracking
  txHash?: string;
  timestamp: number;
  weekId: string;
}

export interface UserHarvestStats {
  fid: number;
  username: string;
  address: string;

  // Lifetime stats
  totalHarvests: number;
  totalValueUsd: number;
  totalPoints: number;

  // Current week
  currentWeekId: string;
  currentWeekHarvests: number;
  currentWeekValueUsd: number;
  currentWeekPoints: number;

  // Best week
  bestWeekId?: string;
  bestWeekValueUsd?: number;
  bestWeekPoints?: number;

  // Timestamps
  firstHarvestAt?: number;
  lastHarvestAt?: number;
}

export interface WeeklyHarvestSummary {
  weekId: string;
  totalHarvests: number;
  totalValueUsd: number;
  totalPoints: number;
  participantCount: number;
  topHarvesters: {
    fid: number;
    username: string;
    points: number;
    valueUsd: number;
    tier: AscensionTier;
  }[];
  updatedAt: string;
}

// Get current week ID (ISO week format: "2025-W02")
export function getWeekId(timestamp: number = Date.now()): string {
  const date = new Date(timestamp);
  const thursday = new Date(date);
  thursday.setDate(thursday.getDate() - ((date.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const weekNumber = Math.ceil(((thursday.getTime() - firstThursday.getTime()) / 86400000 + 1) / 7);
  return `${thursday.getFullYear()}-W${weekNumber.toString().padStart(2, '0')}`;
}

// Get all harvest data for a user
export async function getUserHarvestData(fid: number): Promise<HarvestRecord[]> {
  if (!isKvConfigured) return [];
  try {
    const key = `${HARVEST_DATA_KEY}:user:${fid}`;
    const data = await kv.get<HarvestRecord[]>(key);
    return data ?? [];
  } catch {
    return [];
  }
}

// Get user harvest stats
export async function getUserHarvestStats(fid: number): Promise<UserHarvestStats | null> {
  const harvests = await getUserHarvestData(fid);
  if (harvests.length === 0) return null;

  const currentWeekId = getWeekId();
  const currentWeekHarvests = harvests.filter((h) => h.weekId === currentWeekId);

  // Find best week
  const weekTotals = new Map<string, { valueUsd: number; points: number }>();
  for (const harvest of harvests) {
    const existing = weekTotals.get(harvest.weekId) ?? { valueUsd: 0, points: 0 };
    existing.valueUsd += harvest.totalValueUsd;
    existing.points += harvest.totalPoints;
    weekTotals.set(harvest.weekId, existing);
  }

  let bestWeekId: string | undefined;
  let bestWeekValueUsd = 0;
  let bestWeekPoints = 0;
  for (const [weekId, totals] of weekTotals) {
    if (totals.points > bestWeekPoints) {
      bestWeekId = weekId;
      bestWeekValueUsd = totals.valueUsd;
      bestWeekPoints = totals.points;
    }
  }

  const firstHarvest = harvests.reduce(
    (min, h) => (h.timestamp < min ? h.timestamp : min),
    harvests[0].timestamp
  );
  const lastHarvest = harvests.reduce(
    (max, h) => (h.timestamp > max ? h.timestamp : max),
    harvests[0].timestamp
  );

  return {
    fid,
    username: harvests[0].username,
    address: harvests[0].address,
    totalHarvests: harvests.length,
    totalValueUsd: harvests.reduce((sum, h) => sum + h.totalValueUsd, 0),
    totalPoints: harvests.reduce((sum, h) => sum + h.totalPoints, 0),
    currentWeekId,
    currentWeekHarvests: currentWeekHarvests.length,
    currentWeekValueUsd: currentWeekHarvests.reduce((sum, h) => sum + h.totalValueUsd, 0),
    currentWeekPoints: currentWeekHarvests.reduce((sum, h) => sum + h.totalPoints, 0),
    bestWeekId,
    bestWeekValueUsd,
    bestWeekPoints,
    firstHarvestAt: firstHarvest,
    lastHarvestAt: lastHarvest
  };
}

// Record a harvest
export async function recordHarvest(params: {
  fid: number;
  username: string;
  address: string;
  tokenId: string;
  wmonAmountWei: string;
  moonAmountWei: string;
  wmonPriceUsd: number;
  moonPriceUsd: number;
  txHash?: string;
}): Promise<{
  success: boolean;
  harvest: HarvestRecord;
  message: string;
}> {
  const {
    fid,
    username,
    address,
    tokenId,
    wmonAmountWei,
    moonAmountWei,
    wmonPriceUsd,
    moonPriceUsd,
    txHash
  } = params;

  const now = Date.now();
  const weekId = getWeekId(now);

  // Calculate USD value
  const wmonValue = (Number(wmonAmountWei) / 10 ** 18) * wmonPriceUsd;
  const moonValue = (Number(moonAmountWei) / 10 ** 18) * moonPriceUsd;
  const totalValueUsd = wmonValue + moonValue;

  // Get user's tier multiplier
  const tierMultiplier = await getHarvestMultiplier(fid);
  const userTier = getTierFromMultiplier(tierMultiplier);

  // Calculate points
  const basePoints = Math.floor(totalValueUsd * POINTS_PER_USD);
  const bonusPoints = Math.floor(basePoints * (tierMultiplier - 1));
  const totalPoints = basePoints + bonusPoints;

  // Create harvest record
  const harvestId = `harvest_${fid}_${now}_${Math.random().toString(36).substring(2, 8)}`;
  const harvest: HarvestRecord = {
    id: harvestId,
    fid,
    username,
    address,
    tokenId,
    wmonAmountWei,
    moonAmountWei,
    totalValueUsd,
    userTier,
    tierMultiplier,
    basePoints,
    bonusPoints,
    totalPoints,
    txHash,
    timestamp: now,
    weekId
  };

  // Save to KV
  if (isKvConfigured) {
    try {
      // Add to user's harvest history
      const userKey = `${HARVEST_DATA_KEY}:user:${fid}`;
      const userHarvests = (await kv.get<HarvestRecord[]>(userKey)) ?? [];
      userHarvests.push(harvest);
      // Keep only last 100 harvests per user
      if (userHarvests.length > 100) {
        userHarvests.shift();
      }
      await kv.set(userKey, userHarvests);

      // Update weekly totals
      const weeklyKey = HARVEST_WEEKLY_KEY(weekId);
      const weeklyData = (await kv.get<WeeklyHarvestSummary>(weeklyKey)) ?? {
        weekId,
        totalHarvests: 0,
        totalValueUsd: 0,
        totalPoints: 0,
        participantCount: 0,
        topHarvesters: [],
        updatedAt: new Date().toISOString()
      };
      weeklyData.totalHarvests++;
      weeklyData.totalValueUsd += totalValueUsd;
      weeklyData.totalPoints += totalPoints;
      weeklyData.updatedAt = new Date().toISOString();
      await kv.set(weeklyKey, weeklyData);

      // Update user's weekly points
      const userWeeklyKey = HARVEST_USER_WEEKLY_KEY(fid, weekId);
      const userWeeklyPoints = (await kv.get<number>(userWeeklyKey)) ?? 0;
      await kv.set(userWeeklyKey, userWeeklyPoints + totalPoints);

      // Update global totals
      const totals = (await kv.get<{ harvests: number; valueUsd: number; points: number }>(
        HARVEST_TOTALS_KEY
      )) ?? { harvests: 0, valueUsd: 0, points: 0 };
      totals.harvests++;
      totals.valueUsd += totalValueUsd;
      totals.points += totalPoints;
      await kv.set(HARVEST_TOTALS_KEY, totals);
    } catch (err) {
      console.error('[harvestTracking] Failed to save harvest:', err);
    }
  }

  // Build message
  let message = `Harvested $${totalValueUsd.toFixed(2)} → +${totalPoints.toLocaleString()} points`;
  if (bonusPoints > 0) {
    message += ` (${Math.round((tierMultiplier - 1) * 100)}% tier bonus!)`;
  }

  return { success: true, harvest, message };
}

// Get weekly summary
export async function getWeeklySummary(weekId?: string): Promise<WeeklyHarvestSummary | null> {
  if (!isKvConfigured) return null;
  const targetWeek = weekId ?? getWeekId();
  try {
    return await kv.get<WeeklyHarvestSummary>(HARVEST_WEEKLY_KEY(targetWeek));
  } catch {
    return null;
  }
}

// Get global harvest totals
export async function getGlobalHarvestTotals(): Promise<{
  harvests: number;
  valueUsd: number;
  points: number;
} | null> {
  if (!isKvConfigured) return null;
  try {
    return await kv.get<{ harvests: number; valueUsd: number; points: number }>(HARVEST_TOTALS_KEY);
  } catch {
    return null;
  }
}

// Build weekly leaderboard
export async function buildWeeklyLeaderboard(weekId?: string): Promise<WeeklyHarvestSummary> {
  const targetWeek = weekId ?? getWeekId();

  // Get all user weekly data for this week
  // This is a simplified version - in production you'd want a more efficient query
  const summary = (await getWeeklySummary(targetWeek)) ?? {
    weekId: targetWeek,
    totalHarvests: 0,
    totalValueUsd: 0,
    totalPoints: 0,
    participantCount: 0,
    topHarvesters: [],
    updatedAt: new Date().toISOString()
  };

  // For now, return the summary as-is
  // In a full implementation, you'd aggregate all user data here

  return summary;
}

// Helper: Get tier from multiplier
function getTierFromMultiplier(multiplier: number): AscensionTier {
  if (multiplier >= TIER_DEFINITIONS.celestial.harvestMultiplier) return 'celestial';
  if (multiplier >= TIER_DEFINITIONS.luminary.harvestMultiplier) return 'luminary';
  if (multiplier >= TIER_DEFINITIONS.guardian.harvestMultiplier) return 'guardian';
  if (multiplier >= TIER_DEFINITIONS.keeper.harvestMultiplier) return 'keeper';
  return 'wanderer';
}

// Format points for display
export function formatPoints(points: number): string {
  if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`;
  if (points >= 1_000) return `${(points / 1_000).toFixed(1)}K`;
  return points.toLocaleString();
}
