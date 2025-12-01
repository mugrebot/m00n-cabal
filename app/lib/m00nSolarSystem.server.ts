if (typeof process !== 'undefined' && process.env.NEXT_RUNTIME) {
  import('server-only');
}

import { GraphQLClient, gql } from 'graphql-request';
import { Pool } from '@uniswap/v4-sdk';
import { Token } from '@uniswap/sdk-core';
import { formatUnits, type Address } from 'viem';

import { loadAddressLabelMap } from '@/app/lib/addressLabels';
import {
  computePositionValueUsd,
  enrichManyPositionsWithAmounts,
  getManyPositionDetails,
  getPositionIds
} from '@/app/lib/uniswapV4Positions';
import type { LpPosition } from '@/app/lib/m00nSolarSystem.types';

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
const POOL_SAMPLE_SIZE = Number(process.env.M00N_SOLAR_POOL_SAMPLE_SIZE ?? 120);
const SPECIAL_CLANKER_ID = '6914';
const FALLBACK_M00N_POOL_ID = '0x4934249c6914ae7cfb16d19a069437811a2d119d3785ca2e8188e8606be54abd';

const MONAD_CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? 143);

const moonToken = new Token(MONAD_CHAIN_ID, TOKEN_MOON_ADDRESS, 18, 'm00n', 'm00nad');
const wmonToken = new Token(MONAD_CHAIN_ID, TOKEN_WMON_ADDRESS, 18, 'WMON', 'Wrapped MON');
const [token0, token1] = moonToken.sortsBefore(wmonToken)
  ? [moonToken, wmonToken]
  : [wmonToken, moonToken];
const computedPoolId = Pool.getPoolId(
  token0,
  token1,
  FEE,
  TICK_SPACING,
  HOOK_ADDRESS
).toLowerCase();
const M00N_POOL_ID = (
  process.env.M00N_POOL_ID ??
  FALLBACK_M00N_POOL_ID ??
  computedPoolId
).toLowerCase();

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

const GET_POOL_POSITIONS = gql`
  query GetPoolPositions($poolId: String!, $first: Int!) {
    positions(where: { pool: $poolId }, orderBy: id, orderDirection: desc, first: $first) {
      tokenId
      owner
    }
  }
`;

const LOWER_MOON_ADDRESS = TOKEN_MOON_ADDRESS.toLowerCase();
const LOWER_WMON_ADDRESS = TOKEN_WMON_ADDRESS.toLowerCase();
const LOWER_HOOK_ADDRESS = HOOK_ADDRESS.toLowerCase();

async function fetchPoolTokenIds(limit: number) {
  try {
    const data = (await graphClient.request(GET_POOL_POSITIONS, {
      poolId: M00N_POOL_ID,
      first: limit
    })) as {
      positions: Array<{ tokenId: string; owner: string }>;
    };
    return data.positions ?? [];
  } catch (error) {
    console.error('[m00nSolarSystem] Failed to fetch pool tokenIds', error);
    return [];
  }
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
  const debugEnabled = process.env.DEBUG_SOLAR_SYSTEM === '1';
  const labels = loadAddressLabelMap();
  const ownerMap = new Map<string, string>();
  const tokenIdSet = new Set<bigint>();

  for (const [address] of labels) {
    try {
      const ids = await getPositionIds(address as Address);
      ids.forEach((id) => {
        tokenIdSet.add(id);
        ownerMap.set(id.toString(), address);
      });
    } catch (error) {
      console.warn('[m00nSolarSystem] Failed to load position ids for', address, error);
    }
  }

  const poolPositions = await fetchPoolTokenIds(POOL_SAMPLE_SIZE);
  for (const entry of poolPositions) {
    if (!entry.tokenId) continue;
    try {
      const id = BigInt(entry.tokenId);
      tokenIdSet.add(id);
      if (entry.owner) {
        ownerMap.set(entry.tokenId, entry.owner);
      }
    } catch {
      // ignore malformed ids
    }
  }

  try {
    tokenIdSet.add(BigInt(SPECIAL_CLANKER_ID));
    ownerMap.set(SPECIAL_CLANKER_ID, '0x0');
  } catch {
    // ignore
  }
  if (debugEnabled) {
    console.log('[m00nSolarSystem] token candidates', tokenIdSet.size);
  }
  if (tokenIdSet.size === 0) {
    return [];
  }

  const tokenIds = Array.from(tokenIdSet);

  const [baseDetails, wmonPriceUsd] = await Promise.all([
    getManyPositionDetails(tokenIds),
    getWmonUsdPrice()
  ]);
  if (debugEnabled) {
    console.log('[m00nSolarSystem] base details fetched', baseDetails.length);
    console.log(
      '[m00nSolarSystem] sample base details',
      baseDetails.slice(0, 3).map((entry) => ({
        tokenId: entry.tokenId.toString(),
        poolKey: entry.poolKey
      }))
    );
  }
  if (!baseDetails.length) return [];

  const targetDetails = baseDetails.filter((position) => {
    const currency0 = position.poolKey.currency0.toLowerCase();
    const currency1 = position.poolKey.currency1.toLowerCase();
    const pairMatch =
      (currency0 === LOWER_MOON_ADDRESS && currency1 === LOWER_WMON_ADDRESS) ||
      (currency0 === LOWER_WMON_ADDRESS && currency1 === LOWER_MOON_ADDRESS);
    const hookMatch = position.poolKey.hooks.toLowerCase() === LOWER_HOOK_ADDRESS;
    return (
      pairMatch &&
      hookMatch &&
      position.poolKey.fee === FEE &&
      position.poolKey.tickSpacing === TICK_SPACING
    );
  });
  if (debugEnabled) {
    console.log('[m00nSolarSystem] filtered target details', targetDetails.length);
    console.log(
      '[m00nSolarSystem] sample filtered',
      targetDetails.slice(0, 3).map((entry) => ({
        tokenId: entry.tokenId.toString(),
        poolKey: entry.poolKey
      }))
    );
  }
  if (!targetDetails.length) return [];

  const enriched = await enrichManyPositionsWithAmounts(targetDetails);

  const moonPriceUsd =
    wmonPriceUsd !== null && enriched[0]?.currentTick !== undefined
      ? Math.pow(1.0001, enriched[0].currentTick) * wmonPriceUsd
      : null;

  const entries: LpPosition[] = enriched.map((position) => {
    const owner = ownerMap.get(position.tokenId.toString()) ?? '0x0';

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
      tickUpper: position.tickUpper,
      rangeStatus: position.rangeStatus,
      currentTick: position.currentTick
    };
  });

  return entries
    .sort((a, b) => b.notionalUsd - a.notionalUsd)
    .slice(0, limit)
    .map((entry, index) => ({
      ...entry,
      isClankerPool: index === 0 || entry.isClankerPool || entry.tokenId === SPECIAL_CLANKER_ID
    }));
}

export { M00N_POOL_ID };
