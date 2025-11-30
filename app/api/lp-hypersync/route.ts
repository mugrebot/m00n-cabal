import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
import {
  HypersyncClient,
  LogField,
  JoinMode,
  type Query as HypersyncQuery
} from '@envio-dev/hypersync-client';
import { keccak256, toHex, pad, type Address, formatUnits, encodeAbiParameters } from 'viem';
import {
  POSITION_MANAGER_ADDRESS,
  getManyPositionDetails,
  enrichManyPositionsWithAmounts,
  type PositionDetails,
  type PositionWithAmounts
} from '../../lib/uniswapV4Positions';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/i;
const MONAD_HYPERSYNC_URL =
  (process.env.HYPERSYNC_RPC_URL ?? '').trim() || 'https://monad.hypersync.xyz';
const HYPERSYNC_API_KEY = (process.env.HYPERSYNC_API_KEY ?? '').trim();
const DEFAULT_V4_DEPLOYMENT_BLOCK = 38857749;
const V4_DEPLOYMENT_BLOCK = Number(
  process.env.V4_POSITION_MANAGER_DEPLOY_BLOCK ?? DEFAULT_V4_DEPLOYMENT_BLOCK
);
const MAX_STREAM_ITERATIONS = 2048;

const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'));
const TARGET_TOKEN0 = '0x22Cd99EC337a2811F594340a4A6E41e4A3022b07'.toLowerCase();
const TARGET_TOKEN1 = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'.toLowerCase();

const TOKEN_METADATA: Record<string, { symbol: string; decimals: number }> = {
  [TARGET_TOKEN0]: { symbol: 'm00nad', decimals: 18 },
  [TARGET_TOKEN1]: { symbol: 'WMON', decimals: 18 }
};

const hypersyncClient = new HypersyncClient({
  url: MONAD_HYPERSYNC_URL,
  apiToken: HYPERSYNC_API_KEY
});

interface HypersyncPositionPayload {
  tokenId: string;
  poolAddress: string;
  token0: { address: string; symbol?: string; decimals?: number };
  token1: { address: string; symbol?: string; decimals?: number };
  fee: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  inRange: boolean;
}

function toTopicAddress(address: Address) {
  return pad(address.toLowerCase() as `0x${string}`, { size: 32 }).toLowerCase();
}

function matchesTargetPool(poolKey: PositionDetails['poolKey']) {
  const c0 = poolKey.currency0.toLowerCase();
  const c1 = poolKey.currency1.toLowerCase();
  return (
    (c0 === TARGET_TOKEN0 && c1 === TARGET_TOKEN1) || (c0 === TARGET_TOKEN1 && c1 === TARGET_TOKEN0)
  );
}

function describeToken(address: string) {
  const meta = TOKEN_METADATA[address.toLowerCase()];
  return { address, symbol: meta?.symbol, decimals: meta?.decimals };
}

function formatTokenAmount(value: bigint) {
  const formatted = formatUnits(value, 18);
  if (!formatted.includes('.')) return formatted;
  return formatted.replace(/\.?0+$/, '') || '0';
}

function getPoolIdFromKey(position: PositionDetails): string {
  const { poolKey } = position;
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
  return keccak256(encoded);
}

async function getOwnedLpTokenIds(owner: Address): Promise<bigint[]> {
  const ownerTopic = toTopicAddress(owner);
  const ownership = new Map<string, number>();

  let query: HypersyncQuery = {
    fromBlock: V4_DEPLOYMENT_BLOCK,
    logs: [
      {
        address: [POSITION_MANAGER_ADDRESS.toLowerCase()],
        topics: [[TRANSFER_TOPIC], [], [ownerTopic], []]
      },
      {
        address: [POSITION_MANAGER_ADDRESS.toLowerCase()],
        topics: [[TRANSFER_TOPIC], [ownerTopic], [], []]
      }
    ],
    fieldSelection: {
      log: ['BlockNumber', 'Topic0', 'Topic1', 'Topic2', 'Topic3']
    },
    joinMode: JoinMode.JoinNothing
  };

  let iterations = 0;

  while (iterations < MAX_STREAM_ITERATIONS) {
    const response = await hypersyncClient.get(query);
    const logs = response?.data?.logs ?? [];

    for (const log of logs) {
      const topics = (log.topics ?? []) as (string | null | undefined)[];
      if (topics.length < 4) continue;
      const [, topicFromRaw, topicToRaw, topicTokenIdRaw] = topics;
      if (!topicTokenIdRaw) continue;

      const topicFrom = topicFromRaw?.toLowerCase() ?? null;
      const topicTo = topicToRaw?.toLowerCase() ?? null;

      let delta = 0;
      if (topicTo === ownerTopic) delta += 1;
      if (topicFrom === ownerTopic) delta -= 1;

      if (delta !== 0) {
        const tokenIdKey = BigInt(topicTokenIdRaw).toString();
        const current = ownership.get(tokenIdKey) ?? 0;
        ownership.set(tokenIdKey, current + delta);
      }
    }

    if (!response.nextBlock) break;
    query = { ...query, fromBlock: response.nextBlock };
    iterations += 1;
  }

  return [...ownership.entries()].filter(([, net]) => net > 0).map(([tokenId]) => BigInt(tokenId));
}

function serializePosition(position: PositionWithAmounts): HypersyncPositionPayload {
  const token0 = describeToken(position.poolKey.currency0);
  const token1 = describeToken(position.poolKey.currency1);
  return {
    tokenId: position.tokenId.toString(),
    poolAddress: getPoolIdFromKey(position),
    token0,
    token1,
    fee: position.poolKey.fee,
    tickSpacing: position.poolKey.tickSpacing,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    currentTick: position.currentTick,
    liquidity: position.liquidity.toString(),
    amount0: formatTokenAmount(position.amount0),
    amount1: formatTokenAmount(position.amount1),
    inRange: position.rangeStatus === 'in-range'
  };
}

export async function POST(req: NextRequest) {
  if (!HYPERSYNC_API_KEY) {
    return NextResponse.json({ error: 'hypersync_missing_api_key' }, { status: 500 });
  }

  try {
    const { address } = (await req.json()) as { address?: string };
    if (!address || !ADDRESS_REGEX.test(address)) {
      return NextResponse.json({ error: 'invalid_address' }, { status: 400 });
    }

    const owner = address as Address;
    const tokenIds = await getOwnedLpTokenIds(owner);

    if (tokenIds.length === 0) {
      return NextResponse.json({
        hasLpFromHypersync: false,
        owner: address,
        positions: [],
        note: 'No LP NFT transfers found for this wallet.'
      });
    }

    const details = await getManyPositionDetails(tokenIds);
    const targetPositions = details.filter((position) => matchesTargetPool(position.poolKey));

    if (targetPositions.length === 0) {
      return NextResponse.json({
        hasLpFromHypersync: false,
        owner: address,
        positions: [],
        note: 'Wallet holds LP NFTs, but none correspond to the m00nad/WMON pool.'
      });
    }

    const enriched = await enrichManyPositionsWithAmounts(targetPositions);
    const payload = enriched.map(serializePosition);

    return NextResponse.json({
      hasLpFromHypersync: payload.length > 0,
      owner: address,
      positions: payload
    });
  } catch (error) {
    console.error('LP_HYPERSYNC_ROUTE:error', error);
    return NextResponse.json({ error: 'hypersync_lookup_failed' }, { status: 500 });
  }
}
