import { NextResponse } from 'next/server';
import { GraphQLClient, gql } from 'graphql-request';
import { Token } from '@uniswap/sdk-core';
import { Pool } from '@uniswap/v4-sdk';
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
const UNISWAP_V4_SUBGRAPH_URL =
  (typeof process !== 'undefined' && process.env.UNISWAP_V4_SUBGRAPH_URL?.trim()) ||
  `https://gateway.thegraph.com/api/${THE_GRAPH_API_KEY}/subgraphs/id/${UNISWAP_V4_SUBGRAPH_ID}`;

const GET_TOP_POSITIONS = gql`
  query GetTopPositions($poolId: String!, $first: Int!) {
    positions(where: { pool: $poolId }, orderBy: liquidity, orderDirection: desc, first: $first) {
      tokenId
      owner
    }
  }
`;

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

const moonToken = new Token(MONAD_CHAIN_ID, TOKEN_MOON_ADDRESS, 18, 'm00n', 'm00nad');
const wmonToken = new Token(MONAD_CHAIN_ID, TOKEN_WMON_ADDRESS, 18, 'WMON', 'Wrapped MON');
const poolId = Pool.getPoolId(
  moonToken,
  wmonToken,
  FEE,
  TICK_SPACING,
  HOOK_ADDRESS.toLowerCase()
).toLowerCase();

const graphClient = new GraphQLClient(UNISWAP_V4_SUBGRAPH_URL);

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
      poolId,
      first: 60
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
    const enriched = await enrichManyPositionsWithAmounts(baseDetails);

    const wmonPriceUsd = await getWmonUsdPrice();
    const referenceTick = enriched[0]?.currentTick ?? 0;
    const moonInWmon = tickToPrice(referenceTick);
    const moonPriceUsd = wmonPriceUsd !== null ? moonInWmon * wmonPriceUsd : null;

    const entries = enriched.map((position) => {
      const bandType = mapRangeToBand(position.rangeStatus);
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
        owner: ownerMap.get(position.tokenId.toString()) ?? '0x0',
        bandType,
        valueUsd
      };
    });

    entries.sort((a, b) => b.valueUsd - a.valueUsd);

    const crashBand = entries.filter((entry) => entry.bandType === 'crash_band').slice(0, 10);
    const upsideBand = entries.filter((entry) => entry.bandType === 'upside_band').slice(0, 10);
    const mixedBand = entries.filter((entry) => entry.bandType === 'in_range').slice(0, 10);
    const overall = entries.slice(0, 10);

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
