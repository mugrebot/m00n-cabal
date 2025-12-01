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

export async function buildSolarSystemPayload(limit = 12): Promise<SolarSystemPayload> {
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

type BandType = 'crash_band' | 'upside_band' | 'in_range';

const mapRangeToBand = (rangeStatus: 'below-range' | 'in-range' | 'above-range'): BandType => {
  switch (rangeStatus) {
    case 'below-range':
      return 'upside_band';
    case 'above-range':
      return 'crash_band';
    default:
      return 'in_range';
  }
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

const TOP_POSITION_SAMPLE_SIZE = 120;
const TOP_OVERALL_COUNT = 7;
const SPECIAL_CLANKER_LABEL = 'Clanker Pool';

export async function buildLeaderboardSnapshot(): Promise<LeaderboardSnapshot> {
  const [positions, wmonPriceUsd] = await Promise.all([
    getTopM00nLpPositions(TOP_POSITION_SAMPLE_SIZE),
    getWmonUsdPriceFromSubgraph()
  ]);

  if (positions.length === 0) {
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

  const referenceTick = positions[0]?.currentTick ?? null;
  const moonPriceUsd =
    wmonPriceUsd !== null && referenceTick !== null
      ? tickToPrice(referenceTick) * wmonPriceUsd
      : null;

  const entries = positions.map((position) => {
    const bandType = mapRangeToBand(position.rangeStatus ?? 'in-range');
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
  const mixedBand = entries.filter((entry) => entry.bandType === 'in_range').slice(0, 10);
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
