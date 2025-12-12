/**
 * m00n Tokenomics Configuration
 *
 * Multi-season support with weighted points formula.
 *
 * Manages the allocation of 26.23% of total supply for:
 * - Streak Rewards (12%)
 * - LP Mining / Points (8%)
 * - Community Treasury (3%)
 * - Virality/Growth (2%)
 * - Dev Treasury (1.23%)
 */

import { kv } from '@vercel/kv';

// -----------------------------
// Constants
// -----------------------------

// Total supply allocation (26.23% of total)
export const TOTAL_ALLOCATION_PERCENT = 26.23;

// m00n token details
export const M00N_TOTAL_SUPPLY = 100_000_000_000; // 100 billion
export const TOTAL_HOLDINGS = M00N_TOTAL_SUPPLY * (TOTAL_ALLOCATION_PERCENT / 100); // 26.23B

// Reserve 10% of holdings as safety buffer
export const RESERVE_PERCENT = 10;
export const RESERVED_SUPPLY = TOTAL_HOLDINGS * (RESERVE_PERCENT / 100); // ~2.62B
export const ALLOCATED_SUPPLY = TOTAL_HOLDINGS - RESERVED_SUPPLY; // ~23.6B

// Qualification requirements
export const QUALIFICATION_REQUIREMENTS = {
  minMoonHolding: 1_000_000, // 1M m00n minimum
  minPositionAgeDays: 7, // Position must be 7+ days old
  minStreakDays: 7, // Must have 7+ day streak
  mustBeInRange: true // Must be in range at snapshot
} as const;

// Allocation breakdown (% of ALLOCATED_SUPPLY after reserve)
// Adjusted percentages to sum to ~100% of allocated supply
const ALLOC_STREAK = 0.42; // 42% of allocated = ~10B
const ALLOC_LP_MINING = 0.3; // 30% of allocated = ~7B
const ALLOC_COMMUNITY = 0.12; // 12% of allocated = ~2.8B
const ALLOC_VIRALITY = 0.08; // 8% of allocated = ~1.9B
const ALLOC_DEV = 0.08; // 8% of allocated = ~1.9B

export const ALLOCATIONS = {
  streakRewards: {
    name: 'Streak Rewards',
    emoji: '🏆',
    percentOfAllocated: ALLOC_STREAK * 100,
    tokens: Math.floor(ALLOCATED_SUPPLY * ALLOC_STREAK),
    description: 'Full moon rewards for top LP streak holders',
    distributionSchedule: 'full_moon'
  },
  lpMining: {
    name: 'LP Mining (Points)',
    emoji: '⛏️',
    percentOfAllocated: ALLOC_LP_MINING * 100,
    tokens: Math.floor(ALLOCATED_SUPPLY * ALLOC_LP_MINING),
    description: 'Seasonal airdrop based on weighted points earned',
    distributionSchedule: 'end_of_season'
  },
  communityTreasury: {
    name: 'Community Treasury',
    emoji: '🏛️',
    percentOfAllocated: ALLOC_COMMUNITY * 100,
    tokens: Math.floor(ALLOCATED_SUPPLY * ALLOC_COMMUNITY),
    description: 'Future initiatives, partnerships, and integrations',
    distributionSchedule: 'as_needed'
  },
  viralityGrowth: {
    name: 'Virality & Growth',
    emoji: '📢',
    percentOfAllocated: ALLOC_VIRALITY * 100,
    tokens: Math.floor(ALLOCATED_SUPPLY * ALLOC_VIRALITY),
    description: 'Share incentives, referral rewards, and growth campaigns',
    distributionSchedule: 'ongoing'
  },
  devTreasury: {
    name: 'Dev Treasury',
    emoji: '🔧',
    percentOfAllocated: ALLOC_DEV * 100,
    tokens: Math.floor(ALLOCATED_SUPPLY * ALLOC_DEV),
    description: 'Ongoing development and operational buffer',
    distributionSchedule: 'as_needed'
  }
} as const;

// -----------------------------
// Full Moon Schedule 2025 & 2026
// -----------------------------

export const FULL_MOONS_2025 = [
  { date: '2025-01-13', name: 'Wolf Moon' },
  { date: '2025-02-12', name: 'Snow Moon' },
  { date: '2025-03-14', name: 'Worm Moon' },
  { date: '2025-04-13', name: 'Pink Moon' },
  { date: '2025-05-12', name: 'Flower Moon' },
  { date: '2025-06-11', name: 'Strawberry Moon' },
  { date: '2025-07-10', name: 'Buck Moon' },
  { date: '2025-08-09', name: 'Sturgeon Moon' },
  { date: '2025-09-07', name: 'Harvest Moon' },
  { date: '2025-10-07', name: 'Hunter Moon' },
  { date: '2025-11-05', name: 'Beaver Moon' },
  { date: '2025-12-04', name: 'Cold Moon' }
] as const;

export const FULL_MOONS_2026 = [
  { date: '2026-01-03', name: 'Wolf Moon' },
  { date: '2026-02-01', name: 'Snow Moon' },
  { date: '2026-03-03', name: 'Worm Moon' },
  { date: '2026-04-01', name: 'Pink Moon' },
  { date: '2026-05-01', name: 'Flower Moon' },
  { date: '2026-05-31', name: 'Strawberry Moon' },
  { date: '2026-06-29', name: 'Buck Moon' },
  { date: '2026-07-29', name: 'Sturgeon Moon' },
  { date: '2026-08-28', name: 'Harvest Moon' },
  { date: '2026-09-26', name: 'Hunter Moon' },
  { date: '2026-10-26', name: 'Beaver Moon' },
  { date: '2026-11-24', name: 'Cold Moon' },
  { date: '2026-12-24', name: 'Long Night Moon' }
] as const;

// Combined schedule for easier lookup
export const ALL_FULL_MOONS = [...FULL_MOONS_2025, ...FULL_MOONS_2026] as const;

export function getNextFullMoon(): { date: string; name: string; daysUntil: number } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const moon of ALL_FULL_MOONS) {
    const moonDate = new Date(moon.date);
    if (moonDate >= today) {
      const daysUntil = Math.ceil((moonDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return { ...moon, daysUntil };
    }
  }
  return null;
}

export function getPreviousFullMoon(): { date: string; name: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = ALL_FULL_MOONS.length - 1; i >= 0; i--) {
    const moon = ALL_FULL_MOONS[i];
    const moonDate = new Date(moon.date);
    if (moonDate < today) {
      return moon;
    }
  }
  return null;
}

export type AllocationKey = keyof typeof ALLOCATIONS;

// -----------------------------
// Points Calculation Weights
// -----------------------------

/**
 * Weighted points formula:
 * - Notional value (USD) has highest weight - rewards larger LPs
 * - Streak duration (days) rewards consistency
 * - Time in range (hours) rewards longevity
 */
export const POINTS_WEIGHTS = {
  notionalUsd: {
    weight: 0.5, // 50% weight
    description: 'Points per $1 of position notional value',
    multiplier: 1 // 1 point per $1
  },
  streakDays: {
    weight: 0.3, // 30% weight
    description: 'Bonus points per day of continuous streak',
    multiplier: 100 // 100 base points per day
  },
  timeInRangeHours: {
    weight: 0.2, // 20% weight
    description: 'Points per hour spent in range',
    multiplier: 10 // 10 points per hour
  }
} as const;

/**
 * Calculate weighted points for a position
 * - Being in-range is a bonus multiplier (1.5x), not a hard requirement
 * - Out-of-range positions still earn points, just fewer
 */
export function calculateWeightedPoints(params: {
  notionalUsd: number;
  streakDurationSeconds: number;
  totalInRangeSeconds: number;
  isCurrentlyInRange?: boolean;
}): {
  total: number;
  breakdown: {
    notionalPoints: number;
    streakPoints: number;
    timePoints: number;
  };
  multipliers: {
    streak: number;
    inRange: number;
  };
} {
  const streakDays = params.streakDurationSeconds / 86400;
  const inRangeHours = params.totalInRangeSeconds / 3600;

  // Calculate raw points for each component
  const rawNotional = params.notionalUsd * POINTS_WEIGHTS.notionalUsd.multiplier;
  const rawStreak = streakDays * POINTS_WEIGHTS.streakDays.multiplier;
  const rawTime = inRangeHours * POINTS_WEIGHTS.timeInRangeHours.multiplier;

  // Apply weights
  const notionalPoints = rawNotional * POINTS_WEIGHTS.notionalUsd.weight;
  const streakPoints = rawStreak * POINTS_WEIGHTS.streakDays.weight;
  const timePoints = rawTime * POINTS_WEIGHTS.timeInRangeHours.weight;

  // Apply streak multiplier bonus for long streaks
  let streakMultiplier = 1;
  if (streakDays >= 30) {
    streakMultiplier = 3; // 3x for 30+ day streaks
  } else if (streakDays >= 14) {
    streakMultiplier = 2; // 2x for 14+ day streaks
  } else if (streakDays >= 7) {
    streakMultiplier = 1.5; // 1.5x for 7+ day streaks
  }

  // In-range bonus: 1.5x if currently in range, 1x otherwise
  const inRangeMultiplier = params.isCurrentlyInRange ? 1.5 : 1;

  const baseTotal = notionalPoints + streakPoints + timePoints;
  const total = Math.floor(baseTotal * streakMultiplier * inRangeMultiplier);

  return {
    total,
    breakdown: {
      notionalPoints: Math.floor(notionalPoints),
      streakPoints: Math.floor(streakPoints * streakMultiplier),
      timePoints: Math.floor(timePoints)
    },
    multipliers: {
      streak: streakMultiplier,
      inRange: inRangeMultiplier
    }
  };
}

// -----------------------------
// Multi-Season Configuration
// -----------------------------

export interface Season {
  id: string;
  name: string;
  number: number; // Season 1, 2, 3...
  startDate: string; // ISO date
  endDate: string | null; // null = ongoing

  // Allocation for this season
  lpMiningPool: number; // Tokens allocated from LP Mining pool
  streakRewardsPool: number; // Tokens allocated from Streak Rewards

  // Status
  status: 'upcoming' | 'active' | 'ended' | 'distributing' | 'completed';

  // Stats
  totalPointsDistributed?: number;
  totalParticipants?: number;
  topPointsEarned?: number;
}

// Season allocation: Split the pools across 3 seasons
const TOTAL_SEASONS = 3;
const LP_MINING_PER_SEASON = Math.floor(ALLOCATIONS.lpMining.tokens / TOTAL_SEASONS);
// Streak rewards distributed monthly (12 full moons), split across seasons
const FULL_MOONS_PER_SEASON = 4;
const STREAK_REWARDS_PER_FULL_MOON = Math.floor(ALLOCATIONS.streakRewards.tokens / 12);
const STREAK_REWARDS_PER_SEASON = STREAK_REWARDS_PER_FULL_MOON * FULL_MOONS_PER_SEASON;

export const DEFAULT_SEASONS: Season[] = [
  {
    id: 'season-1',
    name: 'Genesis',
    number: 1,
    startDate: new Date().toISOString(),
    endDate: null, // TBD - runs until manually ended
    lpMiningPool: LP_MINING_PER_SEASON,
    streakRewardsPool: STREAK_REWARDS_PER_SEASON,
    status: 'active'
  },
  {
    id: 'season-2',
    name: 'Ascension',
    number: 2,
    startDate: '', // TBD
    endDate: null,
    lpMiningPool: LP_MINING_PER_SEASON,
    streakRewardsPool: STREAK_REWARDS_PER_SEASON,
    status: 'upcoming'
  },
  {
    id: 'season-3',
    name: 'Apex',
    number: 3,
    startDate: '', // TBD
    endDate: null,
    lpMiningPool: LP_MINING_PER_SEASON,
    streakRewardsPool: STREAK_REWARDS_PER_SEASON,
    status: 'upcoming'
  }
];

// -----------------------------
// Types
// -----------------------------

export interface SeasonUserStats {
  seasonId: string;
  address: string;
  fid?: number;
  username?: string;

  // Points breakdown (per season)
  totalPoints: number;
  notionalPoints: number;
  streakPoints: number;
  timePoints: number;

  // Position stats
  positionCount: number;
  totalNotionalUsd: number;
  bestStreakDays: number;
  totalHoursInRange: number;

  // Rank for this season
  rank?: number;
  percentile?: number;

  // Estimated allocation for this season
  estimatedAllocation: number;
  shareOfPool: number; // percentage

  // Tier
  tier: {
    name: string;
    emoji: string;
    multiplier: number;
  };

  lastUpdated: string;
}

export interface UserAllocation {
  address: string;
  fid?: number;
  username?: string;

  // Aggregate across all seasons
  lifetimePoints: number;
  lifetimeEarnings: number;

  // Per-season breakdown
  seasonStats: SeasonUserStats[];

  // Current season stats
  currentSeasonStats?: SeasonUserStats;
}

export interface AllocationSnapshot {
  id: string;
  seasonId: string;
  fullMoonDate: string;
  fullMoonName: string;
  takenAt: string;
  totalParticipants: number;
  totalQualifiedParticipants: number;
  totalPointsDistributed: number;
  qualifiedHolders: QualifiedHolder[];
  disqualifiedCount: number;
  disqualificationReasons: Record<string, number>;
}

// Qualification status for a user
export interface QualificationStatus {
  qualified: boolean;
  address: string;
  checks: {
    hasMinMoonHolding: boolean;
    moonBalance: number;
    requiredMoonBalance: number;

    hasMinPositionAge: boolean;
    oldestPositionDays: number;
    requiredPositionAgeDays: number;

    hasMinStreak: boolean;
    currentStreakDays: number;
    requiredStreakDays: number;

    isInRange: boolean;
  };
  disqualificationReasons: string[];
  points: number;
  estimatedAllocation: number;
}

export interface QualifiedHolder {
  address: string;
  points: number;
  allocation: number;
  tier: { name: string; emoji: string };
  streakDays: number;
  notionalUsd: number;
  moonBalance: number;
  positionAgeDays: number;
  qualificationStatus: QualificationStatus;
}

// Full Moon Snapshot for distribution
export interface FullMoonSnapshot {
  id: string;
  seasonId: string;
  fullMoonDate: string;
  fullMoonName: string;
  takenAt: string;
  type: 'streak_rewards' | 'lp_mining';

  // Pool for this distribution
  tokenPool: number;

  // Stats
  totalParticipants: number;
  totalQualified: number;
  totalDisqualified: number;
  totalPointsInPool: number;

  // Qualified recipients
  qualifiedHolders: QualifiedHolder[];

  // Disqualification breakdown
  disqualificationBreakdown: {
    insufficientMoonBalance: number;
    positionTooNew: number;
    streakTooShort: number;
    outOfRange: number;
  };

  // Status
  status: 'pending' | 'finalized' | 'distributed';
  distributionId?: string;
}

export interface RewardsDistribution {
  id: string;
  type: 'streak_rewards' | 'lp_mining' | 'virality' | 'manual';
  seasonId: string;
  distributedAt: string;
  totalTokens: number;
  recipients: {
    address: string;
    tokens: number;
    points?: number;
    rank?: number;
    reason?: string;
  }[];
  txHash?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  notes?: string;
}

// -----------------------------
// KV Keys
// -----------------------------

const SEASONS_KEY = 'm00n:seasons';
const DISTRIBUTIONS_KEY = 'm00n:distributions';
const USER_SEASON_STATS_PREFIX = 'm00n:user-season:';
const SEASON_SNAPSHOT_PREFIX = 'm00n:season-snapshot:';
const FULL_MOON_SNAPSHOTS_KEY = 'm00n:full-moon-snapshots';

const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

// -----------------------------
// KV Operations
// -----------------------------

async function kvSafeGet<T>(key: string): Promise<T | null> {
  if (!isKvConfigured) return null;
  try {
    return ((await kv.get<T>(key)) as T | null) ?? null;
  } catch (error) {
    console.error(`[tokenomics] Failed to read ${key} from KV`, error);
    return null;
  }
}

async function kvSafeSet<T>(key: string, value: T): Promise<void> {
  if (!isKvConfigured) return;
  try {
    await kv.set(key, value);
  } catch (error) {
    console.error(`[tokenomics] Failed to persist ${key} to KV`, error);
  }
}

// -----------------------------
// Season Management
// -----------------------------

export async function getSeasons(): Promise<Season[]> {
  const stored = await kvSafeGet<Season[]>(SEASONS_KEY);
  return stored ?? DEFAULT_SEASONS;
}

export async function getCurrentSeason(): Promise<Season | null> {
  const seasons = await getSeasons();
  return seasons.find((s) => s.status === 'active') ?? null;
}

export async function getSeasonById(seasonId: string): Promise<Season | null> {
  const seasons = await getSeasons();
  return seasons.find((s) => s.id === seasonId) ?? null;
}

export async function updateSeason(season: Season): Promise<void> {
  const seasons = await getSeasons();
  const index = seasons.findIndex((s) => s.id === season.id);
  if (index >= 0) {
    seasons[index] = season;
  } else {
    seasons.push(season);
  }
  await kvSafeSet(SEASONS_KEY, seasons);
}

export async function updateSeasons(seasons: Season[]): Promise<void> {
  await kvSafeSet(SEASONS_KEY, seasons);
}

export async function startNextSeason(): Promise<Season | null> {
  const seasons = await getSeasons();
  const currentActive = seasons.find((s) => s.status === 'active');

  // End current season
  if (currentActive) {
    currentActive.status = 'ended';
    currentActive.endDate = new Date().toISOString();
  }

  // Find next upcoming season
  const nextSeason = seasons.find((s) => s.status === 'upcoming');
  if (nextSeason) {
    nextSeason.status = 'active';
    nextSeason.startDate = new Date().toISOString();
    await updateSeasons(seasons);
    return nextSeason;
  }

  await updateSeasons(seasons);
  return null;
}

// -----------------------------
// User Season Stats Management
// -----------------------------

export async function getUserSeasonStats(
  address: string,
  seasonId: string
): Promise<SeasonUserStats | null> {
  const key = `${USER_SEASON_STATS_PREFIX}${seasonId}:${address.toLowerCase()}`;
  return await kvSafeGet<SeasonUserStats>(key);
}

export async function updateUserSeasonStats(stats: SeasonUserStats): Promise<void> {
  const key = `${USER_SEASON_STATS_PREFIX}${stats.seasonId}:${stats.address.toLowerCase()}`;
  await kvSafeSet(key, {
    ...stats,
    lastUpdated: new Date().toISOString()
  });
}

// -----------------------------
// Tier System
// -----------------------------

export function getStreakTier(streakDays: number): {
  name: string;
  emoji: string;
  multiplier: number;
} {
  if (streakDays >= 30) {
    return { name: 'Diamond', emoji: '💎', multiplier: 3 };
  }
  if (streakDays >= 14) {
    return { name: 'Gold', emoji: '👑', multiplier: 2 };
  }
  if (streakDays >= 7) {
    return { name: 'Silver', emoji: '⭐', multiplier: 1.5 };
  }
  if (streakDays >= 3) {
    return { name: 'Bronze', emoji: '🔥', multiplier: 1.25 };
  }
  return { name: 'Starter', emoji: '🌱', multiplier: 1 };
}

// -----------------------------
// Allocation Calculations
// -----------------------------

/**
 * Calculate a user's estimated LP mining allocation for a season
 */
export function calculateSeasonAllocation(
  userPoints: number,
  totalSystemPoints: number,
  seasonPool: number
): number {
  if (totalSystemPoints === 0) return 0;
  const share = userPoints / totalSystemPoints;
  return Math.floor(seasonPool * share);
}

// -----------------------------
// Distribution Management
// -----------------------------

export async function getDistributions(): Promise<RewardsDistribution[]> {
  const stored = await kvSafeGet<RewardsDistribution[]>(DISTRIBUTIONS_KEY);
  return stored ?? [];
}

export async function getDistributionsBySeason(seasonId: string): Promise<RewardsDistribution[]> {
  const all = await getDistributions();
  return all.filter((d) => d.seasonId === seasonId);
}

export async function addDistribution(distribution: RewardsDistribution): Promise<void> {
  const existing = await getDistributions();
  existing.push(distribution);
  await kvSafeSet(DISTRIBUTIONS_KEY, existing);
}

export async function updateDistribution(distribution: RewardsDistribution): Promise<void> {
  const existing = await getDistributions();
  const index = existing.findIndex((d) => d.id === distribution.id);
  if (index >= 0) {
    existing[index] = distribution;
    await kvSafeSet(DISTRIBUTIONS_KEY, existing);
  }
}

// -----------------------------
// Season Snapshots
// -----------------------------

export async function saveSeasonSnapshot(snapshot: AllocationSnapshot): Promise<void> {
  const key = `${SEASON_SNAPSHOT_PREFIX}${snapshot.seasonId}:${Date.now()}`;
  await kvSafeSet(key, snapshot);
}

// -----------------------------
// Formatting Helpers
// -----------------------------

export function formatTokenAmount(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `${(amount / 1_000_000_000).toFixed(2)}B`;
  }
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `${(amount / 1_000).toFixed(2)}K`;
  }
  return amount.toLocaleString();
}

export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

// -----------------------------
// Summary API
// -----------------------------

export interface TokenomicsSummary {
  totalAllocationPercent: number;
  totalAllocatedTokens: number;
  allocations: typeof ALLOCATIONS;
  pointsWeights: typeof POINTS_WEIGHTS;
  seasons: Season[];
  currentSeason: Season | null;
  distributions: {
    total: number;
    completed: number;
    pending: number;
    totalTokensDistributed: number;
  };
}

export async function getTokenomicsSummary(): Promise<TokenomicsSummary> {
  const [seasons, distributions] = await Promise.all([getSeasons(), getDistributions()]);

  const currentSeason = seasons.find((s) => s.status === 'active') ?? null;
  const completedDistributions = distributions.filter((d) => d.status === 'completed');
  const totalTokensDistributed = completedDistributions.reduce((sum, d) => sum + d.totalTokens, 0);

  return {
    totalAllocationPercent: TOTAL_ALLOCATION_PERCENT,
    totalAllocatedTokens: ALLOCATED_SUPPLY,
    allocations: ALLOCATIONS,
    pointsWeights: POINTS_WEIGHTS,
    seasons,
    currentSeason,
    distributions: {
      total: distributions.length,
      completed: completedDistributions.length,
      pending: distributions.filter((d) => d.status === 'pending').length,
      totalTokensDistributed
    }
  };
}

// -----------------------------
// Full Moon Snapshot Management
// -----------------------------

export async function getFullMoonSnapshots(): Promise<FullMoonSnapshot[]> {
  const stored = await kvSafeGet<FullMoonSnapshot[]>(FULL_MOON_SNAPSHOTS_KEY);
  return stored ?? [];
}

export async function saveFullMoonSnapshot(snapshot: FullMoonSnapshot): Promise<void> {
  const existing = await getFullMoonSnapshots();
  // Replace if same full moon date exists
  const index = existing.findIndex(
    (s) => s.fullMoonDate === snapshot.fullMoonDate && s.type === snapshot.type
  );
  if (index >= 0) {
    existing[index] = snapshot;
  } else {
    existing.push(snapshot);
  }
  await kvSafeSet(FULL_MOON_SNAPSHOTS_KEY, existing);
}

export async function getSnapshotByFullMoon(
  fullMoonDate: string,
  type: 'streak_rewards' | 'lp_mining'
): Promise<FullMoonSnapshot | null> {
  const snapshots = await getFullMoonSnapshots();
  return snapshots.find((s) => s.fullMoonDate === fullMoonDate && s.type === type) ?? null;
}

// -----------------------------
// Export Helpers (for manual distribution)
// -----------------------------

export function exportDistributionToCSV(distribution: RewardsDistribution): string {
  const headers = ['address', 'tokens', 'points', 'rank', 'reason'];
  const rows = distribution.recipients.map((r) => [
    r.address,
    r.tokens.toString(),
    (r.points ?? 0).toString(),
    (r.rank ?? '').toString(),
    r.reason ?? ''
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportSnapshotToCSV(snapshot: FullMoonSnapshot): string {
  const headers = [
    'rank',
    'address',
    'points',
    'allocation',
    'tier',
    'streak_days',
    'notional_usd',
    'moon_balance',
    'position_age_days'
  ];

  const sortedHolders = [...snapshot.qualifiedHolders].sort((a, b) => b.allocation - a.allocation);

  const rows = sortedHolders.map((h, index) => [
    (index + 1).toString(),
    h.address,
    h.points.toString(),
    h.allocation.toString(),
    h.tier.name,
    h.streakDays.toString(),
    h.notionalUsd.toFixed(2),
    h.moonBalance.toString(),
    h.positionAgeDays.toString()
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// -----------------------------
// Safety Checks
// -----------------------------

export const SAFETY_LIMITS = {
  maxSingleDistribution: M00N_TOTAL_SUPPLY * 0.05, // Max 5% of total supply = 5B tokens
  maxRecipientsPerDistribution: 1000,
  minDistributionInterval: 24 * 60 * 60 * 1000 // 24 hours between distributions
} as const;

export function validateDistribution(distribution: RewardsDistribution): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check total tokens
  if (distribution.totalTokens > SAFETY_LIMITS.maxSingleDistribution) {
    errors.push(
      `Distribution exceeds max single distribution limit (${formatTokenAmount(SAFETY_LIMITS.maxSingleDistribution)})`
    );
  }

  // Check recipient count
  if (distribution.recipients.length > SAFETY_LIMITS.maxRecipientsPerDistribution) {
    errors.push(`Too many recipients (max ${SAFETY_LIMITS.maxRecipientsPerDistribution})`);
  }

  // Check for zero allocations
  const zeroAllocations = distribution.recipients.filter((r) => r.tokens === 0).length;
  if (zeroAllocations > 0) {
    warnings.push(`${zeroAllocations} recipients have zero allocation`);
  }

  // Check for duplicate addresses
  const addresses = distribution.recipients.map((r) => r.address.toLowerCase());
  const uniqueAddresses = new Set(addresses);
  if (uniqueAddresses.size !== addresses.length) {
    errors.push('Duplicate addresses found in distribution');
  }

  // Check sum matches total
  const actualSum = distribution.recipients.reduce((sum, r) => sum + r.tokens, 0);
  if (Math.abs(actualSum - distribution.totalTokens) > 1) {
    warnings.push(
      `Sum of allocations (${actualSum}) differs from stated total (${distribution.totalTokens})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// -----------------------------
// Exported Constants for UI
// -----------------------------

export { STREAK_REWARDS_PER_FULL_MOON };
