import { NextRequest, NextResponse } from 'next/server';

import { getPositionFeesPreview } from '@/app/lib/uniswapV4Positions';

export async function GET(request: NextRequest) {
  const tokenIdParam = request.nextUrl.searchParams.get('tokenId');

  if (!tokenIdParam) {
    return NextResponse.json({ error: 'missing_token_id' }, { status: 400 });
  }

  let tokenId: bigint;
  try {
    tokenId = BigInt(tokenIdParam);
  } catch {
    return NextResponse.json({ error: 'invalid_token_id' }, { status: 400 });
  }

  try {
    const preview = await getPositionFeesPreview(tokenId);
    if (!preview) {
      return NextResponse.json({
        tokenId: tokenIdParam,
        fees: null
      });
    }

    return NextResponse.json({
      tokenId: tokenIdParam,
      fees: {
        token0Wei: preview.amount0.toString(),
        token1Wei: preview.amount1.toString()
      }
    });
  } catch (error) {
    console.error('LP_FEES_ROUTE:failed', { tokenId: tokenIdParam, error });
    return NextResponse.json({ error: 'lp_fee_preview_failed' }, { status: 500 });
  }
}
