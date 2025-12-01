import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { GraphQLClient, gql } from 'graphql-request';
import { parse } from 'csv-parse/sync';
import {
  enrichManyPositionsWithAmounts,
  getManyPositionDetails,
  computePositionValueUsd
} from '@/app/lib/uniswapV4Positions';

const TOKEN_MOON_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
const TOKEN_WMON_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const HOOK_ADDRESS = '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc';
const FEE = 8_388_608;
const TICK_SPACING = 200;
const MONAD_CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? 143);
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

const GET_TOP_POSITIONS = gql`
  query GetTopPositions($first: Int!) {
    positions(orderBy: id, orderDirection: desc, first: $first) {
      tokenId
      owner
    }
  }
`;

const TOP_POSITION_SAMPLE_SIZE = 120;
const TOP_OVERALL_COUNT = 7;
const SPECIAL_CLANKER_ID = '6914';
const SPECIAL_CLANKER_LABEL = 'Clanker Pool';

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

const LOWER_MOON_ADDRESS = TOKEN_MOON_ADDRESS.toLowerCase();
const LOWER_WMON_ADDRESS = TOKEN_WMON_ADDRESS.toLowerCase();
const LOWER_HOOK_ADDRESS = HOOK_ADDRESS.toLowerCase();

const graphClient = new GraphQLClient(UNISWAP_V4_SUBGRAPH_URL);

interface AddressLabelRecord {
  fid?: number | null;
  username?: string | null;
}

let addressLabelCache: Map<string, AddressLabelRecord> | null = null;

const ADDRESS_CSV_PATH =
  process.env.LEADERBOARD_ADDRESS_CSV ?? path.join(process.cwd(), 'apps', 'm00n - m00n.csv.csv');

const loadAddressLabelMap = (): Map<string, AddressLabelRecord> => {
  if (addressLabelCache) {
    return addressLabelCache;
  }
  try {
    const file = fs.readFileSync(ADDRESS_CSV_PATH, 'utf8');
    const rows = parse(file, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Record<string, string>[];
    addressLabelCache = new Map();
    for (const row of rows) {
      const address = row.address?.toLowerCase();
      if (!address) continue;
      const fid = Number(row.fid);
      addressLabelCache.set(address, {
        fid: Number.isFinite(fid) ? fid : null,
        username: row.username?.trim() || null
      });
    }
  } catch (err) {
    console.warn('[lp-leaderboard] Unable to load address labels', err);
    addressLabelCache = new Map();
  }
  return addressLabelCache!;
};

const getAddressLabel = (address: string): string | null => {
  if (!address) return null;
  const labels = loadAddressLabelMap();
  const record = labels.get(address.toLowerCase());
  if (!record) return null;
  if (record.username) {
    return record.username;
  }
  if (record.fid) {
    return `FID ${record.fid}`;
  }
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
    console.error('Failed to fetch WMON price', err);
    return null;
  }
}

export async function GET() {
  try {
    const { positions } = (await graphClient.request(GET_TOP_POSITIONS, {
      first: TOP_POSITION_SAMPLE_SIZE
    })) as {
      positions: { tokenId: string; owner: string }[];
    };

    if (!positions || positions.length === 0) {
      return NextResponse.json({
        updatedAt: new Date().toISOString(),
        moonPriceUsd: null,
        wmonPriceUsd: null,
        crashBand: [],
        upsideBand: [],
        mixedBand: [],
        overall: []
      });
    }

    const ownerMap = new Map<string, string>();
    const tokenIds = positions.map((pos) => {
      ownerMap.set(pos.tokenId, pos.owner);
      return BigInt(pos.tokenId);
    });

    const baseDetails = await getManyPositionDetails(tokenIds);
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

    if (!targetDetails.length) {
      return NextResponse.json({
        updatedAt: new Date().toISOString(),
        moonPriceUsd: null,
        wmonPriceUsd: null,
        crashBand: [],
        upsideBand: [],
        mixedBand: [],
        overall: []
      });
    }

    const enriched = await enrichManyPositionsWithAmounts(targetDetails);

    const wmonPriceUsd = await getWmonUsdPrice();
    const referenceTick = enriched[0]?.currentTick ?? 0;
    const moonInWmon = tickToPrice(referenceTick);
    const moonPriceUsd = wmonPriceUsd !== null ? moonInWmon * wmonPriceUsd : null;

    const entries = enriched.map((position) => {
      const bandType = mapRangeToBand(position.rangeStatus);
      const ownerAddress = ownerMap.get(position.tokenId.toString()) ?? '0x0';
      const specialLabel =
        position.tokenId.toString() === SPECIAL_CLANKER_ID ? SPECIAL_CLANKER_LABEL : null;
      const ownerLabel = specialLabel ?? getAddressLabel(ownerAddress);
      const valueUsd =
        moonPriceUsd !== null && wmonPriceUsd !== null
          ? computePositionValueUsd(
              { amount0: position.amount0, amount1: position.amount1 },
              moonPriceUsd,
              wmonPriceUsd,
              18,
              18
            )
          : 0;

      return {
        tokenId: position.tokenId.toString(),
        owner: ownerAddress,
        bandType,
        valueUsd,
        label: ownerLabel
      };
    });

    entries.sort((a, b) => b.valueUsd - a.valueUsd);

    const crashBand = entries.filter((entry) => entry.bandType === 'crash_band').slice(0, 10);
    const upsideBand = entries.filter((entry) => entry.bandType === 'upside_band').slice(0, 10);
    const mixedBand = entries.filter((entry) => entry.bandType === 'in_range').slice(0, 10);
    const overall = entries.slice(0, TOP_OVERALL_COUNT);

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      moonPriceUsd,
      wmonPriceUsd,
      crashBand,
      upsideBand,
      mixedBand,
      overall
    });
  } catch (error) {
    console.error('Leaderboard lookup failed', error);
    return NextResponse.json({ error: 'leaderboard_failed' }, { status: 500 });
  }
}
