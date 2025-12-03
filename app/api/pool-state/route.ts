import { NextResponse } from 'next/server';
import { Address } from 'viem';

import { getCurrentPoolState } from '@/app/lib/uniswapV4Positions';
import { getWmonUsdPriceFromSubgraph } from '@/app/lib/pricing/monadPrices';

const TOKEN_MOON_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
const TOKEN_WMON_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const HOOK_ADDRESS = '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc';
const FEE = 8_388_608;
const TICK_SPACING = 200;

const POOL_KEY = {
  currency0: TOKEN_MOON_ADDRESS as Address,
  currency1: TOKEN_WMON_ADDRESS as Address,
  fee: FEE,
  tickSpacing: TICK_SPACING,
  hooks: HOOK_ADDRESS as Address
};

const tickToPrice = (tick: number) => Math.pow(1.0001, tick);

export async function GET() {
  try {
    const [poolState, wmonUsdPrice] = await Promise.all([
      getCurrentPoolState(POOL_KEY),
      getWmonUsdPriceFromSubgraph()
    ]);

    const moonUsdPrice = wmonUsdPrice !== null ? tickToPrice(poolState.tick) * wmonUsdPrice : null;

    return NextResponse.json({
      tick: poolState.tick,
      sqrtPriceX96: poolState.sqrtPriceX96.toString(),
      liquidity: poolState.liquidity.toString(),
      wmonUsdPrice,
      moonUsdPrice,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('POOL_STATE_ROUTE:failed', error);
    return NextResponse.json({ error: 'pool_state_unavailable' }, { status: 500 });
  }
}
