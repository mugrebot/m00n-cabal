import { NextRequest, NextResponse } from 'next/server';
import { Percent, Token } from '@uniswap/sdk-core';
import { Pool, Position, V4PositionManager } from '@uniswap/v4-sdk';
import {
  createPublicClient,
  http,
  parseUnits,
  isAddress,
  defineChain,
  encodeFunctionData,
  type Hex
} from 'viem';

const POSITION_MANAGER_ADDRESS = '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016';
const STATE_VIEW_ADDRESS = '0x77395f3b2e73ae90843717371294fa97cc419d64';
const TOKEN_MOON_ADDRESS = '0x22Cd99EC337a2811F594340a4A6E41e4A3022b07';
const TOKEN_WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const HOOK_ADDRESS = '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc';
const FEE = 8_388_608;
const TICK_SPACING = 200;
const DEFAULT_MONAD_CHAIN_ID = 143;
const DEFAULT_MONAD_RPC_URL = 'https://rpc.monad.xyz';
const SLIPPAGE_BPS = 500; // 5%
// Crash-band preset: place the band ~20% below the current price, fully below
// the active tick, and fund it with token1 (WMON) only. As price nukes into
// the band, WMON is converted into m00n.
const CRASH_BAND_WIDTH_TICKS = 6 * TICK_SPACING;
const DEADLINE_SECONDS = 10 * 60; // 10 minutes

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

const positionManagerAbi = [
  {
    type: 'function',
    name: 'multicall',
    stateMutability: 'payable',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }]
  }
] as const;

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

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function buildError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const snapDownToSpacing = (tick: number) => Math.floor(tick / TICK_SPACING) * TICK_SPACING;
const snapUpToSpacing = (tick: number) => Math.ceil(tick / TICK_SPACING) * TICK_SPACING;
const ratioToTickDelta = (ratio: number) => Math.floor(Math.log(ratio) / Math.log(1.0001));
const withSlippageBuffer = (value: bigint) =>
  value + (value * BigInt(SLIPPAGE_BPS)) / BigInt(10_000);

export async function POST(request: NextRequest) {
  let body: { address?: string; amount?: string; preset?: string };
  try {
    body = await request.json();
  } catch {
    return buildError('invalid_json');
  }

  const { address, amount, preset } = body;

  if (!address || !isAddress(address)) {
    return buildError('invalid_address');
  }

  if (!amount) {
    return buildError('missing_amount');
  }

  if (preset !== 'backstop' && preset !== 'moon_upside') {
    return buildError('unsupported_preset');
  }

  let amountWei: bigint;
  try {
    amountWei = parseUnits(amount, 18);
  } catch {
    return buildError('invalid_amount');
  }

  if (amountWei <= BigInt(0)) {
    return buildError('amount_must_be_positive');
  }

  try {
    const moonToken = new Token(
      monadChainId,
      normalizeAddress(TOKEN_MOON_ADDRESS),
      18,
      'm00n',
      'm00nad'
    );
    const wmonToken = new Token(
      monadChainId,
      normalizeAddress(TOKEN_WMON_ADDRESS),
      18,
      'WMON',
      'Wrapped MON'
    );

    const poolId = Pool.getPoolId(
      moonToken,
      wmonToken,
      FEE,
      TICK_SPACING,
      normalizeAddress(HOOK_ADDRESS)
    );
    const poolIdHex = poolId as Hex;

    const [slot0, poolLiquidityRaw] = await Promise.all([
      publicClient.readContract({
        address: STATE_VIEW_ADDRESS,
        abi: stateViewAbi,
        functionName: 'getSlot0',
        args: [poolIdHex]
      }),
      publicClient.readContract({
        address: STATE_VIEW_ADDRESS,
        abi: stateViewAbi,
        functionName: 'getLiquidity',
        args: [poolIdHex]
      })
    ]);

    const sqrtPriceX96 = slot0[0] as bigint;
    const currentTick = Number(slot0[1]);
    const poolLiquidity = poolLiquidityRaw as bigint;

    // Compute a crash band whose upper bound is approximately 10% below the
    // current price, and whose lower bound extends a fixed width further down.
    // Price in Uniswap ticks is P = 1.0001^tick, so a 10% decrease corresponds
    // to adding log(0.9) / log(1.0001) ticks (a negative number).
    const pool = new Pool(
      moonToken,
      wmonToken,
      FEE,
      TICK_SPACING,
      normalizeAddress(HOOK_ADDRESS),
      sqrtPriceX96.toString(),
      poolLiquidity.toString(),
      currentTick
    );

    let tickLower: number;
    let tickUpper: number;
    let amount0Desired = '0';
    let amount1Desired = '0';

    if (preset === 'backstop') {
      const tenPercentDownTicks = Math.floor(Math.log(0.9) / Math.log(1.0001));
      const rawUpperTick = currentTick + tenPercentDownTicks;
      const snappedUpper = snapDownToSpacing(rawUpperTick);
      tickUpper = snappedUpper;
      tickLower = tickUpper - CRASH_BAND_WIDTH_TICKS;
      if (tickUpper <= tickLower) {
        throw new Error('invalid_tick_configuration');
      }
      amount1Desired = amountWei.toString();
    } else {
      const lowerDelta = ratioToTickDelta(1.2);
      const upperDelta = ratioToTickDelta(5);
      const rawLower = currentTick + lowerDelta;
      const rawUpper = currentTick + upperDelta;
      tickLower = snapDownToSpacing(rawLower);
      tickUpper = snapUpToSpacing(rawUpper);
      if (tickUpper <= tickLower) {
        tickUpper = tickLower + TICK_SPACING;
      }
      amount0Desired = amountWei.toString();
    }

    const position = Position.fromAmounts({
      pool,
      tickLower,
      tickUpper,
      amount0: amount0Desired,
      amount1: amount1Desired,
      useFullPrecision: true
    });

    const currentBlock = await publicClient.getBlock();
    const currentTimestamp = Number(currentBlock.timestamp);
    const deadlineSeconds = currentTimestamp + DEADLINE_SECONDS;

    const slippagePct = new Percent(SLIPPAGE_BPS, 10_000);
    const deadline = deadlineSeconds.toString();

    const { calldata: innerCalldata, value } = V4PositionManager.addCallParameters(position, {
      recipient: address,
      slippageTolerance: slippagePct,
      deadline,
      hookData: '0x'
    });

    // Wrap the v4 SDK calldata in a PositionManager.multicall, exactly like the
    // guide's viem example.
    const calldata = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: 'multicall',
      args: [[innerCalldata as Hex]]
    });

    const requiredMoonWei = position.amount0.quotient;
    const requiredWmonWei = position.amount1.quotient;
    const maxRequiredMoonWei = withSlippageBuffer(requiredMoonWei);
    const maxRequiredWmonWei = withSlippageBuffer(requiredWmonWei);

    return NextResponse.json({
      to: POSITION_MANAGER_ADDRESS,
      data: calldata,
      value,
      requiredMoonWei: requiredMoonWei.toString(),
      requiredWmonWei: requiredWmonWei.toString(),
      maxRequiredMoonWei: maxRequiredMoonWei.toString(),
      maxRequiredWmonWei: maxRequiredWmonWei.toString()
    });
  } catch (error) {
    console.error('LP claim build failed', error);
    const code =
      error instanceof Error && error.message
        ? `lp_claim_failed:${error.message}`
        : 'lp_claim_failed';
    return buildError(code, 500);
  }
}
