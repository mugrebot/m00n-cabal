import { NextRequest, NextResponse } from 'next/server';
import { Token, Percent } from '@uniswap/sdk-core';
import { Pool, Position, V4PositionManager } from '@uniswap/v4-sdk';
import { Address, isAddress, parseUnits } from 'viem';

import { getCurrentPoolState } from '@/app/lib/uniswapV4Positions';
import { getWmonUsdPriceFromSubgraph } from '@/app/lib/pricing/monadPrices';

const POSITION_MANAGER_ADDRESS = '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016';
const TOKEN_MOON_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
const TOKEN_WMON_ADDRESS = '0x3bd359C1119dA7Da1d913d1C4D2b7C461115433A';
const HOOK_ADDRESS = '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc';
const FEE = 8_388_608;
const TICK_SPACING = 200;
const MONAD_CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? 143);
const SLIPPAGE_BPS = 500;

const POOL_KEY = {
  currency0: TOKEN_MOON_ADDRESS as Address,
  currency1: TOKEN_WMON_ADDRESS as Address,
  fee: FEE,
  tickSpacing: TICK_SPACING,
  hooks: HOOK_ADDRESS as Address
};

const snapDownToSpacing = (tick: number) => Math.floor(tick / TICK_SPACING) * TICK_SPACING;
const snapUpToSpacing = (tick: number) => Math.ceil(tick / TICK_SPACING) * TICK_SPACING;

export async function POST(request: NextRequest) {
  let body: {
    recipient?: string;
    amount?: string;
    mode?: 'sky' | 'crash';
    side?: 'single' | 'double';
    rangeLowerUsd?: number;
    rangeUpperUsd?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { recipient, amount, mode, side = 'single', rangeLowerUsd, rangeUpperUsd } = body ?? {};

  if (!recipient || !isAddress(recipient)) {
    return NextResponse.json({ error: 'invalid_recipient' }, { status: 400 });
  }

  if (!amount || Number(amount) <= 0) {
    return NextResponse.json({ error: 'invalid_amount' }, { status: 400 });
  }

  if (mode !== 'sky' && mode !== 'crash') {
    return NextResponse.json({ error: 'invalid_mode' }, { status: 400 });
  }

  if (side !== 'single') {
    return NextResponse.json({ error: 'double_sided_unavailable' }, { status: 400 });
  }

  if (rangeLowerUsd === undefined || rangeUpperUsd === undefined) {
    return NextResponse.json({ error: 'invalid_range' }, { status: 400 });
  }

  const lowerBound = Number(rangeLowerUsd);
  const upperBound = Number(rangeUpperUsd);

  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) {
    return NextResponse.json({ error: 'invalid_range' }, { status: 400 });
  }

  try {
    const [poolState, wmonUsdPrice] = await Promise.all([
      getCurrentPoolState(POOL_KEY),
      getWmonUsdPriceFromSubgraph()
    ]);

    if (wmonUsdPrice === null) {
      throw new Error('wmon_price_unavailable');
    }

    const moonToken = new Token(MONAD_CHAIN_ID, TOKEN_MOON_ADDRESS, 18, 'm00n', 'm00nad');
    const wmonToken = new Token(MONAD_CHAIN_ID, TOKEN_WMON_ADDRESS, 18, 'WMON', 'Wrapped MON');

    const token0 = moonToken.sortsBefore(wmonToken) ? moonToken : wmonToken;
    const token1 = token0.address === moonToken.address ? wmonToken : moonToken;

    const pool = new Pool(
      token0,
      token1,
      FEE,
      TICK_SPACING,
      HOOK_ADDRESS,
      poolState.sqrtPriceX96.toString(),
      poolState.liquidity.toString(),
      poolState.tick
    );

    const amountWei = parseUnits(amount, 18);
    const [usdLower, usdUpper] =
      lowerBound < upperBound ? [lowerBound, upperBound] : [upperBound, lowerBound];

    const lowerRatio = usdLower / wmonUsdPrice;
    const upperRatio = usdUpper / wmonUsdPrice;

    if (lowerRatio <= 0 || upperRatio <= 0) {
      return NextResponse.json({ error: 'invalid_range' }, { status: 400 });
    }

    const currentUsd = Math.pow(1.0001, poolState.tick) * wmonUsdPrice;

    if (mode === 'sky' && usdLower <= currentUsd) {
      return NextResponse.json({ error: 'range_must_be_above_current' }, { status: 400 });
    }

    if (mode === 'crash' && usdUpper >= currentUsd) {
      return NextResponse.json({ error: 'range_must_be_below_current' }, { status: 400 });
    }

    const tickLower = snapDownToSpacing(Math.floor(priceToTick(lowerRatio)));
    let tickUpper = snapUpToSpacing(Math.floor(priceToTick(upperRatio)));

    if (tickUpper <= tickLower) {
      tickUpper = tickLower + TICK_SPACING;
    }

    const amount0Desired = mode === 'sky' ? amountWei.toString() : '0';
    const amount1Desired = mode === 'crash' ? amountWei.toString() : '0';

    const position = Position.fromAmounts({
      pool,
      tickLower,
      tickUpper,
      amount0: amount0Desired,
      amount1: amount1Desired,
      useFullPrecision: true
    });

    const deadlineSeconds = Math.floor(Date.now() / 1000) + 10 * 60;

    const { calldata, value } = V4PositionManager.addCallParameters(position, {
      recipient,
      slippageTolerance: new Percent(SLIPPAGE_BPS, 10_000),
      deadline: deadlineSeconds.toString(),
      hookData: '0x'
    });

    return NextResponse.json({
      to: POSITION_MANAGER_ADDRESS,
      data: calldata,
      value
    });
  } catch (error) {
    console.error('LP_ADVANCED_ROUTE:failed', error);
    return NextResponse.json({ error: 'lp_advanced_failed' }, { status: 500 });
  }
}

function priceToTick(value: number) {
  return Math.log(value) / Math.log(1.0001);
}
