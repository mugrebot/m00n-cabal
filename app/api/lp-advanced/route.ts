import { NextRequest, NextResponse } from 'next/server';
import { Token, Percent } from '@uniswap/sdk-core';
import { Pool, Position, V4PositionManager } from '@uniswap/v4-sdk';
import { Address, getAddress, isAddress, parseUnits } from 'viem';

import { getCurrentPoolState } from '@/app/lib/uniswapV4Positions';
import { getWmonUsdPriceFromSubgraph } from '@/app/lib/pricing/monadPrices';

const POSITION_MANAGER_ADDRESS = getAddress('0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016');
const TOKEN_MOON_ADDRESS = getAddress('0x22cd99ec337a2811f594340a4a6e41e4a3022b07');
const TOKEN_WMON_ADDRESS = getAddress('0x3bd359C1119dA7Da1d913d1C4D2b7C461115433A');
const HOOK_ADDRESS = getAddress('0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc');
const FEE = 8_388_608;
const TICK_SPACING = 200;
const MONAD_CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? 143);
const SLIPPAGE_BPS = 500;
const MOON_CIRC_SUPPLY = 95_000_000_000; // market cap inputs need per-token conversion

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
    side?: 'single' | 'double';
    singleDepositAsset?: 'moon' | 'wmon';
    singleAmount?: string;
    doubleMoonAmount?: string;
    doubleWmonAmount?: string;
    rangeLowerUsd?: number;
    rangeUpperUsd?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const {
    recipient,
    side = 'single',
    singleDepositAsset,
    singleAmount,
    doubleMoonAmount,
    doubleWmonAmount,
    rangeLowerUsd,
    rangeUpperUsd
  } = body ?? {};

  if (!recipient || !isAddress(recipient)) {
    return NextResponse.json({ error: 'invalid_recipient' }, { status: 400 });
  }

  if (side !== 'single' && side !== 'double') {
    return NextResponse.json({ error: 'invalid_side' }, { status: 400 });
  }

  if (side === 'single') {
    if (singleDepositAsset !== 'moon' && singleDepositAsset !== 'wmon') {
      return NextResponse.json({ error: 'invalid_single_asset' }, { status: 400 });
    }
    if (!singleAmount || Number(singleAmount) <= 0) {
      return NextResponse.json({ error: 'invalid_single_amount' }, { status: 400 });
    }
  } else {
    if (!doubleMoonAmount || Number(doubleMoonAmount) <= 0) {
      return NextResponse.json({ error: 'invalid_double_moon_amount' }, { status: 400 });
    }
    if (!doubleWmonAmount || Number(doubleWmonAmount) <= 0) {
      return NextResponse.json({ error: 'invalid_double_wmon_amount' }, { status: 400 });
    }
  }

  if (rangeLowerUsd === undefined || rangeUpperUsd === undefined) {
    return NextResponse.json({ error: 'invalid_range' }, { status: 400 });
  }

  const lowerBound = Number(rangeLowerUsd);
  const upperBound = Number(rangeUpperUsd);

  if (
    !Number.isFinite(lowerBound) ||
    !Number.isFinite(upperBound) ||
    lowerBound <= 0 ||
    upperBound <= 0 ||
    lowerBound === upperBound
  ) {
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

    const [usdLower, usdUpper] =
      lowerBound < upperBound ? [lowerBound, upperBound] : [upperBound, lowerBound];

    // Inputs are per-token USD (client already converts market cap -> per-token before POST)
    const lowerPriceUsd = usdLower;
    const upperPriceUsd = usdUpper;

    const lowerRatio = lowerPriceUsd / wmonUsdPrice;
    const upperRatio = upperPriceUsd / wmonUsdPrice;

    if (lowerRatio <= 0 || upperRatio <= 0) {
      return NextResponse.json({ error: 'invalid_range' }, { status: 400 });
    }

    const tickLower = snapDownToSpacing(Math.floor(priceToTick(lowerRatio)));
    let tickUpper = snapUpToSpacing(Math.floor(priceToTick(upperRatio)));

    if (tickUpper <= tickLower) {
      tickUpper = tickLower + TICK_SPACING;
    }

    let moonAmount = BigInt(0);
    let wmonAmount = BigInt(0);

    const currentTick = poolState.tick;
    const currentBelowRange = currentTick < tickLower;
    const currentAboveRange = currentTick > tickUpper;

    if (side === 'single') {
      if (singleDepositAsset === 'moon') {
        if (!currentBelowRange) {
          return NextResponse.json(
            {
              error: 'single_moon_requires_range_above_spot',
              hint: `Current tick ${currentTick}, band ticks [${tickLower}, ${tickUpper}]`
            },
            { status: 400 }
          );
        }
        moonAmount = parseUnits(singleAmount!, 18);
      } else {
        if (!currentAboveRange) {
          return NextResponse.json(
            {
              error: 'single_wmon_requires_range_below_spot',
              hint: `Current tick ${currentTick}, band ticks [${tickLower}, ${tickUpper}]`
            },
            { status: 400 }
          );
        }
        wmonAmount = parseUnits(singleAmount!, 18);
      }
    } else {
      moonAmount = parseUnits(doubleMoonAmount!, 18);
      wmonAmount = parseUnits(doubleWmonAmount!, 18);
    }

    const moonAmountStr = moonAmount.toString();
    const wmonAmountStr = wmonAmount.toString();

    const amount0Desired = token0.address === moonToken.address ? moonAmountStr : wmonAmountStr;
    const amount1Desired = token0.address === moonToken.address ? wmonAmountStr : moonAmountStr;

    let position: Position;
    try {
      position = Position.fromAmounts({
        pool,
        tickLower,
        tickUpper,
        amount0: amount0Desired,
        amount1: amount1Desired,
        useFullPrecision: true
      });
    } catch (err) {
      console.error('LP_ADVANCED_ROUTE:position_build_failed', {
        tickLower,
        tickUpper,
        currentTick,
        amount0Desired,
        amount1Desired,
        err
      });
      return NextResponse.json(
        {
          error: 'position_build_failed',
          detail: err instanceof Error ? err.message : String(err),
          hint: 'If single-sided, set your band fully above spot for m00n or below spot for WMON, or switch to double-sided.'
        },
        { status: 400 }
      );
    }

    const deadlineSeconds = Math.floor(Date.now() / 1000) + 10 * 60;

    const { calldata, value } = V4PositionManager.addCallParameters(position, {
      recipient,
      slippageTolerance: new Percent(SLIPPAGE_BPS, 10_000),
      deadline: deadlineSeconds.toString(),
      hookData: '0x'
    });

    const requiredMoonWei =
      token0.address === moonToken.address
        ? position.amount0.quotient.toString()
        : position.amount1.quotient.toString();
    const requiredWmonWei =
      token0.address === moonToken.address
        ? position.amount1.quotient.toString()
        : position.amount0.quotient.toString();

    return NextResponse.json({
      to: POSITION_MANAGER_ADDRESS,
      data: calldata,
      value,
      requiredMoonWei,
      requiredWmonWei
    });
  } catch (error) {
    console.error('LP_ADVANCED_ROUTE:failed', error);
    return NextResponse.json({ error: 'lp_advanced_failed' }, { status: 500 });
  }
}

function priceToTick(value: number) {
  return Math.log(value) / Math.log(1.0001);
}
