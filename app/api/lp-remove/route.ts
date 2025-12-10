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
const TOKEN_METADATA: Record<string, { symbol: string; decimals: number }> = {
  '0x22cd99ec337a2811f594340a4a6e41e4a3022b07': { symbol: 'm00n', decimals: 18 },
  '0x3bd359c1119da7da1d913d1c4d2b7c461115433a': { symbol: 'WMON', decimals: 18 }
};

const MONAD_CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? 143);
const REMOVE_DEADLINE_SECONDS = 10 * 60;

const describeTokenMeta = (address: string) => {
  const meta = TOKEN_METADATA[address.toLowerCase()];
  return meta || { symbol: 'TOKEN', decimals: 18 };
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

/**
 * Remove liquidity from a Uniswap V4 position.
 *
 * This will:
 * 1. Withdraw the specified percentage of liquidity
 * 2. Automatically collect any accumulated fees
 * 3. Optionally burn the NFT if removing 100%
 *
 * POST body:
 * - tokenId: string - The position NFT token ID
 * - recipient: string - Address to receive withdrawn tokens
 * - percentageToRemove: number - 1-100, percentage of liquidity to remove (default: 100)
 * - burnToken: boolean - Whether to burn the NFT after removal (default: true if 100%)
 * - slippageBps: number - Slippage tolerance in basis points (default: 50 = 0.5%)
 */
export async function POST(request: NextRequest) {
  let body: {
    tokenId?: string;
    recipient?: string;
    percentageToRemove?: number;
    burnToken?: boolean;
    slippageBps?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const {
    tokenId: tokenIdParam,
    recipient,
    percentageToRemove = 100,
    burnToken,
    slippageBps = 50
  } = body;

  if (!tokenIdParam) {
    return NextResponse.json({ error: 'missing_token_id' }, { status: 400 });
  }
  if (!recipient || !isAddress(recipient)) {
    return NextResponse.json({ error: 'invalid_recipient' }, { status: 400 });
  }
  if (percentageToRemove < 1 || percentageToRemove > 100) {
    return NextResponse.json({ error: 'invalid_percentage' }, { status: 400 });
  }

  let tokenId: bigint;
  try {
    tokenId = BigInt(tokenIdParam);
  } catch {
    return NextResponse.json({ error: 'invalid_token_id' }, { status: 400 });
  }

  try {
    const positionDetails = await getPositionDetails(tokenId);

    // Check if position has any liquidity
    if (positionDetails.liquidity === BigInt(0)) {
      return NextResponse.json(
        {
          error: 'no_liquidity',
          message: 'Position has no liquidity to remove. You may only need to collect fees.'
        },
        { status: 400 }
      );
    }

    const pool = await buildPool(positionDetails);

    const position = new Position({
      pool,
      tickLower: positionDetails.tickLower,
      tickUpper: positionDetails.tickUpper,
      liquidity: positionDetails.liquidity.toString()
    });

    const nowSeconds = Math.floor(Date.now() / 1000);

    // Default: burn the NFT if removing 100%
    const shouldBurnToken = burnToken ?? percentageToRemove === 100;

    const removeOptions = {
      tokenId: tokenIdParam,
      liquidityPercentage: new Percent(percentageToRemove, 100),
      slippageTolerance: new Percent(slippageBps, 10000),
      deadline: (nowSeconds + REMOVE_DEADLINE_SECONDS).toString(),
      burnToken: shouldBurnToken,
      hookData: '0x'
    };

    const { calldata, value } = V4PositionManager.removeCallParameters(position, removeOptions);

    return NextResponse.json({
      to: POSITION_MANAGER_ADDRESS,
      data: calldata,
      value,
      // Return info for UI
      meta: {
        tokenId: tokenIdParam,
        percentageRemoved: percentageToRemove,
        willBurnNft: shouldBurnToken,
        positionLiquidity: positionDetails.liquidity.toString(),
        tickLower: positionDetails.tickLower,
        tickUpper: positionDetails.tickUpper
      }
    });
  } catch (error) {
    console.error('LP_REMOVE_ROUTE:failed', error);
    return NextResponse.json(
      { error: 'lp_remove_failed', details: String(error) },
      { status: 500 }
    );
  }
}
