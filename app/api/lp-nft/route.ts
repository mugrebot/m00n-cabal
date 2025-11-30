import { NextRequest, NextResponse } from 'next/server';
import { Token } from '@uniswap/sdk-core';
import { Pool } from '@uniswap/v4-sdk';
import { createPublicClient, defineChain, http, type Address } from 'viem';
import { getUserPositionsSummary } from '../../lib/uniswapV4Positions';

interface LpPoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  hooks: string;
}

interface RawLpPosition {
  tokenId: string;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  poolKey: LpPoolKey;
}

interface EnrichedLpPosition extends RawLpPosition {
  bandType: 'crash_band' | 'upside_band' | 'in_range' | 'unknown';
  hasSubscriber?: boolean;
}

interface LpApiResponse {
  hasLpNft: boolean;
  lpPositions: RawLpPosition[];
  error?: string;
}

const TARGET_POOL_KEY: LpPoolKey = {
  currency0: '0x22cd99ec337a2811f594340a4a6e41e4a3022b07', // m00nad
  currency1: '0x3bd359c1119da7da1d913d1c4d2b7c461115433a', // WMON (wrapped) on Monad
  fee: 8_388_608,
  hooks: '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc'
};

const POSITION_MANAGER_ADDRESS = '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016';
const STATE_VIEW_ADDRESS = '0x77395f3b2e73ae90843717371294fa97cc419d64';
const TOKEN_MOON_ADDRESS = '0x22Cd99EC337a2811F594340a4A6E41e4A3022b07';
const TOKEN_WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const HOOK_ADDRESS = '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc';
const FEE = 8_388_608;
const TICK_SPACING = 200;
const DEFAULT_MONAD_CHAIN_ID = 143;
const DEFAULT_MONAD_RPC_URL = 'https://rpc.monad.xyz';

const envChainId = Number(process.env.MONAD_CHAIN_ID);
const monadChainId =
  Number.isFinite(envChainId) && envChainId > 0 ? envChainId : DEFAULT_MONAD_CHAIN_ID;
const monadRpcUrl = (process.env.MONAD_RPC_URL ?? '').trim() || DEFAULT_MONAD_RPC_URL;

const monadChain = defineChain({
  id: monadChainId,
  name: 'Monad',
  network: 'monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [monadRpcUrl] },
    public: { http: [monadRpcUrl] }
  }
});

const publicClient = createPublicClient({
  chain: monadChain,
  transport: http(monadRpcUrl)
});

const stateViewAbi = [
  {
    type: 'function',
    name: 'getSlot0',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' }
    ]
  },
  {
    type: 'function',
    name: 'getLiquidity',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }]
  }
] as const;

// Position manager ABI fragment for packed info & liquidity
const positionManagerAbi = [
  {
    name: 'getPoolAndPositionInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: 'poolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' }
        ]
      },
      { name: 'info', type: 'uint256' }
    ]
  },
  {
    name: 'getPositionLiquidity',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }]
  }
] as const;

const normalizeAddress = (value: string) => value.toLowerCase();

const isTargetPool = (poolKey: LpPoolKey) => {
  if (!poolKey) return false;

  const feeNum =
    typeof poolKey.fee === 'string'
      ? Number(poolKey.fee)
      : (poolKey.fee as number | undefined | null);

  return (
    normalizeAddress(poolKey.currency0) === normalizeAddress(TARGET_POOL_KEY.currency0) &&
    normalizeAddress(poolKey.currency1) === normalizeAddress(TARGET_POOL_KEY.currency1) &&
    feeNum === TARGET_POOL_KEY.fee &&
    normalizeAddress(poolKey.hooks || '') === normalizeAddress(TARGET_POOL_KEY.hooks)
  );
};

async function enrichPositions(positions: RawLpPosition[]): Promise<{
  currentTick: number;
  sqrtPriceX96: bigint;
  lpPositions: EnrichedLpPosition[];
}> {
  if (positions.length === 0) {
    return {
      currentTick: 0,
      sqrtPriceX96: BigInt(0),
      lpPositions: []
    };
  }

  const moonToken = new Token(monadChainId, TOKEN_MOON_ADDRESS.toLowerCase(), 18, 'm00n', 'm00nad');
  const wmonToken = new Token(
    monadChainId,
    TOKEN_WMON_ADDRESS.toLowerCase(),
    18,
    'WMON',
    'Wrapped MON'
  );

  const poolId = Pool.getPoolId(
    moonToken,
    wmonToken,
    FEE,
    TICK_SPACING,
    HOOK_ADDRESS.toLowerCase()
  );

  const [slot0, poolLiquidityRaw] = await Promise.all([
    publicClient.readContract({
      address: STATE_VIEW_ADDRESS,
      abi: stateViewAbi,
      functionName: 'getSlot0',
      args: [poolId as `0x${string}`]
    }),
    publicClient.readContract({
      address: STATE_VIEW_ADDRESS,
      abi: stateViewAbi,
      functionName: 'getLiquidity',
      args: [poolId as `0x${string}`]
    })
  ]);

  const sqrtPriceX96 = slot0[0] as bigint;
  const currentTick = Number(slot0[1]);
  const poolLiquidity = poolLiquidityRaw as bigint;

  const pool = new Pool(
    moonToken,
    wmonToken,
    FEE,
    TICK_SPACING,
    HOOK_ADDRESS.toLowerCase(),
    sqrtPriceX96.toString(),
    poolLiquidity.toString(),
    currentTick
  );

  const enriched: EnrichedLpPosition[] = positions.map((position) => {
    let bandType: EnrichedLpPosition['bandType'] = 'unknown';
    if (currentTick < position.tickLower) {
      bandType = 'upside_band';
    } else if (currentTick > position.tickUpper) {
      bandType = 'crash_band';
    } else if (currentTick >= position.tickLower && currentTick <= position.tickUpper) {
      bandType = 'in_range';
    }

    return {
      ...position,
      bandType
    };
  });

  return {
    currentTick,
    sqrtPriceX96,
    lpPositions: enriched
  };
}

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
    console.log('LP_NFT_ROUTE:summary', summary);
    const basePositions = summary.lpPositions || [];

    if (basePositions.length === 0) {
      return NextResponse.json({
        hasLpNft: summary.hasLpNft,
        hasLpFromOnchain: summary.hasLpFromOnchain,
        hasLpFromSubgraph: summary.hasLpFromSubgraph,
        indexerPositionCount: summary.indexerPositionCount,
        currentTick: 0,
        sqrtPriceX96: '0',
        lpPositions: []
      });
    }

    // Enrich positions with bandType using on-chain pool state for the
    // canonical m00nad/WMON crash-band pool on Monad.
    const rawPositions: RawLpPosition[] = basePositions.map((p) => ({
      tokenId: p.tokenId.toString(),
      liquidity: p.liquidity.toString(),
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      poolKey: {
        currency0: p.poolKey.currency0,
        currency1: p.poolKey.currency1,
        fee: p.poolKey.fee,
        hooks: p.poolKey.hooks
      }
    }));

    const { currentTick, sqrtPriceX96, lpPositions } = await enrichPositions(rawPositions);

    return NextResponse.json({
      hasLpNft: summary.hasLpNft || lpPositions.length > 0,
      hasLpFromOnchain: summary.hasLpFromOnchain,
      hasLpFromSubgraph: summary.hasLpFromSubgraph,
      indexerPositionCount: summary.indexerPositionCount,
      currentTick,
      sqrtPriceX96: sqrtPriceX96.toString(),
      lpPositions
    });
  } catch (error) {
    console.error('Error checking LP NFT:', error);
    return NextResponse.json({ error: 'lp_lookup_failed' }, { status: 500 });
  }
}
