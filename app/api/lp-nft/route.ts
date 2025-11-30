import { NextRequest, NextResponse } from 'next/server';
import { Token } from '@uniswap/sdk-core';
import { Pool } from '@uniswap/v4-sdk';
import { createPublicClient, defineChain, erc721Abi, http, type Address } from 'viem';

const LP_API_URL = process.env.NEYNAR_LP_API_URL;
const LP_API_KEY = process.env.NEYNAR_LP_API_KEY || process.env.NEYNAR_API_KEY || '';

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

interface PositionDetails {
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  hasSubscriber: boolean;
}

interface PackedPositionInfo {
  getTickUpper(): number;
  getTickLower(): number;
  hasSubscriber(): boolean;
}

// Official Uniswap v4 packed position decoder from docs
function decodePositionInfo(value: bigint): PackedPositionInfo {
  return {
    getTickUpper: () => {
      const shift = BigInt(32);
      const mask = BigInt(0xffffff);
      const raw = Number((value >> shift) & mask);
      const signedThreshold = 0x800000;
      const signedOffset = 0x1000000;
      return raw >= signedThreshold ? raw - signedOffset : raw;
    },

    getTickLower: () => {
      const shift = BigInt(8);
      const mask = BigInt(0xffffff);
      const raw = Number((value >> shift) & mask);
      const signedThreshold = 0x800000;
      const signedOffset = 0x1000000;
      return raw >= signedThreshold ? raw - signedOffset : raw;
    },

    hasSubscriber: () => {
      const mask = BigInt(0xff);
      return (value & mask) !== BigInt(0);
    }
  };
}

async function getPositionDetails(tokenId: string): Promise<PositionDetails> {
  const id = BigInt(tokenId);

  const [poolKey, infoValue] = (await publicClient.readContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: positionManagerAbi,
    functionName: 'getPoolAndPositionInfo',
    args: [id]
  })) as readonly [
    {
      currency0: Address;
      currency1: Address;
      fee: number;
      tickSpacing: number;
      hooks: Address;
    },
    bigint
  ];

  const liquidity = (await publicClient.readContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: positionManagerAbi,
    functionName: 'getPositionLiquidity',
    args: [id]
  })) as bigint;

  const packed = decodePositionInfo(infoValue);

  return {
    tokenId: id,
    tickLower: packed.getTickLower(),
    tickUpper: packed.getTickUpper(),
    liquidity,
    poolKey,
    hasSubscriber: packed.hasSubscriber()
  };
}

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

async function fetchLpPositions(address: string) {
  if (LP_API_URL && LP_API_KEY) {
    const response = await fetch(`${LP_API_URL}?address=${address}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': LP_API_KEY
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`LP API error: ${response.status}`);
    }

    const result = (await response.json()) as LpApiResponse;
    return result;
  }

  // Placeholder: fall back to no positions until onchain client is wired.
  return {
    hasLpNft: false,
    lpPositions: []
  } satisfies LpApiResponse;
}

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

  const enriched: EnrichedLpPosition[] = [];

  for (const position of positions) {
    try {
      const details = await getPositionDetails(position.tokenId);

      let bandType: EnrichedLpPosition['bandType'] = 'unknown';
      if (currentTick < details.tickLower) {
        bandType = 'upside_band';
      } else if (currentTick > details.tickUpper) {
        bandType = 'crash_band';
      } else if (currentTick >= details.tickLower && currentTick <= details.tickUpper) {
        bandType = 'in_range';
      }

      enriched.push({
        tokenId: position.tokenId,
        liquidity: details.liquidity.toString(),
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        poolKey: {
          currency0: details.poolKey.currency0,
          currency1: details.poolKey.currency1,
          fee: details.poolKey.fee,
          hooks: details.poolKey.hooks
        },
        bandType,
        hasSubscriber: details.hasSubscriber
      });
    } catch (err) {
      console.error('Failed to enrich LP position from on-chain data', position.tokenId, err);

      // Fallback to the raw Neynar-provided values if on-chain decoding fails
      let bandType: EnrichedLpPosition['bandType'] = 'unknown';
      if (currentTick < position.tickLower) {
        bandType = 'upside_band';
      } else if (currentTick > position.tickUpper) {
        bandType = 'crash_band';
      } else if (currentTick >= position.tickLower && currentTick <= position.tickUpper) {
        bandType = 'in_range';
      }

      enriched.push({
        ...position,
        bandType
      });
    }
  }

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
    const lpResponse = await fetchLpPositions(address);

    const allPositions = lpResponse.lpPositions || [];

    // Fallback: check on-chain PositionManager balance so we still unlock the cabal
    // even if the Neynar LP API doesn't yet index this network/pool.
    let onchainBalance: bigint | null = null;
    try {
      const balance = (await publicClient.readContract({
        address: POSITION_MANAGER_ADDRESS,
        abi: erc721Abi,
        functionName: 'balanceOf',
        args: [address as `0x${string}`]
      })) as bigint;
      onchainBalance = balance;
    } catch (err) {
      console.error('LP NFT on-chain balanceOf check failed', err);
    }

    const hasOnchainLp = onchainBalance !== null && onchainBalance > BigInt(0);
    const filteredPositions = allPositions.filter((position) =>
      position.poolKey ? isTargetPool(position.poolKey) : false
    );

    // If the strict pool filter finds nothing but Neynar says the user has LP,
    // fall back to returning all positions so the cabal gate still unlocks.
    const positionsForUser =
      filteredPositions.length > 0 || !lpResponse.hasLpNft ? filteredPositions : allPositions;

    const { currentTick, sqrtPriceX96, lpPositions } = await enrichPositions(positionsForUser);

    return NextResponse.json({
      hasLpNft: lpResponse.hasLpNft || hasOnchainLp || lpPositions.length > 0,
      currentTick,
      sqrtPriceX96: sqrtPriceX96.toString(),
      lpPositions
    });
  } catch (error) {
    console.error('Error checking LP NFT:', error);
    return NextResponse.json({ error: 'lp_lookup_failed' }, { status: 500 });
  }
}
