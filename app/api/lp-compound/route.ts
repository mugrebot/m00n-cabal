/**
 * LP Compound Route
 *
 * Combines collect fees + increase liquidity into a single operation.
 * Uses INCREASE_LIQUIDITY action (not MINT) to add fees back to existing position.
 *
 * Flow:
 * 1. First call: COLLECT to get fees to user
 * 2. Second call: INCREASE_LIQUIDITY to add those fees back
 *
 * Note: These need to be separate transactions because the fees
 * need to be in the user's wallet before they can be added back.
 *
 * For true atomic compounding, we'd use CLOSE_CURRENCY instead of SETTLE_PAIR
 * to automatically reinvest accrued fees.
 */

import { NextRequest, NextResponse } from 'next/server';
import { encodeAbiParameters, parseAbiParameters, encodePacked } from 'viem';
import { Percent, Token } from '@uniswap/sdk-core';
import { Pool, Position, V4PositionManager } from '@uniswap/v4-sdk';

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
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  SETTLE_PAIR: 0x0d,
  CLOSE_CURRENCY: 0x11,
  CLEAR_OR_TAKE: 0x12
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
    recipient?: string;
    amount0Wei?: string; // m00n amount to add (from collected fees)
    amount1Wei?: string; // WMON amount to add (from collected fees)
    slippagePercent?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { tokenId: tokenIdParam, recipient, amount0Wei, amount1Wei, slippagePercent } = body;

  if (!tokenIdParam) {
    return NextResponse.json({ error: 'missing_token_id' }, { status: 400 });
  }
  if (!recipient) {
    return NextResponse.json({ error: 'missing_recipient' }, { status: 400 });
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

    // Build position for collect
    const position = new Position({
      pool,
      tickLower: positionDetails.tickLower,
      tickUpper: positionDetails.tickUpper,
      liquidity: positionDetails.liquidity.toString()
    });

    const nowSeconds = Math.floor(Date.now() / 1000);
    const deadline = (nowSeconds + DEADLINE_SECONDS).toString();
    const slippage = new Percent(slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT, 100);

    // 1. Generate COLLECT calldata using SDK
    const collectOptions = {
      tokenId: tokenIdParam,
      recipient,
      slippageTolerance: new Percent(0, 100),
      deadline,
      hookData: '0x'
    };
    const collectResult = V4PositionManager.collectCallParameters(position, collectOptions);

    // 2. Generate INCREASE_LIQUIDITY calldata
    const amount0 = BigInt(amount0Wei ?? '0');
    const amount1 = BigInt(amount1Wei ?? '0');

    // Check if amounts are too small
    if (amount0 === BigInt(0) && amount1 === BigInt(0)) {
      console.error('LP_COMPOUND_ROUTE:no_fees', { amount0Wei, amount1Wei });
      return NextResponse.json({ error: 'no_fees_to_compound' }, { status: 400 });
    }

    console.log('LP_COMPOUND_ROUTE:building_position', {
      tokenId: tokenIdParam,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      tickLower: positionDetails.tickLower,
      tickUpper: positionDetails.tickUpper,
      currentTick: pool.tickCurrent
    });

    // Build position from amounts for adding liquidity
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
      console.error('LP_COMPOUND_ROUTE:position_build_failed', {
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
          detail: `Fee amounts too small to compound. Err: ${err instanceof Error ? err.message : String(err)}`
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
          detail: 'Fee amounts result in zero liquidity - try collecting instead'
        },
        { status: 400 }
      );
    }

    // Calculate max amounts with slippage
    const { amount0: mintAmount0, amount1: mintAmount1 } =
      addPosition.mintAmountsWithSlippage(slippage);
    const amount0Max = BigInt(mintAmount0.toString());
    const amount1Max = BigInt(mintAmount1.toString());

    const deadlineBigInt = BigInt(nowSeconds + DEADLINE_SECONDS);

    // Encode INCREASE_LIQUIDITY actions (packed bytes)
    const actions = encodePacked(
      ['uint8', 'uint8'],
      [Actions.INCREASE_LIQUIDITY, Actions.SETTLE_PAIR]
    );

    // Encode INCREASE_LIQUIDITY params
    // (tokenId, liquidity, amount0Max, amount1Max, hookData)
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
      deadlineBigInt
    ]);
    const increaseCalldata = `0xdd46508f${funcParams.slice(2)}` as `0x${string}`;

    // Return both calldatas - collect first, then increase
    return NextResponse.json({
      to: POSITION_MANAGER_ADDRESS,
      calls: [
        { data: collectResult.calldata, value: collectResult.value, action: 'collect' },
        { data: increaseCalldata, value: '0', action: 'increase' }
      ],
      value: collectResult.value,
      meta: {
        tokenId: tokenIdParam,
        liquidity: liquidityBigInt.toString(),
        amount0Wei: amount0.toString(),
        amount1Wei: amount1.toString(),
        amount0Max: amount0Max.toString(),
        amount1Max: amount1Max.toString(),
        slippagePercent: slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT
      }
    });
  } catch (error) {
    console.error('LP_COMPOUND_ROUTE:failed', error);
    return NextResponse.json(
      { error: 'lp_compound_failed', details: String(error) },
      { status: 500 }
    );
  }
}
