import { NextRequest, NextResponse } from 'next/server';

const LP_API_URL = process.env.NEYNAR_LP_API_URL;
const LP_API_KEY = process.env.NEYNAR_LP_API_KEY || process.env.NEYNAR_API_KEY || '';

interface LpPoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  hooks: string;
}

interface LpPosition {
  tokenId: string;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  poolKey: LpPoolKey;
}

interface LpApiResponse {
  hasLpNft: boolean;
  lpPositions: LpPosition[];
  error?: string;
}

const TARGET_POOL_KEY: LpPoolKey = {
  currency0: '0x22cd99ec337a2811f594340a4a6e41e4a3022b07',
  currency1: '0xd20c124d9b9df986df7aae61a2b1e678a765d25f',
  fee: 8388608,
  hooks: '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc'
};

const normalizeAddress = (value: string) => value.toLowerCase();

const isTargetPool = (poolKey: LpPoolKey) =>
  normalizeAddress(poolKey.currency0) === normalizeAddress(TARGET_POOL_KEY.currency0) &&
  normalizeAddress(poolKey.currency1) === normalizeAddress(TARGET_POOL_KEY.currency1) &&
  poolKey.fee === TARGET_POOL_KEY.fee &&
  normalizeAddress(poolKey.hooks) === normalizeAddress(TARGET_POOL_KEY.hooks);

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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json({ error: 'Missing address' }, { status: 400 });
  }

  try {
    const lpResponse = await fetchLpPositions(address);

    const filteredPositions = (lpResponse.lpPositions || []).filter((position) =>
      position.poolKey ? isTargetPool(position.poolKey) : false
    );

    return NextResponse.json({
      hasLpNft: filteredPositions.length > 0,
      lpPositions: filteredPositions
    });
  } catch (error) {
    console.error('Error checking LP NFT:', error);
    return NextResponse.json({ error: 'lp_lookup_failed' }, { status: 500 });
  }
}
