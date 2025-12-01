import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  keccak256,
  encodeAbiParameters,
  formatUnits,
  erc721Abi
} from 'viem';
import { GraphQLClient, gql } from 'graphql-request';

// -----------------------------
// Chain & client configuration
// -----------------------------

const MONAD_RPC_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_MONAD_RPC_URL) ||
  'https://rpc.monad.xyz';

const monad = defineChain({
  id: 143,
  name: 'Monad',
  network: 'monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [MONAD_RPC_URL] },
    public: { http: [MONAD_RPC_URL] }
  }
});

export const POSITION_MANAGER_ADDRESS = '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016' as const;

// StateView for Uniswap v4 on Monad (used to read sqrtPriceX96 + tick)
const STATE_VIEW_ADDRESS = '0x77395f3b2e73ae90843717371294fa97cc419d64' as const;

export const publicClient = createPublicClient({
  chain: monad,
  transport: http(MONAD_RPC_URL)
});

// -----------------------------
// Subgraph client (Monad Uniswap v4)
// -----------------------------

const UNISWAP_V4_SUBGRAPH_ID = '3kaAG19ytkGfu8xD7YAAZ3qAQ3UDJRkmKH2kHUuyGHah';
const THE_GRAPH_API_KEY =
  (typeof process !== 'undefined' && process.env.THE_GRAPH_API_KEY) ||
  (typeof process !== 'undefined' && process.env.THEGRAPH_API_KEY) ||
  '';
const UNISWAP_V4_SUBGRAPH_URL =
  (typeof process !== 'undefined' && process.env.UNISWAP_V4_SUBGRAPH_URL?.trim()) ||
  `https://gateway.thegraph.com/api/${THE_GRAPH_API_KEY}/subgraphs/id/${UNISWAP_V4_SUBGRAPH_ID}`;

const graphClient = new GraphQLClient(UNISWAP_V4_SUBGRAPH_URL);

const DEFAULT_POSITION_DETAILS_DELAY_MS = 150;
const POSITION_DETAILS_DELAY_MS =
  typeof process !== 'undefined' && process.env.POSITION_DETAILS_DELAY_MS
    ? Number(process.env.POSITION_DETAILS_DELAY_MS)
    : DEFAULT_POSITION_DETAILS_DELAY_MS;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// -----------------------------
// Types
// -----------------------------

export interface PositionDetails {
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
}

export interface PositionWithAmounts extends PositionDetails {
  amount0: bigint;
  amount1: bigint;
  rangeStatus: 'below-range' | 'in-range' | 'above-range';
  valueUsd?: number;
  currentTick: number;
  sqrtPriceX96: bigint;
}

export interface UserPositionsSummary {
  hasLpNft: boolean;
  hasLpFromOnchain: boolean;
  hasLpFromSubgraph: boolean;
  indexerPositionCount: number;
  lpPositions: PositionDetails[];
}

interface PackedPositionInfo {
  getTickUpper(): number;
  getTickLower(): number;
  hasSubscriber(): boolean;
}

interface SubgraphPosition {
  tokenId: string;
  id: string;
  owner: string;
}

// -----------------------------
// ABI fragments
// -----------------------------

const POSITION_MANAGER_ABI = [
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

const STATE_VIEW_ABI = [
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
  }
] as const;

// -----------------------------
// Subgraph: position IDs on Monad
// -----------------------------

const GET_POSITIONS_QUERY = gql`
  query GetPositions($owner: String!) {
    positions(where: { owner: $owner }) {
      tokenId
      id
      owner
    }
  }
`;

/**
 * Fetch v4 LP position tokenIds for an owner from the official
 * Monad Uniswap v4 subgraph.
 *
 * This completely replaces any Unichain/Neynar indexer usage.
 */
export async function getPositionIds(owner: Address): Promise<bigint[]> {
  const ownerLower = owner.toLowerCase();

  try {
    const data = await graphClient.request<{ positions: SubgraphPosition[] }>(GET_POSITIONS_QUERY, {
      owner: ownerLower
    });

    const positions = data.positions ?? [];
    const ids: bigint[] = [];

    for (const p of positions) {
      try {
        if (!p.tokenId) continue;
        ids.push(BigInt(p.tokenId));
      } catch {
        // Skip malformed tokenIds
      }
    }

    return ids;
  } catch (error) {
    console.error('Failed to fetch positions from Monad Uniswap v4 subgraph', error);
    return [];
  }
}

// -----------------------------
// Packed position decoder
// (from official Uniswap v4 docs, rewritten
// to avoid BigInt literals requiring ES2020)
// -----------------------------

export function decodePositionInfo(value: bigint): PackedPositionInfo {
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

// -----------------------------
// Core helpers: base details
// -----------------------------

/**
 * Fetch full position details for a single Uniswap v4 LP NFT.
 *
 * - Reads poolKey & packed position info from PositionManager.getPoolAndPositionInfo
 * - Reads liquidity from PositionManager.getPositionLiquidity
 * - Decodes tickLower / tickUpper using the official packed format
 */
export async function getPositionDetails(tokenId: bigint): Promise<PositionDetails> {
  // 1) Get pool key and packed position info
  const [poolKey, infoValue] = (await publicClient.readContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPoolAndPositionInfo',
    args: [tokenId]
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

  // 2) Get liquidity
  const liquidity = (await publicClient.readContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPositionLiquidity',
    args: [tokenId]
  })) as bigint;

  // 3) Decode packed ticks
  const positionInfo = decodePositionInfo(infoValue);

  return {
    tokenId,
    tickLower: positionInfo.getTickLower(),
    tickUpper: positionInfo.getTickUpper(),
    liquidity,
    poolKey
  };
}

/**
 * Fetch details for many LP NFTs in parallel.
 */
export async function getManyPositionDetails(tokenIds: bigint[]): Promise<PositionDetails[]> {
  if (tokenIds.length === 0) return [];

  const details: PositionDetails[] = [];
  const delayMs = Number.isFinite(POSITION_DETAILS_DELAY_MS)
    ? Math.max(0, POSITION_DETAILS_DELAY_MS)
    : DEFAULT_POSITION_DETAILS_DELAY_MS;

  for (let i = 0; i < tokenIds.length; i += 1) {
    if (i > 0 && delayMs > 0) {
      await sleep(delayMs);
    }
    const detail = await getPositionDetails(tokenIds[i]);
    details.push(detail);
  }

  return details;
}

// -----------------------------
// High-level user summary
// -----------------------------

/**
 * Combined view for a user's v4 LP positions on Monad.
 *
 * - hasLpFromOnchain: derived from PositionManager.balanceOf(owner)
 * - hasLpFromSubgraph: true if the Monad subgraph returns any positions(owner)
 * - indexerPositionCount: raw count from the subgraph
 * - lpPositions: fully decoded on-chain positions for the tokenIds returned
 *
 * If the subgraph returns 0 positions but on-chain balanceOf(owner) > 0,
 * hasLpFromSubgraph will be false — this represents an indexer lag/mismatch.
 */
export async function getUserPositionsSummary(owner: Address): Promise<UserPositionsSummary> {
  // 1) On-chain truth: balanceOf on the Monad v4 PositionManager
  const balance = (await publicClient.readContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: erc721Abi,
    functionName: 'balanceOf',
    args: [owner]
  })) as bigint;
  const hasLpFromOnchain = balance > BigInt(0);

  // 2) Subgraph: position tokenIds for this owner on Monad
  const tokenIds = await getPositionIds(owner);
  const indexerPositionCount = tokenIds.length;
  const hasLpFromSubgraph = indexerPositionCount > 0;

  // 3) Decode full on-chain details for the discovered tokenIds
  const lpPositions = await getManyPositionDetails(tokenIds);

  // 4) Aggregate diagnostics
  return {
    hasLpNft: hasLpFromOnchain || hasLpFromSubgraph || lpPositions.length > 0,
    hasLpFromOnchain,
    hasLpFromSubgraph,
    indexerPositionCount,
    lpPositions
  };
}

// -----------------------------
// Math helpers (Uniswap v3/v4-style)
// -----------------------------

const Q96 = BigInt(1) << BigInt(96);

function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator === BigInt(0)) {
    throw new Error('mulDiv division by zero');
  }
  return (a * b) / denominator;
}

// TickMath constants from Uniswap v3, expressed via BigInt()
const MIN_TICK = -887272;
const MAX_TICK = -MIN_TICK;

const MIN_SQRT_RATIO = BigInt('4295128739'); // 2**32 * 1.0001**(-887272/2)
const MAX_SQRT_RATIO = BigInt('1461446703485210103287273052203988822378723970342');

/**
 * sqrtRatioAtTick ported from Uniswap V3 TickMath, returning Q64.96 sqrtPriceX96
 */
function sqrtRatioAtTick(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error('TICK_OUT_OF_BOUNDS');
  }

  const absTick = tick < 0 ? -tick : tick;

  let ratio =
    (absTick & 0x1) !== 0
      ? BigInt('0xfffcb933bd6fad37aa2d162d1a594001')
      : BigInt('0x100000000000000000000000000000000');
  if ((absTick & 0x2) !== 0) {
    ratio = (ratio * BigInt('0xfff97272373d413259a46990580e213a')) >> BigInt(128);
  }
  if ((absTick & 0x4) !== 0) {
    ratio = (ratio * BigInt('0xfff2e50f5f656932ef12357cf3c7fdcc')) >> BigInt(128);
  }
  if ((absTick & 0x8) !== 0) {
    ratio = (ratio * BigInt('0xffe5caca7e10e4e61c3624eaa0941cd0')) >> BigInt(128);
  }
  if ((absTick & 0x10) !== 0) {
    ratio = (ratio * BigInt('0xffcb9843d60f6159c9db58835c926644')) >> BigInt(128);
  }
  if ((absTick & 0x20) !== 0) {
    ratio = (ratio * BigInt('0xff973b41fa98c081472e6896dfb254c0')) >> BigInt(128);
  }
  if ((absTick & 0x40) !== 0) {
    ratio = (ratio * BigInt('0xff2ea16466c96a3843ec78b326b52861')) >> BigInt(128);
  }
  if ((absTick & 0x80) !== 0) {
    ratio = (ratio * BigInt('0xfe5dee046a99a2a811c461f1969c3053')) >> BigInt(128);
  }
  if ((absTick & 0x100) !== 0) {
    ratio = (ratio * BigInt('0xfcbe86c7900a88aedcffc83b479aa3a4')) >> BigInt(128);
  }
  if ((absTick & 0x200) !== 0) {
    ratio = (ratio * BigInt('0xf987a7253ac413176f2b074cf7815e54')) >> BigInt(128);
  }
  if ((absTick & 0x400) !== 0) {
    ratio = (ratio * BigInt('0xf3392b0822b70005940c7a398e4b70f3')) >> BigInt(128);
  }
  if ((absTick & 0x800) !== 0) {
    ratio = (ratio * BigInt('0xe7159475a2c29b7443b29c7fa6e889d9')) >> BigInt(128);
  }
  if ((absTick & 0x1000) !== 0) {
    ratio = (ratio * BigInt('0xd097f3bdfd2022b8845ad8f792aa5825')) >> BigInt(128);
  }
  if ((absTick & 0x2000) !== 0) {
    ratio = (ratio * BigInt('0xa9f746462d870fdf8a65dc1f90e061e5')) >> BigInt(128);
  }
  if ((absTick & 0x4000) !== 0) {
    ratio = (ratio * BigInt('0x70d869a156d2a1b890bb3df62baf32f7')) >> BigInt(128);
  }
  if ((absTick & 0x8000) !== 0) {
    ratio = (ratio * BigInt('0x31be135f97d08fd981231505542fcfa6')) >> BigInt(128);
  }
  if ((absTick & 0x10000) !== 0) {
    ratio = (ratio * BigInt('0x9aa508b5b7a84e1c677de54f3e99bc9')) >> BigInt(128);
  }
  if ((absTick & 0x20000) !== 0) {
    ratio = (ratio * BigInt('0x5d6af8dedb81196699c329225ee604')) >> BigInt(128);
  }
  if ((absTick & 0x40000) !== 0) {
    ratio = (ratio * BigInt('0x2216e584f5fa1ea926041bedfe98')) >> BigInt(128);
  }
  if ((absTick & 0x80000) !== 0) {
    ratio = (ratio * BigInt('0x48a170391f7dc42444e8fa2')) >> BigInt(128);
  }

  // Invert for positive ticks
  if (tick > 0) {
    const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    ratio = maxUint256 / ratio;
  }

  // Downshift from Q128.128 to Q128.96, with rounding up:
  const shift = BigInt(32);
  const remainderMask = (BigInt(1) << shift) - BigInt(0);
  const base = ratio >> shift;
  const remainder = ratio & remainderMask;
  const sqrtPriceX96 = remainder === BigInt(0) ? base : base + BigInt(1);

  if (sqrtPriceX96 < MIN_SQRT_RATIO) return MIN_SQRT_RATIO;
  if (sqrtPriceX96 > MAX_SQRT_RATIO) return MAX_SQRT_RATIO;
  return sqrtPriceX96;
}

// Liquidity → amounts, Uniswap-style

function getAmount0ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint
): bigint {
  let sqrtA = sqrtRatioAX96;
  let sqrtB = sqrtRatioBX96;
  if (sqrtA > sqrtB) {
    const tmp = sqrtA;
    sqrtA = sqrtB;
    sqrtB = tmp;
  }
  const numerator1 = liquidity * Q96;
  const numerator2 = sqrtB - sqrtA;
  const denominator = sqrtB * sqrtA;
  return mulDiv(numerator1, numerator2, denominator);
}

function getAmount1ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint
): bigint {
  let sqrtA = sqrtRatioAX96;
  let sqrtB = sqrtRatioBX96;
  if (sqrtA > sqrtB) {
    const tmp = sqrtA;
    sqrtA = sqrtB;
    sqrtB = tmp;
  }
  const numerator = liquidity * (sqrtB - sqrtA);
  return numerator / Q96;
}

function getAmountsForLiquidity(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint
): { amount0: bigint; amount1: bigint } {
  let sqrtA = sqrtRatioAX96;
  let sqrtB = sqrtRatioBX96;
  if (sqrtA > sqrtB) {
    const tmp = sqrtA;
    sqrtA = sqrtB;
    sqrtB = tmp;
  }

  if (sqrtRatioX96 <= sqrtA) {
    // current below range → all token0
    return {
      amount0: getAmount0ForLiquidity(sqrtA, sqrtB, liquidity),
      amount1: BigInt(0)
    };
  }

  if (sqrtRatioX96 < sqrtB) {
    // in range → mixed
    return {
      amount0: getAmount0ForLiquidity(sqrtRatioX96, sqrtB, liquidity),
      amount1: getAmount1ForLiquidity(sqrtA, sqrtRatioX96, liquidity)
    };
  }

  // current above range → all token1
  return {
    amount0: BigInt(0),
    amount1: getAmount1ForLiquidity(sqrtA, sqrtB, liquidity)
  };
}

// -----------------------------
// Pool state helpers
// -----------------------------

function getPoolIdFromKey(poolKey: PositionDetails['poolKey']): `0x${string}` {
  const encoded = encodeAbiParameters(
    [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' }
    ],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  );
  return keccak256(encoded) as `0x${string}`;
}

async function getCurrentPoolState(poolKey: PositionDetails['poolKey']): Promise<{
  sqrtPriceX96: bigint;
  tick: number;
}> {
  const poolId = getPoolIdFromKey(poolKey);
  const slot0 = await publicClient.readContract({
    address: STATE_VIEW_ADDRESS,
    abi: STATE_VIEW_ABI,
    functionName: 'getSlot0',
    args: [poolId]
  });

  const sqrtPriceX96 = slot0[0] as bigint;
  const tick = Number(slot0[1] as number);

  return { sqrtPriceX96, tick };
}

// -----------------------------
// USD value helper
// -----------------------------

export function computePositionValueUsd(
  position: { amount0: bigint; amount1: bigint },
  token0PriceUsd: number,
  token1PriceUsd: number,
  token0Decimals: number,
  token1Decimals: number
): number {
  const amount0Float =
    token0Decimals >= 0 ? Number(formatUnits(position.amount0, token0Decimals)) : 0;
  const amount1Float =
    token1Decimals >= 0 ? Number(formatUnits(position.amount1, token1Decimals)) : 0;

  const value0 = amount0Float * token0PriceUsd;
  const value1 = amount1Float * token1PriceUsd;
  return value0 + value1;
}

// -----------------------------
// Enrichment helpers
// -----------------------------

function buildPositionWithPoolState(
  position: PositionDetails,
  poolState: { sqrtPriceX96: bigint; tick: number }
): PositionWithAmounts {
  const sqrtLower = sqrtRatioAtTick(position.tickLower);
  const sqrtUpper = sqrtRatioAtTick(position.tickUpper);

  const { amount0, amount1 } = getAmountsForLiquidity(
    poolState.sqrtPriceX96,
    sqrtLower,
    sqrtUpper,
    position.liquidity
  );

  let rangeStatus: PositionWithAmounts['rangeStatus'];
  if (poolState.tick < position.tickLower) {
    rangeStatus = 'below-range';
  } else if (poolState.tick > position.tickUpper) {
    rangeStatus = 'above-range';
  } else {
    rangeStatus = 'in-range';
  }

  return {
    ...position,
    amount0,
    amount1,
    rangeStatus,
    currentTick: poolState.tick,
    sqrtPriceX96: poolState.sqrtPriceX96
  };
}

export async function enrichPositionWithAmounts(
  position: PositionDetails
): Promise<PositionWithAmounts> {
  const poolState = await getCurrentPoolState(position.poolKey);
  return buildPositionWithPoolState(position, poolState);
}

export async function enrichManyPositionsWithAmounts(
  positions: PositionDetails[]
): Promise<PositionWithAmounts[]> {
  if (positions.length === 0) return [];

  const results: PositionWithAmounts[] = [];
  const poolStateCache = new Map<string, { sqrtPriceX96: bigint; tick: number }>();

  for (const position of positions) {
    const poolId = getPoolIdFromKey(position.poolKey);
    let poolState = poolStateCache.get(poolId);
    if (!poolState) {
      poolState = await getCurrentPoolState(position.poolKey);
      poolStateCache.set(poolId, poolState);
    }
    results.push(buildPositionWithPoolState(position, poolState));
  }

  return results;
}

// -----------------------------
// Example usage
// -----------------------------

// (server-side or in a Next.js API route / server action)
//
// import {
//   getManyPositionDetails,
//   enrichManyPositionsWithAmounts,
//   computePositionValueUsd,
// } from './uniswapV4Positions';

async function exampleAmounts() {
  const base = await getManyPositionDetails([BigInt(15278)]);
  const enriched = await enrichManyPositionsWithAmounts(base);
  console.log(enriched);

  // Optionally, if you know USD prices & decimals:
  // const valueUsd = computePositionValueUsd(
  //   enriched[0],
  //   0.000001, // token0 price USD
  //   0.03,     // token1 price USD
  //   18,       // token0 decimals
  //   18,       // token1 decimals
  // );
  // console.log('USD value of first position:', valueUsd);
}

// Silence unused warning if this module is imported but example isn't called.
void exampleAmounts;
