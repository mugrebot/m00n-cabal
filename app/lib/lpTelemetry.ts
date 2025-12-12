import { getTopM00nLpPositions } from '@/app/lib/m00nSolarSystem.server';
import type { LpPosition } from '@/app/lib/m00nSolarSystem.types';
import { getAddressLabel } from '@/app/lib/addressLabels';
import { getWmonUsdPriceFromSubgraph } from '@/app/lib/pricing/monadPrices';

// -----------------------------
// Solar system payload builder
// -----------------------------

export type SolarSystemPayload = {
  positions: LpPosition[];
  updatedAt: string;
};

const SOLAR_SYSTEM_LIMIT = Number(process.env.M00N_SOLAR_POSITION_LIMIT ?? 16);

export async function buildSolarSystemPayload(
  limit = SOLAR_SYSTEM_LIMIT
): Promise<SolarSystemPayload> {
  const positions = await getTopM00nLpPositions(limit);
  if (!positions.length) {
    throw new Error('solar_system_positions_empty');
  }
  return {
    positions,
    updatedAt: new Date().toISOString()
  };
}

// -----------------------------
// Leaderboard payload builder
// -----------------------------

type BandType = 'crash_band' | 'upside_band' | 'double_sided' | 'in_range';

const classifyBandType = (position: LpPosition): BandType => {
  const rangeStatus = position.rangeStatus ?? 'in-range';
  // Out of range positions show clear directionality
  // below-range: price < lower bound, position holds 100% token1 (WMON) = crash_band
  // above-range: price > upper bound, position holds 100% token0 (m00n) = upside_band
  if (rangeStatus === 'below-range') return 'crash_band';
  if (rangeStatus === 'above-range') return 'upside_band';

  // In-range: check if BOTH tokens are present (double-sided)
  const hasMoon = (position.notionalToken0 ?? 0) > 0;
  const hasWmon = (position.notionalToken1 ?? 0) > 0;

  // If both tokens present, it's double-sided
  if (hasMoon && hasWmon) return 'double_sided';

  // Single-sided cases
  if (hasMoon && !hasWmon) return 'upside_band'; // Only m00n
  if (!hasMoon && hasWmon) return 'crash_band'; // Only WMON

  // Fallback
  return 'double_sided';
};

const tickToPrice = (tick: number) => Math.pow(1.0001, tick);

export interface LeaderboardEntry {
  tokenId: string;
  owner: string;
  valueUsd: number;
  bandType: BandType;
  label?: string | null;
}

export interface LeaderboardSnapshot {
  updatedAt: string;
  moonPriceUsd: number | null;
  wmonPriceUsd: number | null;
  crashBand: LeaderboardEntry[];
  upsideBand: LeaderboardEntry[];
  mixedBand: LeaderboardEntry[];
  overall: LeaderboardEntry[];
}

const TOP_POSITION_SAMPLE_SIZE = Number(process.env.M00N_SOLAR_LEADERBOARD_SAMPLE_SIZE ?? 200);
const TOP_OVERALL_COUNT = 7;
const SPECIAL_CLANKER_LABEL = 'Clanker Pool';
const EXCLUDED_TOKEN_IDS = new Set(['32578', '32584']);

export async function buildLeaderboardSnapshot(): Promise<LeaderboardSnapshot> {
  const [positions, wmonPriceUsd] = await Promise.all([
    getTopM00nLpPositions(TOP_POSITION_SAMPLE_SIZE),
    getWmonUsdPriceFromSubgraph()
  ]);

  const filtered = positions.filter((p) => !EXCLUDED_TOKEN_IDS.has(p.tokenId));

  if (filtered.length === 0) {
    return {
      updatedAt: new Date().toISOString(),
      moonPriceUsd: null,
      wmonPriceUsd: null,
      crashBand: [],
      upsideBand: [],
      mixedBand: [],
      overall: []
    };
  }

  const referenceTick = filtered[0]?.currentTick ?? null;
  const moonPriceUsd =
    wmonPriceUsd !== null && referenceTick !== null
      ? tickToPrice(referenceTick) * wmonPriceUsd
      : null;

  const entries = filtered.map((position) => {
    const bandType = classifyBandType(position);
    const specialLabel = position.isClankerPool ? SPECIAL_CLANKER_LABEL : null;
    const ownerLabel = specialLabel ?? getAddressLabel(position.owner);

    return {
      tokenId: position.tokenId,
      owner: position.owner,
      bandType,
      valueUsd: position.notionalUsd,
      label: ownerLabel
    };
  });

  entries.sort((a, b) => b.valueUsd - a.valueUsd);

  const crashBand = entries.filter((entry) => entry.bandType === 'crash_band').slice(0, 10);
  const upsideBand = entries.filter((entry) => entry.bandType === 'upside_band').slice(0, 10);
  const mixedBand = entries
    .filter((entry) => entry.bandType === 'double_sided' || entry.bandType === 'in_range')
    .slice(0, 10);
  const overall = entries.slice(0, TOP_OVERALL_COUNT);

  return {
    updatedAt: new Date().toISOString(),
    moonPriceUsd,
    wmonPriceUsd,
    crashBand,
    upsideBand,
    mixedBand,
    overall
  };
}
