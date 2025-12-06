import { NextRequest, NextResponse } from 'next/server';
import { formatUnits, type Address } from 'viem';
import {
  getUserPositionsSummary,
  getPositionDetails,
  getCurrentPoolState,
  getPositionFeesPreview
} from '@/app/lib/uniswapV4Positions';
import { getWmonUsdPriceFromSubgraph } from '@/app/lib/pricing/monadPrices';
import { tickToPrice } from '@/app/lib/m00nSolarSystem';

// Avoid BigInt literal parse issues on lower targets
const Q128 = BigInt(2) ** BigInt(128);
const MONAD_CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? 143);

const TOKEN_META: Record<
  string,
  { symbol: string; decimals: number; label: string; isMoon: boolean; isWmon: boolean }
> = {
  '0x22cd99ec337a2811f594340a4a6e41e4a3022b07': {
    symbol: 'm00n',
    decimals: 18,
    label: 'm00n',
    isMoon: true,
    isWmon: false
  },
  '0x3bd359c1119da7da1d913d1c4d2b7c461115433a': {
    symbol: 'WMON',
    decimals: 18,
    label: 'Wrapped MON',
    isMoon: false,
    isWmon: true
  }
};

type FeeEntry = {
  tokenId: string;
  token0: { symbol: string; amount: string };
  token1: { symbol: string; amount: string };
  unclaimed: {
    token0: string;
    token1: string;
    usd?: number | null;
  };
  lifetime: {
    token0: string;
    token1: string;
    usd?: number | null;
  };
  rangeStatus: string;
  bandType: string;
};

const describeToken = (address: string) => {
  const meta = TOKEN_META[address.toLowerCase()];
  if (meta) return meta;
  return { symbol: 'TOKEN', decimals: 18, label: 'Token', isMoon: false, isWmon: false };
};

const computeUsd = (
  token0Meta: ReturnType<typeof describeToken>,
  token1Meta: ReturnType<typeof describeToken>,
  fee0: bigint,
  fee1: bigint,
  moonPriceUsd: number | null,
  wmonPriceUsd: number | null
) => {
  let usd = 0;
  if (token0Meta.isMoon && moonPriceUsd !== null) {
    usd += Number(formatUnits(fee0, token0Meta.decimals)) * moonPriceUsd;
  }
  if (token0Meta.isWmon && wmonPriceUsd !== null) {
    usd += Number(formatUnits(fee0, token0Meta.decimals)) * wmonPriceUsd;
  }
  if (token1Meta.isMoon && moonPriceUsd !== null) {
    usd += Number(formatUnits(fee1, token1Meta.decimals)) * moonPriceUsd;
  }
  if (token1Meta.isWmon && wmonPriceUsd !== null) {
    usd += Number(formatUnits(fee1, token1Meta.decimals)) * wmonPriceUsd;
  }
  return usd === 0 ? null : usd;
};

export async function GET(request: NextRequest) {
  // 1) TokenId preview (mini-app uses this path)
  const tokenIdParam = request.nextUrl.searchParams.get('tokenId');
  if (tokenIdParam) {
    let tokenId: bigint;
    try {
      tokenId = BigInt(tokenIdParam);
    } catch {
      return NextResponse.json({ error: 'invalid_token_id' }, { status: 400 });
    }

    try {
      const preview = await getPositionFeesPreview(tokenId);
      if (!preview) {
        return NextResponse.json({ tokenId: tokenIdParam, fees: null });
      }
      return NextResponse.json({
        tokenId: tokenIdParam,
        fees: {
          token0Wei: preview.amount0.toString(),
          token1Wei: preview.amount1.toString()
        }
      });
    } catch (error) {
      console.error('LP_FEES_ROUTE:preview_failed', { tokenId: tokenIdParam, error });
      return NextResponse.json({ error: 'lp_fee_preview_failed' }, { status: 500 });
    }
  }

  // 2) Address mode (desktop summary)
  const addr = request.nextUrl.searchParams.get('address');
  if (!addr) return NextResponse.json({ error: 'missing_address' }, { status: 400 });
  const owner = addr as Address;

  try {
    const summary = await getUserPositionsSummary(owner);
    const basePositions = summary.lpPositions || [];
    if (basePositions.length === 0) {
      return NextResponse.json({ positions: [], wmonUsdPrice: null, moonPriceUsd: null });
    }

    const detailsList = await Promise.all(
      basePositions.map(async (p) => {
        const details = await getPositionDetails(BigInt(p.tokenId));
        return details;
      })
    );

    const poolState = await getCurrentPoolState(detailsList[0].poolKey);
    const wmonUsdPrice = await getWmonUsdPriceFromSubgraph();
    const moonPriceUsd = wmonUsdPrice !== null ? tickToPrice(poolState.tick) * wmonUsdPrice : null;

    const positions: FeeEntry[] = [];

    for (const details of detailsList) {
      const tokenId = details.tokenId.toString();
      const token0Meta = describeToken(details.poolKey.currency0);
      const token1Meta = describeToken(details.poolKey.currency1);

      // Fetch on-chain fee preview (unclaimed). Lifetime fee growth is not exposed here,
      // so we surface unclaimed amounts and mirror to lifetime as a best-effort view.
      const preview = await getPositionFeesPreview(details.tokenId);
      const unclaimed0 = preview?.amount0 ?? 0n;
      const unclaimed1 = preview?.amount1 ?? 0n;

      const lifetime0 = unclaimed0;
      const lifetime1 = unclaimed1;

      const lifetimeUsd = computeUsd(
        token0Meta,
        token1Meta,
        lifetime0,
        lifetime1,
        moonPriceUsd,
        wmonUsdPrice
      );
      const unclaimedUsd = computeUsd(
        token0Meta,
        token1Meta,
        unclaimed0,
        unclaimed1,
        moonPriceUsd,
        wmonUsdPrice
      );

      positions.push({
        tokenId,
        token0: { symbol: token0Meta.symbol, amount: formatUnits(lifetime0, token0Meta.decimals) },
        token1: { symbol: token1Meta.symbol, amount: formatUnits(lifetime1, token1Meta.decimals) },
        unclaimed: {
          token0: formatUnits(unclaimed0, token0Meta.decimals),
          token1: formatUnits(unclaimed1, token1Meta.decimals),
          usd: unclaimedUsd
        },
        lifetime: {
          token0: formatUnits(lifetime0, token0Meta.decimals),
          token1: formatUnits(lifetime1, token1Meta.decimals),
          usd: lifetimeUsd
        },
        rangeStatus: basePositions.find((p) => p.tokenId === tokenId)?.rangeStatus ?? 'unknown',
        bandType: basePositions.find((p) => p.tokenId === tokenId)?.bandType ?? 'unknown'
      });
    }

    return NextResponse.json({
      positions,
      wmonUsdPrice,
      moonPriceUsd
    });
  } catch (error) {
    console.error('LP_FEES_ROUTE:failed', error);
    return NextResponse.json({ error: 'lp_fees_failed' }, { status: 500 });
  }
}
