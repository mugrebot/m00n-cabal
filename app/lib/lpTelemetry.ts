import { GraphQLClient, gql } from 'graphql-request';
import { getTopM00nLpPositions } from '@/app/lib/m00nSolarSystem.server';
import type { LpPosition } from '@/app/lib/m00nSolarSystem.types';
import { loadAddressLabelMap, type AddressLabelRecord } from '@/app/lib/addressLabels';

// -----------------------------
// Solar system payload builder
// -----------------------------

export type SolarSystemPayload = {
  positions: LpPosition[];
  updatedAt: string;
};

export async function buildSolarSystemPayload(limit = 12): Promise<SolarSystemPayload> {
  const positions = await getTopM00nLpPositions(limit);
  return {
    positions,
    updatedAt: new Date().toISOString()
  };
}

// -----------------------------
// Leaderboard payload builder
// -----------------------------

const MONAD_CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? 143);
const TOKEN_WMON_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const UNISWAP_V4_SUBGRAPH_ID = '3kaAG19ytkGfu8xD7YAAZ3qAQ3UDJRkmKH2kHUuyGHah';
const THE_GRAPH_API_KEY =
  (typeof process !== 'undefined' && process.env.THE_GRAPH_API_KEY) ||
  (typeof process !== 'undefined' && process.env.THEGRAPH_API_KEY) ||
  '';
const FALLBACK_SUBGRAPH_URL = THE_GRAPH_API_KEY
  ? `https://gateway.thegraph.com/api/${THE_GRAPH_API_KEY}/subgraphs/id/${UNISWAP_V4_SUBGRAPH_ID}`
  : `https://gateway.thegraph.com/api/subgraphs/id/${UNISWAP_V4_SUBGRAPH_ID}`;
const UNISWAP_V4_SUBGRAPH_URL =
  (typeof process !== 'undefined' && process.env.UNISWAP_V4_SUBGRAPH_URL?.trim()) ||
  FALLBACK_SUBGRAPH_URL;

const WMON_USDC_POOL_ID = '0x18a9fc874581f3ba12b7898f80a683c66fd5877fd74b26a85ba9a3a79c549954';
const GET_WMON_PRICE = gql`
  query GetWmonUsd($id: ID!) {
    pool(id: $id) {
      token0Price
      token1Price
      token0 {
        id
      }
      token1 {
        id
      }
    }
  }
`;

const graphClient = new GraphQLClient(UNISWAP_V4_SUBGRAPH_URL);

const getAddressLabel = (address: string): string | null => {
  if (!address) return null;
  const labels = loadAddressLabelMap();
  const record = labels.get(address.toLowerCase());
  if (!record) return null;
  if (record.username) return record.username;
  if (record.fid) return `FID ${record.fid}`;
  return null;
};

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

async function getWmonUsdPrice(): Promise<number | null> {
  try {
    const data = (await graphClient.request(GET_WMON_PRICE, {
      id: WMON_USDC_POOL_ID.toLowerCase()
    })) as {
      pool?: {
        token0Price: string;
        token1Price: string;
        token0: { id: string };
        token1: { id: string };
      };
    };
    if (!data.pool) return null;
    const t0 = data.pool.token0.id.toLowerCase();
    const t1 = data.pool.token1.id.toLowerCase();
    if (t0 === TOKEN_WMON_ADDRESS.toLowerCase()) {
      return Number(data.pool.token0Price);
    }
    if (t1 === TOKEN_WMON_ADDRESS.toLowerCase()) {
      const price = Number(data.pool.token1Price);
      if (price === 0) return null;
      return 1 / price;
    }
    return null;
  } catch (err) {
    console.error('[lp-leaderboard] Failed to fetch WMON price', err);
    return null;
  }
}

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
const SPECIAL_CLANKER_ID = '6914';
const SPECIAL_CLANKER_LABEL = 'Clanker Pool';

export async function buildLeaderboardSnapshot(): Promise<LeaderboardSnapshot> {
  const [positions, wmonPriceUsd] = await Promise.all([
    getTopM00nLpPositions(TOP_POSITION_SAMPLE_SIZE),
    getWmonUsdPrice()
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
