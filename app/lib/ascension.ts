/**
 * Ascension System for m00n
 *
 * Users burn m00n to "ascend" through tiers, unlocking perks and status.
 * Burns are tracked off-chain, but actual burn happens on-chain (transfer to 0xdead).
 *
 * TIERS:
 * - Wanderer (0 burned) - Default, basic features
 * - Keeper (100K burned) - Bronze glow, 1.05x harvest points
 * - Guardian (1M burned) - Silver glow, custom orbit name, 1.1x harvest points
 * - Luminary (10M burned) - Gold glow, Lunar Council seat, 1.15x harvest points
 * - Celestial (100M burned) - Diamond glow, protocol governance, 1.25x harvest points
 */

import { kv } from '@vercel/kv';

// KV keys
const ASCENSION_DATA_KEY = 'm00n:ascension:data';
const ASCENSION_LEADERBOARD_KEY = 'm00n:ascension:leaderboard';
const TOTAL_BURNED_KEY = 'm00n:ascension:total-burned';

// Check if KV is configured
const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

// Burn address (standard dead address)
export const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD';

// Tier definitions
export type AscensionTier = 'wanderer' | 'keeper' | 'guardian' | 'luminary' | 'celestial';

export interface TierDefinition {
  name: string;
  tier: AscensionTier;
  burnRequired: bigint; // in wei
  burnRequiredFormatted: string; // human readable
  emoji: string;
  glow: string; // CSS color
  harvestMultiplier: number;
  perks: string[];
}

// Helper to create burn amounts (100K = 100_000 * 10^18)
const MOON_DECIMALS = BigInt(10) ** BigInt(18);
const burnAmount = (amount: number): bigint => BigInt(amount) * MOON_DECIMALS;

export const TIER_DEFINITIONS: Record<AscensionTier, TierDefinition> = {
  wanderer: {
    name: 'Wanderer',
    tier: 'wanderer',
    burnRequired: BigInt(0),
    burnRequiredFormatted: '0',
    emoji: '◌',
    glow: 'transparent',
    harvestMultiplier: 1.0,
    perks: ['Basic LP features', 'Daily tune']
  },
  keeper: {
    name: 'Keeper',
    tier: 'keeper',
    burnRequired: burnAmount(100_000), // 100K m00n
    burnRequiredFormatted: '100K',
    emoji: '◐',
    glow: '#cd7f32', // Bronze
    harvestMultiplier: 1.05,
    perks: ['Bronze glow on leaderboard', '+5% harvest points', 'Tune suggestions']
  },
  guardian: {
    name: 'Guardian',
    tier: 'guardian',
    burnRequired: burnAmount(1_000_000), // 1M m00n
    burnRequiredFormatted: '1M',
    emoji: '◑',
    glow: '#c0c0c0', // Silver
    harvestMultiplier: 1.1,
    perks: ['Silver glow', 'Custom orbit name', '+10% harvest points', 'Priority house invites']
  },
  luminary: {
    name: 'Luminary',
    tier: 'luminary',
    burnRequired: burnAmount(10_000_000), // 10M m00n
    burnRequiredFormatted: '10M',
    emoji: '●',
    glow: '#ffd700', // Gold
    harvestMultiplier: 1.15,
    perks: [
      'Gold animated glow',
      'Lunar Council seat',
      '+15% harvest points',
      'Create prediction markets',
      'Featured on homepage'
    ]
  },
  celestial: {
    name: 'Celestial',
    tier: 'celestial',
    burnRequired: burnAmount(100_000_000), // 100M m00n
    burnRequiredFormatted: '100M',
    emoji: '★',
    glow: '#b9f2ff', // Diamond blue
    harvestMultiplier: 1.25,
    perks: [
      'Diamond legendary glow',
      'Protocol fee share',
      '+25% harvest points',
      'Propose protocol changes',
      'Hall of Fame'
    ]
  }
};

// Get tier from total burned amount
export function getTierFromBurned(totalBurnedWei: bigint): TierDefinition {
  if (totalBurnedWei >= TIER_DEFINITIONS.celestial.burnRequired) {
    return TIER_DEFINITIONS.celestial;
  }
  if (totalBurnedWei >= TIER_DEFINITIONS.luminary.burnRequired) {
    return TIER_DEFINITIONS.luminary;
  }
  if (totalBurnedWei >= TIER_DEFINITIONS.guardian.burnRequired) {
    return TIER_DEFINITIONS.guardian;
  }
  if (totalBurnedWei >= TIER_DEFINITIONS.keeper.burnRequired) {
    return TIER_DEFINITIONS.keeper;
  }
  return TIER_DEFINITIONS.wanderer;
}

// Get next tier info
export function getNextTier(
  currentTier: AscensionTier
): { tier: TierDefinition; burnNeeded: bigint } | null {
  const tierOrder: AscensionTier[] = ['wanderer', 'keeper', 'guardian', 'luminary', 'celestial'];
  const currentIndex = tierOrder.indexOf(currentTier);
  if (currentIndex >= tierOrder.length - 1) return null; // Already max tier

  const nextTierKey = tierOrder[currentIndex + 1];
  const currentBurnReq = TIER_DEFINITIONS[currentTier].burnRequired;
  const nextTier = TIER_DEFINITIONS[nextTierKey];

  return {
    tier: nextTier,
    burnNeeded: nextTier.burnRequired - currentBurnReq
  };
}

// User ascension record
export interface AscensionRecord {
  fid: number;
  username: string;
  address: string;

  // Burn tracking
  totalBurnedWei: string; // Store as string for BigInt serialization
  burnHistory: BurnEvent[];

  // Current tier
  tier: AscensionTier;
  tierAchievedAt: number; // When current tier was reached

  // Custom features (unlocked at Guardian+)
  customOrbitName?: string;

  // Timestamps
  firstBurnAt?: number;
  lastBurnAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface BurnEvent {
  txHash: string;
  amountWei: string;
  timestamp: number;
  tierBefore: AscensionTier;
  tierAfter: AscensionTier;
  tierChanged: boolean;
}

export interface AscensionLeaderboard {
  updatedAt: string;
  totalBurnedAllTime: string; // Total m00n burned by all users
  totalBurners: number;
  topBurners: {
    fid: number;
    username: string;
    address: string;
    totalBurnedWei: string;
    tier: AscensionTier;
    tierEmoji: string;
  }[];
}

// Get all ascension data
export async function getAscensionData(): Promise<Record<string, AscensionRecord>> {
  if (!isKvConfigured) return {};
  try {
    const data = await kv.get<Record<string, AscensionRecord>>(ASCENSION_DATA_KEY);
    return data ?? {};
  } catch {
    return {};
  }
}

// Get ascension record for specific FID
export async function getAscensionRecord(fid: number): Promise<AscensionRecord | null> {
  const data = await getAscensionData();
  return data[fid.toString()] ?? null;
}

// Get user tier (returns wanderer if no record)
export async function getUserTier(fid: number): Promise<TierDefinition> {
  const record = await getAscensionRecord(fid);
  if (!record) return TIER_DEFINITIONS.wanderer;
  return TIER_DEFINITIONS[record.tier];
}

// Get harvest multiplier for user
export async function getHarvestMultiplier(fid: number): Promise<number> {
  const tier = await getUserTier(fid);
  return tier.harvestMultiplier;
}

// Record a burn
export async function recordBurn(
  fid: number,
  username: string,
  address: string,
  txHash: string,
  amountWei: bigint
): Promise<{
  success: boolean;
  record: AscensionRecord;
  tierChanged: boolean;
  newTier?: TierDefinition;
  message: string;
}> {
  const now = Date.now();
  const data = await getAscensionData();
  const existing = data[fid.toString()];

  let tierBefore: AscensionTier = 'wanderer';
  let totalBurnedWei = amountWei;

  if (existing) {
    tierBefore = existing.tier;
    totalBurnedWei = BigInt(existing.totalBurnedWei) + amountWei;
  }

  // Calculate new tier
  const newTierDef = getTierFromBurned(totalBurnedWei);
  const tierChanged = newTierDef.tier !== tierBefore;

  // Create burn event
  const burnEvent: BurnEvent = {
    txHash,
    amountWei: amountWei.toString(),
    timestamp: now,
    tierBefore,
    tierAfter: newTierDef.tier,
    tierChanged
  };

  // Update or create record
  const record: AscensionRecord = {
    fid,
    username,
    address,
    totalBurnedWei: totalBurnedWei.toString(),
    burnHistory: [...(existing?.burnHistory ?? []), burnEvent],
    tier: newTierDef.tier,
    tierAchievedAt: tierChanged ? now : (existing?.tierAchievedAt ?? now),
    customOrbitName: existing?.customOrbitName,
    firstBurnAt: existing?.firstBurnAt ?? now,
    lastBurnAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  // Save to KV
  if (isKvConfigured) {
    try {
      data[fid.toString()] = record;
      await kv.set(ASCENSION_DATA_KEY, data);

      // Update total burned
      const currentTotal = await kv.get<string>(TOTAL_BURNED_KEY);
      const newTotal = BigInt(currentTotal ?? '0') + amountWei;
      await kv.set(TOTAL_BURNED_KEY, newTotal.toString());
    } catch (err) {
      console.error('[ascension] Failed to save burn record:', err);
    }
  }

  // Build response message
  let message = `Burned ${formatMoonAmount(amountWei)} m00n 🔥`;
  if (tierChanged) {
    message = `${newTierDef.emoji} Ascended to ${newTierDef.name}! ${message}`;
  }

  return {
    success: true,
    record,
    tierChanged,
    newTier: tierChanged ? newTierDef : undefined,
    message
  };
}

// Set custom orbit name (Guardian+ only)
export async function setCustomOrbitName(
  fid: number,
  orbitName: string
): Promise<{ success: boolean; message: string }> {
  const record = await getAscensionRecord(fid);

  if (!record) {
    return { success: false, message: 'No ascension record found' };
  }

  const tier = TIER_DEFINITIONS[record.tier];
  if (tier.harvestMultiplier < TIER_DEFINITIONS.guardian.harvestMultiplier) {
    return { success: false, message: 'Guardian tier required to set custom orbit name' };
  }

  // Validate orbit name
  if (orbitName.length > 24) {
    return { success: false, message: 'Orbit name must be 24 characters or less' };
  }

  // Update record
  const data = await getAscensionData();
  record.customOrbitName = orbitName;
  record.updatedAt = Date.now();
  data[fid.toString()] = record;

  if (isKvConfigured) {
    try {
      await kv.set(ASCENSION_DATA_KEY, data);
    } catch (err) {
      console.error('[ascension] Failed to save orbit name:', err);
      return { success: false, message: 'Failed to save orbit name' };
    }
  }

  return { success: true, message: `Orbit name set to "${orbitName}"` };
}

// Build ascension leaderboard
export async function buildAscensionLeaderboard(): Promise<AscensionLeaderboard> {
  const data = await getAscensionData();
  const allRecords = Object.values(data);

  // Sort by total burned
  const sorted = allRecords.sort((a, b) => {
    return Number(BigInt(b.totalBurnedWei) - BigInt(a.totalBurnedWei));
  });

  // Calculate total burned
  const totalBurned = allRecords.reduce((sum, r) => sum + BigInt(r.totalBurnedWei), BigInt(0));

  const leaderboard: AscensionLeaderboard = {
    updatedAt: new Date().toISOString(),
    totalBurnedAllTime: totalBurned.toString(),
    totalBurners: allRecords.filter((r) => BigInt(r.totalBurnedWei) > BigInt(0)).length,
    topBurners: sorted.slice(0, 20).map((r) => ({
      fid: r.fid,
      username: r.username,
      address: r.address,
      totalBurnedWei: r.totalBurnedWei,
      tier: r.tier,
      tierEmoji: TIER_DEFINITIONS[r.tier].emoji
    }))
  };

  if (isKvConfigured) {
    try {
      await kv.set(ASCENSION_LEADERBOARD_KEY, leaderboard);
    } catch (err) {
      console.error('[ascension] Failed to save leaderboard:', err);
    }
  }

  return leaderboard;
}

// Get cached leaderboard
export async function getAscensionLeaderboard(): Promise<AscensionLeaderboard | null> {
  if (!isKvConfigured) return null;
  try {
    return await kv.get<AscensionLeaderboard>(ASCENSION_LEADERBOARD_KEY);
  } catch {
    return null;
  }
}

// Get total burned protocol-wide
export async function getTotalBurned(): Promise<bigint> {
  if (!isKvConfigured) return BigInt(0);
  try {
    const total = await kv.get<string>(TOTAL_BURNED_KEY);
    return BigInt(total ?? '0');
  } catch {
    return BigInt(0);
  }
}

// Helper: Format m00n amount for display
export function formatMoonAmount(wei: bigint): string {
  const amount = Number(wei) / 10 ** 18;
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toFixed(0);
}

// Helper: Parse formatted amount to wei
export function parseMoonAmount(formatted: string): bigint {
  const cleaned = formatted.toUpperCase().replace(/,/g, '');
  let multiplier = BigInt(1);

  if (cleaned.endsWith('B')) {
    multiplier = BigInt(1_000_000_000);
  } else if (cleaned.endsWith('M')) {
    multiplier = BigInt(1_000_000);
  } else if (cleaned.endsWith('K')) {
    multiplier = BigInt(1_000);
  }

  const numPart = parseFloat(cleaned.replace(/[BMK]/gi, ''));
  return BigInt(Math.floor(numPart)) * multiplier * MOON_DECIMALS;
}
