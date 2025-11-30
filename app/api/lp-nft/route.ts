import { NextRequest, NextResponse } from 'next/server';
import { GraphQLClient, gql } from 'graphql-request';
import { formatUnits, type Address } from 'viem';
import {
  getUserPositionsSummary,
  enrichManyPositionsWithAmounts,
  type PositionWithAmounts
} from '../../lib/uniswapV4Positions';

interface LpPoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  hooks: string;
}

type BandType = 'crash_band' | 'upside_band' | 'in_range';

interface TokenBreakdown {
  address: string;
  symbol: string;
  label: string;
  decimals: number;
  amountWei: string;
  amountFormatted: string;
}

interface LpPositionApi {
  tokenId: string;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  poolKey: LpPoolKey;
  currentTick: number;
  sqrtPriceX96: string;
  rangeStatus: PositionWithAmounts['rangeStatus'];
  bandType: BandType;
  token0: TokenBreakdown;
  token1: TokenBreakdown;
  priceLowerInToken1: string;
  priceUpperInToken1: string;
}

const TOKEN_METADATA: Record<
  string,
  {
    symbol: string;
    label: string;
    decimals: number;
  }
> = {
  '0x22cd99ec337a2811f594340a4a6e41e4a3022b07': { symbol: 'm00n', label: 'm00nad', decimals: 18 },
  '0x3bd359c1119da7da1d913d1c4d2b7c461115433a': {
    symbol: 'WMON',
    label: 'Wrapped MON',
    decimals: 18
  }
};

const normalize = (value: string) => value.toLowerCase();
const trimTrailingZeros = (value: string) => value.replace(/\.?0+$/, '') || '0';

const formatTokenAmount = (value: bigint, decimals: number) => {
  const formatted = formatUnits(value, decimals);
  return trimTrailingZeros(formatted);
};

const mapRangeToBand = (rangeStatus: PositionWithAmounts['rangeStatus']): BandType => {
  switch (rangeStatus) {
    case 'below-range':
      return 'upside_band';
    case 'above-range':
      return 'crash_band';
    default:
      return 'in_range';
  }
};

const describeToken = (address: string): { symbol: string; label: string; decimals: number } => {
  const meta = TOKEN_METADATA[normalize(address)];
  if (meta) {
    return meta;
  }
  return { symbol: 'token', label: 'Token', decimals: 18 };
};

const tickToPrice = (tick: number): number => {
  return Math.pow(1.0001, tick);
};

const serializePosition = (position: PositionWithAmounts): LpPositionApi => {
  const token0Meta = describeToken(position.poolKey.currency0);
  const token1Meta = describeToken(position.poolKey.currency1);

  const token0: TokenBreakdown = {
    address: position.poolKey.currency0,
    symbol: token0Meta.symbol,
    label: token0Meta.label,
    decimals: token0Meta.decimals,
    amountWei: position.amount0.toString(),
    amountFormatted: formatTokenAmount(position.amount0, token0Meta.decimals)
  };

  const token1: TokenBreakdown = {
    address: position.poolKey.currency1,
    symbol: token1Meta.symbol,
    label: token1Meta.label,
    decimals: token1Meta.decimals,
    amountWei: position.amount1.toString(),
    amountFormatted: formatTokenAmount(position.amount1, token1Meta.decimals)
  };

  const priceLower = tickToPrice(position.tickLower);
  const priceUpper = tickToPrice(position.tickUpper);

  return {
    tokenId: position.tokenId.toString(),
    liquidity: position.liquidity.toString(),
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    poolKey: {
      currency0: position.poolKey.currency0,
      currency1: position.poolKey.currency1,
      fee: position.poolKey.fee,
      hooks: position.poolKey.hooks
    },
    currentTick: position.currentTick,
    sqrtPriceX96: position.sqrtPriceX96.toString(),
    rangeStatus: position.rangeStatus,
    bandType: mapRangeToBand(position.rangeStatus),
    token0,
    token1,
    priceLowerInToken1: priceLower.toString(),
    priceUpperInToken1: priceUpper.toString()
  };
};

const UNISWAP_V4_SUBGRAPH_ID = '3kaAG19ytkGfu8xD7YAAZ3qAQ3UDJRkmKH2kHUuyGHah';
const THE_GRAPH_API_KEY =
  (typeof process !== 'undefined' && process.env.THE_GRAPH_API_KEY) ||
  (typeof process !== 'undefined' && process.env.THEGRAPH_API_KEY) ||
  '';
const UNISWAP_V4_SUBGRAPH_URL =
  (typeof process !== 'undefined' && process.env.UNISWAP_V4_SUBGRAPH_URL?.trim()) ||
  `https://gateway.thegraph.com/api/${THE_GRAPH_API_KEY}/subgraphs/id/${UNISWAP_V4_SUBGRAPH_ID}`;

const graphClient =
  THE_GRAPH_API_KEY || process.env.UNISWAP_V4_SUBGRAPH_URL
    ? new GraphQLClient(UNISWAP_V4_SUBGRAPH_URL)
    : null;

const WMON_WRAPPED_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const MON_NATIVE_SENTINEL = '0x0000000000000000000000000000000000000000';
const USDC_ADDRESS = '0x754704bc059f8c67012fed69bc8a327a5aafb603';
const WMON_USDC_POOL_ID = '0x18a9fc874581f3ba12b7898f80a683c66fd5877fd74b26a85ba9a3a79c549954';

const GET_WMON_USDC_POOL = gql`
  query GetWmonUsdcPool($id: ID!) {
    pool(id: $id) {
      id
      feeTier
      token0Price
      token1Price
      token0 {
        id
        symbol
      }
      token1 {
        id
        symbol
      }
    }
  }
`;

async function getWmonUsdPriceFromSubgraph(): Promise<number | null> {
  if (!graphClient) return null;
  try {
    const data = (await graphClient.request(GET_WMON_USDC_POOL, {
      id: WMON_USDC_POOL_ID.toLowerCase()
    })) as {
      pool?: {
        token0Price: string;
        token1Price: string;
        token0: { id: string };
        token1: { id: string };
      };
    };

    const pool = data.pool;
    if (!pool) return null;

    const token0Id = pool.token0.id.toLowerCase();
    const token1Id = pool.token1.id.toLowerCase();

    if (token0Id === MON_NATIVE_SENTINEL.toLowerCase() && token1Id === USDC_ADDRESS.toLowerCase()) {
      return Number(pool.token1Price);
    }
    if (token1Id === MON_NATIVE_SENTINEL.toLowerCase() && token0Id === USDC_ADDRESS.toLowerCase()) {
      const price = Number(pool.token0Price);
      if (price === 0) return null;
      return price;
    }

    if (
      token0Id === WMON_WRAPPED_ADDRESS.toLowerCase() &&
      token1Id === USDC_ADDRESS.toLowerCase()
    ) {
      return Number(pool.token0Price);
    }
    if (
      token1Id === WMON_WRAPPED_ADDRESS.toLowerCase() &&
      token0Id === USDC_ADDRESS.toLowerCase()
    ) {
      const price = Number(pool.token1Price);
      if (price === 0) return null;
      return 1 / price;
    }

    return null;
  } catch (error) {
    console.warn('Failed to fetch WMON/USD price from subgraph', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json({ error: 'Missing address' }, { status: 400 });
  }

  try {
    const owner = address as Address;
    console.log('LP_NFT_ROUTE:start', { owner });

    const summary = await getUserPositionsSummary(owner);
    const basePositions = summary.lpPositions || [];

    if (basePositions.length === 0) {
      const payload = {
        hasLpNft: summary.hasLpNft,
        hasLpFromOnchain: summary.hasLpFromOnchain,
        hasLpFromSubgraph: summary.hasLpFromSubgraph,
        indexerPositionCount: summary.indexerPositionCount,
        currentTick: 0,
        sqrtPriceX96: '0',
        wmonUsdPrice: null,
        token0: {
          symbol: 'm00n',
          decimals: 18,
          totalSupply: 100_000_000_000,
          circulatingSupply: 95_000_000_000
        },
        lpPositions: []
      };
      console.log('LP_NFT_ROUTE:summary', payload);
      return NextResponse.json(payload);
    }

    const enriched = await enrichManyPositionsWithAmounts(basePositions);
    const responsePositions = enriched.map(serializePosition);

    const poolCurrentTick = responsePositions[0]?.currentTick ?? 0;
    const poolSqrtPriceX96 = responsePositions[0]?.sqrtPriceX96 ?? '0';

    let wmonUsdPrice: number | null = null;
    try {
      wmonUsdPrice = await getWmonUsdPriceFromSubgraph();
    } catch (error) {
      console.warn('Unable to load WMON/USD price', error);
    }

    const payload = {
      hasLpNft: summary.hasLpNft || responsePositions.length > 0,
      hasLpFromOnchain: summary.hasLpFromOnchain,
      hasLpFromSubgraph: summary.hasLpFromSubgraph,
      indexerPositionCount: summary.indexerPositionCount,
      currentTick: poolCurrentTick,
      sqrtPriceX96: poolSqrtPriceX96,
      wmonUsdPrice,
      token0: {
        symbol: 'm00n',
        decimals: 18,
        totalSupply: 100_000_000_000,
        circulatingSupply: 95_000_000_000
      },
      lpPositions: responsePositions
    };

    console.log('LP_NFT_ROUTE:summary', payload);

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error checking LP NFT:', error);
    return NextResponse.json({ error: 'lp_lookup_failed' }, { status: 500 });
  }
}
