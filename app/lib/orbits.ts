/**
 * Orbits System for m00n
 *
 * Like ENS for LP positions - your price range is your "orbit".
 * Creates identity and scarcity around LP positions.
 *
 * ORBIT TIERS (based on market cap range):
 * - Celestial: $200K+ (Elite, few holders)
 * - Ethereal: $100K-$200K
 * - Lunar: $50K-$100K
 * - Stellar: $25K-$50K
 * - Nova: $10K-$25K
 * - Dust: <$10K
 *
 * Features:
 * - Orbit name (based on range)
 * - Tenure (how long you've held the orbit)
 * - Custom naming (for Guardian+ ascension tier)
 */

import { kv } from '@vercel/kv';

// KV keys
const ORBIT_DATA_KEY = 'm00n:orbits:data';
const ORBIT_MAP_KEY = 'm00n:orbits:map';

// Check if KV is configured
const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

// Orbit tier definitions (based on market cap in USD)
export type OrbitTierName = 'celestial' | 'ethereal' | 'lunar' | 'stellar' | 'nova' | 'dust';

export interface OrbitTier {
  name: OrbitTierName;
  displayName: string;
  emoji: string;
  minMarketCap: number;
  maxMarketCap: number | null; // null = no upper limit
  color: string;
  description: string;
}

export const ORBIT_TIERS: Record<OrbitTierName, OrbitTier> = {
  celestial: {
    name: 'celestial',
    displayName: 'Celestial',
    emoji: '🌟',
    minMarketCap: 200_000,
    maxMarketCap: null,
    color: '#b9f2ff',
    description: 'The highest orbit - for true believers'
  },
  ethereal: {
    name: 'ethereal',
    displayName: 'Ethereal',
    emoji: '🔮',
    minMarketCap: 100_000,
    maxMarketCap: 200_000,
    color: '#8c54ff',
    description: 'Above the clouds'
  },
  lunar: {
    name: 'lunar',
    displayName: 'Lunar',
    emoji: '🌙',
    minMarketCap: 50_000,
    maxMarketCap: 100_000,
    color: '#ffd700',
    description: 'Reaching for the moon'
  },
  stellar: {
    name: 'stellar',
    displayName: 'Stellar',
    emoji: '⭐',
    minMarketCap: 25_000,
    maxMarketCap: 50_000,
    color: '#c0c0c0',
    description: 'Among the stars'
  },
  nova: {
    name: 'nova',
    displayName: 'Nova',
    emoji: '✨',
    minMarketCap: 10_000,
    maxMarketCap: 25_000,
    color: '#6ce5b1',
    description: 'A rising star'
  },
  dust: {
    name: 'dust',
    displayName: 'Dust',
    emoji: '💫',
    minMarketCap: 0,
    maxMarketCap: 10_000,
    color: '#666666',
    description: 'From dust we rise'
  }
};

// Get orbit tier from market cap range
export function getOrbitTier(lowerMarketCap: number, upperMarketCap: number): OrbitTier {
  // Use the midpoint of the range to determine tier
  const midpoint = (lowerMarketCap + upperMarketCap) / 2;

  if (midpoint >= 200_000) return ORBIT_TIERS.celestial;
  if (midpoint >= 100_000) return ORBIT_TIERS.ethereal;
  if (midpoint >= 50_000) return ORBIT_TIERS.lunar;
  if (midpoint >= 25_000) return ORBIT_TIERS.stellar;
  if (midpoint >= 10_000) return ORBIT_TIERS.nova;
  return ORBIT_TIERS.dust;
}

// Orbit record for a user's position
export interface OrbitRecord {
  tokenId: string;
  owner: string;
  fid?: number;
  username?: string;

  // Range info (in market cap USD)
  lowerMarketCap: number;
  upperMarketCap: number;

  // Tier
  tier: OrbitTierName;

  // Custom name (if set by Guardian+)
  customName?: string;

  // Tenure
  firstClaimedAt: number; // When they first entered this orbit
  lastUpdatedAt: number;

  // Stats
  tenureDays: number; // How long they've held this orbit
  isCurrentlyInRange: boolean;
}

// Orbit map entry (for visualization)
export interface OrbitMapEntry {
  tier: OrbitTierName;
  lowerMarketCap: number;
  upperMarketCap: number;
  holders: {
    tokenId: string;
    owner: string;
    username?: string;
    customName?: string;
    tenureDays: number;
    isInRange: boolean;
  }[];
  totalValue: number;
}

// Get all orbit data
export async function getOrbitData(): Promise<Record<string, OrbitRecord>> {
  if (!isKvConfigured) return {};
  try {
    const data = await kv.get<Record<string, OrbitRecord>>(ORBIT_DATA_KEY);
    return data ?? {};
  } catch {
    return {};
  }
}

// Get orbit record for a position
export async function getOrbitRecord(tokenId: string): Promise<OrbitRecord | null> {
  const data = await getOrbitData();
  return data[tokenId] ?? null;
}

// Update or create orbit record
export async function updateOrbitRecord(params: {
  tokenId: string;
  owner: string;
  fid?: number;
  username?: string;
  lowerMarketCap: number;
  upperMarketCap: number;
  isCurrentlyInRange: boolean;
}): Promise<OrbitRecord> {
  const { tokenId, owner, fid, username, lowerMarketCap, upperMarketCap, isCurrentlyInRange } =
    params;

  const now = Date.now();
  const data = await getOrbitData();
  const existing = data[tokenId];

  const tier = getOrbitTier(lowerMarketCap, upperMarketCap);

  // Calculate tenure
  let firstClaimedAt = existing?.firstClaimedAt ?? now;
  let tenureDays = 0;

  // If range changed significantly, reset tenure
  if (existing) {
    const oldMidpoint = (existing.lowerMarketCap + existing.upperMarketCap) / 2;
    const newMidpoint = (lowerMarketCap + upperMarketCap) / 2;
    const pctChange = Math.abs(newMidpoint - oldMidpoint) / oldMidpoint;

    if (pctChange > 0.2) {
      // More than 20% change = new orbit
      firstClaimedAt = now;
    }
  }

  tenureDays = Math.floor((now - firstClaimedAt) / (1000 * 60 * 60 * 24));

  const record: OrbitRecord = {
    tokenId,
    owner,
    fid,
    username,
    lowerMarketCap,
    upperMarketCap,
    tier: tier.name,
    customName: existing?.customName,
    firstClaimedAt,
    lastUpdatedAt: now,
    tenureDays,
    isCurrentlyInRange
  };

  // Save to KV
  if (isKvConfigured) {
    try {
      data[tokenId] = record;
      await kv.set(ORBIT_DATA_KEY, data);
    } catch (err) {
      console.error('[orbits] Failed to save orbit record:', err);
    }
  }

  return record;
}

// Set custom orbit name (for Guardian+ users)
export async function setCustomOrbitName(
  tokenId: string,
  customName: string
): Promise<{ success: boolean; message: string }> {
  const data = await getOrbitData();
  const record = data[tokenId];

  if (!record) {
    return { success: false, message: 'Orbit not found' };
  }

  if (customName.length > 24) {
    return { success: false, message: 'Name must be 24 characters or less' };
  }

  record.customName = customName;
  record.lastUpdatedAt = Date.now();

  if (isKvConfigured) {
    try {
      data[tokenId] = record;
      await kv.set(ORBIT_DATA_KEY, data);
    } catch (err) {
      console.error('[orbits] Failed to save custom name:', err);
      return { success: false, message: 'Failed to save' };
    }
  }

  return { success: true, message: `Orbit named "${customName}"` };
}

// Build orbit map (for visualization)
export async function buildOrbitMap(): Promise<OrbitMapEntry[]> {
  const data = await getOrbitData();
  const records = Object.values(data);

  // Group by tier
  const tierGroups = new Map<OrbitTierName, OrbitRecord[]>();
  for (const record of records) {
    const existing = tierGroups.get(record.tier) ?? [];
    existing.push(record);
    tierGroups.set(record.tier, existing);
  }

  // Build map entries
  const mapEntries: OrbitMapEntry[] = [];
  const tierOrder: OrbitTierName[] = ['celestial', 'ethereal', 'lunar', 'stellar', 'nova', 'dust'];

  for (const tierName of tierOrder) {
    const tier = ORBIT_TIERS[tierName];
    const holders = tierGroups.get(tierName) ?? [];

    // Sort by tenure (longest first)
    holders.sort((a, b) => b.tenureDays - a.tenureDays);

    mapEntries.push({
      tier: tierName,
      lowerMarketCap: tier.minMarketCap,
      upperMarketCap: tier.maxMarketCap ?? Infinity,
      holders: holders.slice(0, 10).map((h) => ({
        tokenId: h.tokenId,
        owner: h.owner,
        username: h.username,
        customName: h.customName,
        tenureDays: h.tenureDays,
        isInRange: h.isCurrentlyInRange
      })),
      totalValue: holders.reduce((sum, h) => sum + (h.upperMarketCap - h.lowerMarketCap) / 2, 0)
    });
  }

  // Cache the map
  if (isKvConfigured) {
    try {
      await kv.set(ORBIT_MAP_KEY, {
        entries: mapEntries,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('[orbits] Failed to cache orbit map:', err);
    }
  }

  return mapEntries;
}

// Get cached orbit map
export async function getOrbitMap(): Promise<{
  entries: OrbitMapEntry[];
  updatedAt: string;
} | null> {
  if (!isKvConfigured) return null;
  try {
    return await kv.get<{ entries: OrbitMapEntry[]; updatedAt: string }>(ORBIT_MAP_KEY);
  } catch {
    return null;
  }
}

// Get orbit summary for a user
export async function getUserOrbitSummary(owner: string): Promise<{
  totalOrbits: number;
  highestTier: OrbitTierName;
  longestTenure: number;
  orbits: OrbitRecord[];
} | null> {
  const data = await getOrbitData();
  const userOrbits = Object.values(data).filter(
    (o) => o.owner.toLowerCase() === owner.toLowerCase()
  );

  if (userOrbits.length === 0) return null;

  // Find highest tier and longest tenure
  const tierOrder: OrbitTierName[] = ['celestial', 'ethereal', 'lunar', 'stellar', 'nova', 'dust'];
  let highestTier: OrbitTierName = 'dust';
  let longestTenure = 0;

  for (const orbit of userOrbits) {
    if (tierOrder.indexOf(orbit.tier) < tierOrder.indexOf(highestTier)) {
      highestTier = orbit.tier;
    }
    if (orbit.tenureDays > longestTenure) {
      longestTenure = orbit.tenureDays;
    }
  }

  return {
    totalOrbits: userOrbits.length,
    highestTier,
    longestTenure,
    orbits: userOrbits
  };
}

// Format orbit display name
export function formatOrbitName(record: OrbitRecord): string {
  if (record.customName) {
    return record.customName;
  }

  const tier = ORBIT_TIERS[record.tier];
  const rangeStr = `$${formatCompactNumber(record.lowerMarketCap)}-$${formatCompactNumber(record.upperMarketCap)}`;
  return `${tier.emoji} ${tier.displayName} (${rangeStr})`;
}

// Format compact number
function formatCompactNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toFixed(0);
}
