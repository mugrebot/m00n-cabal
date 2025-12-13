import { NextRequest, NextResponse } from 'next/server';
import { formatUnits, type Address } from 'viem';
import {
  getUserPositionsSummary,
  enrichManyPositionsWithAmounts,
  type PositionWithAmounts
} from '../../lib/uniswapV4Positions';
import { getWmonUsdPriceFromSubgraph } from '@/app/lib/pricing/monadPrices';

interface LpPoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  hooks: string;
}

type BandType = 'crash_band' | 'upside_band' | 'double_sided' | 'in_range';

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
  createdAtTimestamp?: number;
  fees?: {
    token0Wei: string;
    token1Wei: string;
    token0Formatted: string;
    token1Formatted: string;
  };
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

const classifyBandType = (
  rangeStatus: PositionWithAmounts['rangeStatus'],
  token0Amount: bigint,
  token1Amount: bigint
): BandType => {
  // Out of range positions show clear directionality
  // below-range: price < lower bound, position holds 100% token1 (WMON) = crash_band
  // above-range: price > upper bound, position holds 100% token0 (m00n) = upside_band
  if (rangeStatus === 'below-range') return 'crash_band';
  if (rangeStatus === 'above-range') return 'upside_band';

  // In-range: check if BOTH tokens are present (double-sided)
  // token0 = m00n, token1 = WMON
  const hasMoon = token0Amount > BigInt(0);
  const hasWmon = token1Amount > BigInt(0);

  // If both tokens present, it's double-sided
  if (hasMoon && hasWmon) return 'double_sided';

  // Single-sided cases
  if (hasMoon && !hasWmon) return 'upside_band'; // Only m00n
  if (!hasMoon && hasWmon) return 'crash_band'; // Only WMON

  // Fallback
  return 'double_sided';
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
    bandType: classifyBandType(position.rangeStatus, position.amount0, position.amount1),
    token0,
    token1,
    priceLowerInToken1: priceLower.toString(),
    priceUpperInToken1: priceUpper.toString(),
    createdAtTimestamp: position.createdAtTimestamp
  };
};

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
    const positionsWithFees: LpPositionApi[] = responsePositions;

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
        circulatingSupply: 70_000_000_000
      },
      lpPositions: positionsWithFees
    };

    console.log('LP_NFT_ROUTE:summary', payload);

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error checking LP NFT:', error);
    return NextResponse.json({ error: 'lp_lookup_failed' }, { status: 500 });
  }
}
