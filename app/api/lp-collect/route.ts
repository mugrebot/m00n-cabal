import { NextRequest, NextResponse } from 'next/server';
import { Percent, Token } from '@uniswap/sdk-core';
import { Pool, Position, V4PositionManager } from '@uniswap/v4-sdk';
import { isAddress } from 'viem';

import {
  getCurrentPoolState,
  getPositionDetails,
  type PositionDetails
} from '@/app/lib/uniswapV4Positions';

const POSITION_MANAGER_ADDRESS = '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016';
const TOKEN_METADATA: Record<
  string,
  {
    symbol: string;
    decimals: number;
  }
> = {
  '0x22cd99ec337a2811f594340a4a6e41e4a3022b07': { symbol: 'm00n', decimals: 18 },
  '0x3bd359c1119da7da1d913d1c4d2b7c461115433a': { symbol: 'WMON', decimals: 18 }
};

const MONAD_CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? 143);
const COLLECT_DEADLINE_SECONDS = 10 * 60;

const describeTokenMeta = (address: string) => {
  const meta = TOKEN_METADATA[address.toLowerCase()];
  if (meta) return meta;
  return {
    symbol: 'TOKEN',
    decimals: 18
  };
};

const buildPool = async (positionDetails: PositionDetails) => {
  const poolState = await getCurrentPoolState(positionDetails.poolKey);
  const token0Meta = describeTokenMeta(positionDetails.poolKey.currency0);
  const token1Meta = describeTokenMeta(positionDetails.poolKey.currency1);
  const token0 = new Token(
    MONAD_CHAIN_ID,
    positionDetails.poolKey.currency0,
    token0Meta.decimals,
    token0Meta.symbol
  );
  const token1 = new Token(
    MONAD_CHAIN_ID,
    positionDetails.poolKey.currency1,
    token1Meta.decimals,
    token1Meta.symbol
  );

  return new Pool(
    token0,
    token1,
    positionDetails.poolKey.fee,
    positionDetails.poolKey.tickSpacing,
    positionDetails.poolKey.hooks,
    poolState.sqrtPriceX96.toString(),
    poolState.liquidity.toString(),
    poolState.tick
  );
};

export async function POST(request: NextRequest) {
  let body: { tokenId?: string; recipient?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { tokenId: tokenIdParam, recipient } = body;
  if (!tokenIdParam) {
    return NextResponse.json({ error: 'missing_token_id' }, { status: 400 });
  }
  if (!recipient || !isAddress(recipient)) {
    return NextResponse.json({ error: 'invalid_recipient' }, { status: 400 });
  }

  let tokenId: bigint;
  try {
    tokenId = BigInt(tokenIdParam);
  } catch {
    return NextResponse.json({ error: 'invalid_token_id' }, { status: 400 });
  }

  try {
    const positionDetails = await getPositionDetails(tokenId);
    const pool = await buildPool(positionDetails);

    const position = new Position({
      pool,
      tickLower: positionDetails.tickLower,
      tickUpper: positionDetails.tickUpper,
      liquidity: positionDetails.liquidity.toString()
    });

    const nowSeconds = Math.floor(Date.now() / 1000);
    const collectOptions = {
      tokenId: tokenIdParam,
      recipient,
      slippageTolerance: new Percent(0, 100),
      deadline: (nowSeconds + COLLECT_DEADLINE_SECONDS).toString(),
      hookData: '0x'
    };

    const { calldata, value } = V4PositionManager.collectCallParameters(position, collectOptions);

    return NextResponse.json({
      to: POSITION_MANAGER_ADDRESS,
      data: calldata,
      value
    });
  } catch (error) {
    console.error('LP_COLLECT_ROUTE:failed', error);
    return NextResponse.json({ error: 'lp_collect_failed' }, { status: 500 });
  }
}
