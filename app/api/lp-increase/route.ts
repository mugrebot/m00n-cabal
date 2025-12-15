/**
 * LP Increase Liquidity Route
 *
 * Properly increases liquidity on an EXISTING position using INCREASE_LIQUIDITY action.
 * This is different from minting a new position.
 *
 * Actions:
 * - INCREASE_LIQUIDITY (0x00) - add liquidity to existing position
 * - SETTLE_PAIR (0x0d) - settle both tokens
 */

import { NextRequest, NextResponse } from 'next/server';
import { encodeAbiParameters, parseAbiParameters, encodePacked, isAddress } from 'viem';
import { Percent, Token } from '@uniswap/sdk-core';
import { Pool, Position } from '@uniswap/v4-sdk';

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
const DEADLINE_SECONDS = 10 * 60; // 10 minutes
const DEFAULT_SLIPPAGE_PERCENT = 5; // 5%

// Action codes from Uniswap V4
const Actions = {
  INCREASE_LIQUIDITY: 0x00,
  SETTLE_PAIR: 0x0d
} as const;

const describeTokenMeta = (address: string) => {
  const meta = TOKEN_METADATA[address.toLowerCase()];
  if (meta) return meta;
  return { symbol: 'TOKEN', decimals: 18 };
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
  let body: {
    tokenId?: string;
    amount0Wei?: string; // Amount of token0 to add
    amount1Wei?: string; // Amount of token1 to add
    slippagePercent?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { tokenId: tokenIdParam, amount0Wei, amount1Wei, slippagePercent } = body;

  if (!tokenIdParam) {
    return NextResponse.json({ error: 'missing_token_id' }, { status: 400 });
  }
  if (!amount0Wei && !amount1Wei) {
    return NextResponse.json({ error: 'missing_amounts' }, { status: 400 });
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

    const amount0 = BigInt(amount0Wei ?? '0');
    const amount1 = BigInt(amount1Wei ?? '0');

    // Check if amounts are too small
    if (amount0 === BigInt(0) && amount1 === BigInt(0)) {
      return NextResponse.json({ error: 'no_amounts_to_add' }, { status: 400 });
    }

    // Build position from amounts to calculate liquidity
    let addPosition: Position;
    try {
      addPosition = Position.fromAmounts({
        pool,
        tickLower: positionDetails.tickLower,
        tickUpper: positionDetails.tickUpper,
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        useFullPrecision: true
      });
    } catch (err) {
      console.error('LP_INCREASE_ROUTE:position_build_failed', {
        tickLower: positionDetails.tickLower,
        tickUpper: positionDetails.tickUpper,
        currentTick: pool.tickCurrent,
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        error: err instanceof Error ? err.message : String(err)
      });
      return NextResponse.json(
        {
          error: 'position_build_failed',
          detail: 'Amounts too small to calculate liquidity'
        },
        { status: 400 }
      );
    }

    // Check if position has valid liquidity
    const liquidityBigInt = BigInt(addPosition.liquidity.toString());
    if (liquidityBigInt === BigInt(0)) {
      return NextResponse.json(
        {
          error: 'zero_liquidity',
          detail: 'Amounts result in zero liquidity'
        },
        { status: 400 }
      );
    }

    // Calculate max amounts with slippage
    const slippage = new Percent(slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT, 100);
    const { amount0: mintAmount0, amount1: mintAmount1 } =
      addPosition.mintAmountsWithSlippage(slippage);
    const amount0Max = BigInt(mintAmount0.toString());
    const amount1Max = BigInt(mintAmount1.toString());

    const nowSeconds = Math.floor(Date.now() / 1000);
    const deadline = BigInt(nowSeconds + DEADLINE_SECONDS);

    // Encode actions: INCREASE_LIQUIDITY + SETTLE_PAIR
    const actions = encodePacked(
      ['uint8', 'uint8'],
      [Actions.INCREASE_LIQUIDITY, Actions.SETTLE_PAIR]
    );

    // Encode INCREASE_LIQUIDITY params
    // params[0] = abi.encode(tokenId, liquidity, amount0Max, amount1Max, hookData)
    const increaseParams = encodeAbiParameters(
      parseAbiParameters('uint256, uint256, uint128, uint128, bytes'),
      [tokenId, liquidityBigInt, amount0Max, amount1Max, '0x' as `0x${string}`]
    );

    // Encode SETTLE_PAIR params (currency0, currency1)
    const currency0 = positionDetails.poolKey.currency0 as `0x${string}`;
    const currency1 = positionDetails.poolKey.currency1 as `0x${string}`;
    const settleParams = encodeAbiParameters(parseAbiParameters('address, address'), [
      currency0,
      currency1
    ]);

    // unlockData = abi.encode(actions, params[])
    // where actions is bytes and params is bytes[]
    const unlockData = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [
      actions,
      [increaseParams, settleParams]
    ]);

    // modifyLiquidities(bytes unlockData, uint256 deadline)
    // Function selector: 0xdd46508f
    const funcParams = encodeAbiParameters(parseAbiParameters('bytes, uint256'), [
      unlockData,
      deadline
    ]);
    const calldata = `0xdd46508f${funcParams.slice(2)}` as `0x${string}`;

    return NextResponse.json({
      to: POSITION_MANAGER_ADDRESS,
      data: calldata,
      value: '0', // No ETH needed for m00n/WMON pair
      meta: {
        tokenId: tokenIdParam,
        liquidity: liquidityBigInt.toString(),
        amount0Max: amount0Max.toString(),
        amount1Max: amount1Max.toString(),
        currency0,
        currency1,
        slippagePercent: slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT
      }
    });
  } catch (error) {
    console.error('LP_INCREASE_ROUTE:failed', error);
    return NextResponse.json(
      { error: 'lp_increase_failed', details: String(error) },
      { status: 500 }
    );
  }
}
