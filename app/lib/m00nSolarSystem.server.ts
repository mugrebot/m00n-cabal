if (typeof process !== 'undefined' && process.env.NEXT_RUNTIME) {
  import('server-only');
}

import { GraphQLClient, gql } from 'graphql-request';
import { Pool } from '@uniswap/v4-sdk';
import { Token } from '@uniswap/sdk-core';
import { formatUnits, type Address } from 'viem';

import { getAddressLabel, loadAddressLabelMap } from '@/app/lib/addressLabels';
import {
  computePositionValueUsd,
  enrichManyPositionsWithAmounts,
  getManyPositionDetails,
  getPositionIds
} from '@/app/lib/uniswapV4Positions';
import { getWmonUsdPriceFromSubgraph } from '@/app/lib/pricing/monadPrices';
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
const POSITION_SAMPLE_SIZE = Number(
  process.env.M00N_SOLAR_POSITION_SAMPLE_SIZE ?? process.env.M00N_SOLAR_POOL_SAMPLE_SIZE ?? 100
);
const POSITION_PAGE_SIZE = Number(process.env.M00N_SOLAR_POSITION_PAGE_SIZE ?? 100);
const LABEL_OWNER_LOOKUP_LIMIT = Number(process.env.M00N_SOLAR_LABEL_OWNER_LIMIT ?? 50);
const SEED_OWNER_ADDRESSES = (process.env.M00N_SOLAR_SEED_ADDRESSES ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const OWNER_BATCH_SIZE = Number(process.env.M00N_SOLAR_OWNER_BATCH_SIZE ?? 40);
const OWNER_POSITIONS_PER_BATCH = Number(process.env.M00N_SOLAR_OWNER_POSITIONS_PER_BATCH ?? 40);
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
const EXCLUDED_OWNER_ADDRESSES = new Set(
  [
    '0xbf4977f1295454cb46d95fe7d8e1d99e32d8aed1',
    ...(process.env.M00N_SOLAR_EXCLUDED_OWNERS ?? '').split(',')
  ]
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.startsWith('0x') && entry.length === 42)
);

const SPECIAL_PLANETS: Record<
  string,
  { label: string; planetKind: 'jupiter' | 'neptune'; planetColor: string }
> = {
  '32578': { label: 'Jupiter', planetKind: 'jupiter', planetColor: '#d4b483' },
  '32584': { label: 'Neptune', planetKind: 'neptune', planetColor: '#5db0ff' }
};

const GET_RECENT_POSITIONS = gql`
  query GetRecentPositions($first: Int!, $skip: Int!) {
    positions(orderBy: createdAtTimestamp, orderDirection: desc, first: $first, skip: $skip) {
      tokenId
      owner
      createdAtTimestamp
    }
  }
`;

const GET_POSITIONS_FOR_OWNERS = gql`
  query GetPositionsForOwners($owners: [String!]!, $first: Int!) {
    positions(
      where: { owner_in: $owners }
      orderBy: createdAtTimestamp
      orderDirection: desc
      first: $first
    ) {
      tokenId
      owner
      createdAtTimestamp
    }
  }
`;

const GET_POSITIONS_BY_TOKEN_IDS = gql`
  query GetPositionsByTokenIds($tokenIds: [BigInt!]!) {
    positions(where: { tokenId_in: $tokenIds }) {
      tokenId
      owner
      createdAtTimestamp
    }
  }
`;

const LOWER_MOON_ADDRESS = TOKEN_MOON_ADDRESS.toLowerCase();
const LOWER_WMON_ADDRESS = TOKEN_WMON_ADDRESS.toLowerCase();
const LOWER_HOOK_ADDRESS = HOOK_ADDRESS.toLowerCase();

type PositionRecord = {
  tokenId: string;
  owner: string;
  createdAtTimestamp?: string;
};

const normalizeAddress = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith('0x') || trimmed.length !== 42) {
    return null;
  }
  return trimmed;
};

async function fetchRecentPositionCandidates(limit: number) {
  const target = Math.max(0, limit);
  if (!target) return [];
  const perPage = Math.min(POSITION_PAGE_SIZE, target);
  const collected: PositionRecord[] = [];
  let skip = 0;

  while (collected.length < target) {
    const remaining = target - collected.length;
    const pageSize = Math.min(perPage, remaining);
    try {
      const data = (await graphClient.request(GET_RECENT_POSITIONS, {
        first: pageSize,
        skip
      })) as {
        positions: PositionRecord[];
      };
      const page = data.positions ?? [];
      if (!page.length) {
        break;
      }
      collected.push(...page);
      skip += page.length;
      if (page.length < pageSize) {
        break;
      }
    } catch (error) {
      console.error('[m00nSolarSystem] Failed to fetch recent position candidates', error);
      break;
    }
  }

  return collected;
}

function chunkArray<T>(input: T[], size: number): T[][] {
  if (size <= 0) return [input];
  const result: T[][] = [];
  for (let i = 0; i < input.length; i += size) {
    result.push(input.slice(i, i + size));
  }
  return result;
}

async function fetchPositionsForOwners(owners: string[], limitPerChunk: number) {
  if (!owners.length) return [];
  const chunks = chunkArray(
    owners
      .map((address) => address.toLowerCase())
      .filter((address) => address.startsWith('0x') && address.length === 42),
    OWNER_BATCH_SIZE
  );
  const collected: PositionRecord[] = [];

  for (const chunk of chunks) {
    try {
      const data = (await graphClient.request(GET_POSITIONS_FOR_OWNERS, {
        owners: chunk,
        first: limitPerChunk
      })) as {
        positions: PositionRecord[];
      };
      if (data.positions?.length) {
        collected.push(...data.positions);
      }
    } catch (error) {
      console.error(
        '[m00nSolarSystem] Failed to fetch owner-scoped positions',
        { chunkSize: chunk.length },
        error
      );
    }
  }

  return collected;
}

async function fetchPositionsByTokenIds(tokenIds: string[]) {
  const filtered = tokenIds.filter((entry) => /^\d+$/.test(entry));
  if (!filtered.length) return [];
  try {
    const data = (await graphClient.request(GET_POSITIONS_BY_TOKEN_IDS, {
      tokenIds: filtered
    })) as {
      positions: PositionRecord[];
    };
    return data.positions ?? [];
  } catch (error) {
    console.error('[m00nSolarSystem] Failed to fetch seed token positions', error);
    return [];
  }
}

function buildOwnerLookupTargets(
  labeledAddresses: string[],
  ownerMap: Map<string, string>
): string[] {
  const seedAddresses = Array.from(
    new Set(
      SEED_OWNER_ADDRESSES.map((entry) => normalizeAddress(entry)).filter(
        (entry): entry is string => Boolean(entry)
      )
    )
  );

  const labelAddresses = labeledAddresses
    .map((address) => normalizeAddress(address))
    .filter((address): address is string => {
      if (!address) return false;
      return !seedAddresses.includes(address);
    });

  const limitedLabelAddresses = labelAddresses.slice(0, Math.max(0, LABEL_OWNER_LOOKUP_LIMIT));

  const combined = [...seedAddresses, ...limitedLabelAddresses];

  // Ensure we always retain owners already discovered via subgraph to preserve mapping.
  for (const owner of ownerMap.values()) {
    const normalized = normalizeAddress(owner);
    if (normalized && !combined.includes(normalized)) {
      combined.push(normalized);
    }
  }

  return combined;
}

const MAX_SOLAR_POSITIONS = Number(process.env.M00N_SOLAR_POSITION_LIMIT ?? 16);

export async function getTopM00nLpPositions(limit = MAX_SOLAR_POSITIONS): Promise<LpPosition[]> {
  const debugEnabled = process.env.DEBUG_SOLAR_SYSTEM === '1';
  const labels = loadAddressLabelMap();
  const labeledAddresses = Array.from(labels.keys());
  const ownerMap = new Map<string, string>();
  const tokenIdSet = new Set<bigint>();

  const seedTokenIds = Array.from(
    new Set(
      [
        '15252',
        '15278',
        '15963',
        '16034',
        '16037',
        '16608',
        '32578',
        '32584',
        ...(process.env.M00N_SOLAR_SEED_TOKEN_IDS ?? '').split(',')
      ]
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );

  const [recentPositions, ownerScopedPositions, seedPositions] = await Promise.all([
    fetchRecentPositionCandidates(POSITION_SAMPLE_SIZE),
    fetchPositionsForOwners(labeledAddresses, OWNER_POSITIONS_PER_BATCH),
    fetchPositionsByTokenIds(seedTokenIds)
  ]);

  const candidatePositions = [...recentPositions, ...ownerScopedPositions, ...seedPositions];

  const createdAtMap = new Map<string, number>();

  for (const entry of candidatePositions) {
    if (!entry.tokenId) continue;
    try {
      const id = BigInt(entry.tokenId);
      tokenIdSet.add(id);
      if (entry.owner) {
        ownerMap.set(entry.tokenId, normalizeAddress(entry.owner) ?? entry.owner);
      }
      if (entry.createdAtTimestamp) {
        createdAtMap.set(entry.tokenId, Number(entry.createdAtTimestamp));
      }
    } catch {
      // ignore malformed ids
    }
  }

  for (const seedTokenId of seedTokenIds) {
    try {
      tokenIdSet.add(BigInt(seedTokenId));
    } catch {
      // ignore malformed seeds
    }
  }

  const ownerLookupTargets = buildOwnerLookupTargets(labeledAddresses, ownerMap);
  for (const owner of ownerLookupTargets) {
    try {
      const ids = await getPositionIds(owner as Address);
      ids.forEach((id) => {
        tokenIdSet.add(id);
        ownerMap.set(id.toString(), owner);
      });
    } catch (error) {
      console.warn('[m00nSolarSystem] Failed to load position ids for owner', owner, error);
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

  const wmonPricePromise = getWmonUsdPriceFromSubgraph();
  let baseDetails;
  try {
    baseDetails = await getManyPositionDetails(tokenIds);
  } catch (error) {
    console.error(
      '[m00nSolarSystem] failed to load base details',
      { tokenCandidateCount: tokenIds.length },
      error
    );
    throw error;
  }
  const wmonPriceUsd = await wmonPricePromise;
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
  if (!baseDetails.length) {
    console.warn('[m00nSolarSystem] base details empty', {
      tokenCandidateCount: tokenIds.length
    });
    throw new Error('no_lp_base_details');
  }

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
  if (!targetDetails.length) {
    console.warn('[m00nSolarSystem] no pool-matched positions', {
      tokenCandidateCount: tokenIds.length
    });
    throw new Error('no_matching_m00n_positions');
  }

  let enriched;
  try {
    enriched = await enrichManyPositionsWithAmounts(targetDetails);
  } catch (error) {
    console.error(
      '[m00nSolarSystem] failed to enrich position amounts',
      {
        positionCount: targetDetails.length
      },
      error
    );
    throw error;
  }

  const moonPriceUsd =
    wmonPriceUsd !== null && enriched[0]?.currentTick !== undefined
      ? Math.pow(1.0001, enriched[0].currentTick) * wmonPriceUsd
      : null;

  const resolveOwnerLabel = (owner: string): string | null => getAddressLabel(owner);

  const entries: LpPosition[] = enriched
    .map((position) => {
      const tokenId = position.tokenId.toString();
      const isClankerPool = tokenId === SPECIAL_CLANKER_ID;
      const owner = ownerMap.get(tokenId) ?? '0x0';
      const special = SPECIAL_PLANETS[tokenId];
      const label = isClankerPool ? 'Clanker Pool' : (special?.label ?? resolveOwnerLabel(owner));

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
        label,
        tokenId,
        notionalUsd,
        notionalToken0: Number(formatUnits(position.amount0, 18)),
        notionalToken1: Number(formatUnits(position.amount1, 18)),
        isClankerPool,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        rangeStatus: position.rangeStatus,
        currentTick: position.currentTick,
        planetKind: special?.planetKind,
        planetColor: special?.planetColor,
        createdAtTimestamp: createdAtMap.get(tokenId)
      };
    })
    .filter((entry) => !EXCLUDED_OWNER_ADDRESSES.has(entry.owner.toLowerCase()));

  return entries
    .sort((a, b) => b.notionalUsd - a.notionalUsd)
    .slice(0, limit)
    .map((entry, index) => ({
      ...entry,
      isClankerPool: index === 0 || entry.isClankerPool || entry.tokenId === SPECIAL_CLANKER_ID
    }));
}

export { M00N_POOL_ID };
