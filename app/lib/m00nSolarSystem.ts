import { GraphQLClient, gql } from 'graphql-request';
import { Token } from '@uniswap/sdk-core';
import { Pool } from '@uniswap/v4-sdk';
import { formatUnits } from 'viem';
import {
  computePositionValueUsd,
  enrichManyPositionsWithAmounts,
  getManyPositionDetails
} from '@/app/lib/uniswapV4Positions';

const UNISWAP_V4_SUBGRAPH_ID = '3kaAG19ytkGfu8xD7YAAZ3qAQ3UDJRkmKH2kHUuyGHah';
const THE_GRAPH_API_KEY =
  (typeof process !== 'undefined' && process.env.THE_GRAPH_API_KEY) ||
  (typeof process !== 'undefined' && process.env.THEGRAPH_API_KEY) ||
  '';
const UNISWAP_V4_SUBGRAPH_URL =
  (typeof process !== 'undefined' && process.env.UNISWAP_V4_SUBGRAPH_URL?.trim()) ||
  `https://gateway.thegraph.com/api/${THE_GRAPH_API_KEY}/subgraphs/id/${UNISWAP_V4_SUBGRAPH_ID}`;

const graphClient = new GraphQLClient(UNISWAP_V4_SUBGRAPH_URL);

const TOKEN_MOON_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
const TOKEN_WMON_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const HOOK_ADDRESS = '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc';
const FEE = 8_388_608;
const TICK_SPACING = 200;
const WMON_USDC_POOL_ID = '0x18a9fc874581f3ba12b7898f80a683c66fd5877fd74b26a85ba9a3a79c549954';
const SPECIAL_CLANKER_ID = '6914';

const MONAD_CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? 143);

const GET_TOP_POSITIONS = gql`
  query TopM00nPositions($poolId: String!, $limit: Int!) {
    positions(where: { pool_: { id: $poolId } }, orderBy: id, orderDirection: desc, first: $limit) {
      id
      owner
      tickLower
      tickUpper
    }
  }
`;

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

const moonToken = new Token(MONAD_CHAIN_ID, TOKEN_MOON_ADDRESS, 18, 'm00n', 'm00nad');
const wmonToken = new Token(MONAD_CHAIN_ID, TOKEN_WMON_ADDRESS, 18, 'WMON', 'Wrapped MON');
const poolId = Pool.getPoolId(moonToken, wmonToken, FEE, TICK_SPACING, HOOK_ADDRESS).toLowerCase();

export interface LpPosition {
  owner: string;
  tokenId: string;
  notionalUsd: number;
  notionalToken0?: number;
  notionalToken1?: number;
  isClankerPool: boolean;
  tickLower?: number;
  tickUpper?: number;
}

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
      return price === 0 ? null : 1 / price;
    }
    return null;
  } catch (error) {
    console.error('[m00nSolarSystem] Failed to fetch WMON price', error);
    return null;
  }
}

export async function getTopM00nLpPositions(limit = 8): Promise<LpPosition[]> {
  const response = (await graphClient.request(GET_TOP_POSITIONS, {
    poolId,
    limit: Math.max(limit * 2, 16)
  })) as {
    positions: Array<{
      id: string;
      owner: string;
      tickLower?: string | number | null;
      tickUpper?: string | number | null;
    }>;
  };

  const rawPositions = response.positions ?? [];
  if (rawPositions.length === 0) {
    return [];
  }

  const tokenIds = rawPositions
    .map((p) => {
      try {
        return BigInt(p.id);
      } catch {
        return null;
      }
    })
    .filter((value): value is bigint => value !== null);

  const [details, wmonPriceUsd] = await Promise.all([
    getManyPositionDetails(tokenIds),
    getWmonUsdPrice()
  ]);
  if (!details.length) return [];

  const enriched = await enrichManyPositionsWithAmounts(details);

  const moonPriceUsd =
    wmonPriceUsd !== null && enriched[0]?.currentTick !== undefined
      ? Math.pow(1.0001, enriched[0].currentTick) * wmonPriceUsd
      : null;

  const entries: LpPosition[] = enriched.map((position) => {
    const owner =
      rawPositions.find((subgraphPosition) => subgraphPosition.id === position.tokenId.toString())
        ?.owner ?? '0x0';

    let notionalUsd = 0;
    if (moonPriceUsd !== null && wmonPriceUsd !== null) {
      notionalUsd = computePositionValueUsd(
        { amount0: position.amount0, amount1: position.amount1 },
        moonPriceUsd,
        wmonPriceUsd,
        18,
        18
      );
    }

    return {
      owner,
      tokenId: position.tokenId.toString(),
      notionalUsd,
      notionalToken0: Number(formatUnits(position.amount0, 18)),
      notionalToken1: Number(formatUnits(position.amount1, 18)),
      isClankerPool: position.tokenId.toString() === SPECIAL_CLANKER_ID,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper
    };
  });

  return entries
    .sort((a, b) => b.notionalUsd - a.notionalUsd)
    .slice(0, limit)
    .map((entry, index, arr) => ({
      ...entry,
      isClankerPool: index === 0 || entry.isClankerPool || entry.tokenId === SPECIAL_CLANKER_ID
    }));
}

export function normalizeM00nRadii(
  positions: Pick<LpPosition, 'notionalUsd'>[],
  { minRadius = 26, maxRadius = 96 }: { minRadius?: number; maxRadius?: number } = {}
): number[] {
  if (positions.length === 0) return [];
  const values = positions.map((p) => p.notionalUsd);
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) {
    return positions.map(() => (minRadius + maxRadius) / 2);
  }
  return positions.map((position) => {
    const normalized = (position.notionalUsd - min) / (max - min);
    return minRadius + normalized * (maxRadius - minRadius);
  });
}

export function computeSatelliteOrbit(
  satelliteIndex: number,
  totalSatellites: number,
  {
    centerX,
    centerY,
    orbitBase,
    orbitStep,
    timeMs,
    rotationSpeed = 0.00015
  }: {
    centerX: number;
    centerY: number;
    orbitBase: number;
    orbitStep: number;
    timeMs: number;
    rotationSpeed?: number;
  }
) {
  const stepAngle = (2 * Math.PI) / Math.max(totalSatellites, 1);
  const baseAngle = satelliteIndex * stepAngle;
  const animatedAngle = baseAngle + timeMs * rotationSpeed;
  const orbitRadius = orbitBase + satelliteIndex * orbitStep;
  return {
    x: centerX + orbitRadius * Math.cos(animatedAngle),
    y: centerY + orbitRadius * Math.sin(animatedAngle),
    orbitRadius
  };
}

export const truncateAddress = (address: string, visible = 4) => {
  if (!address) return '';
  return `${address.slice(0, visible + 2)}…${address.slice(-visible)}`;
};

export const formatUsd = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
