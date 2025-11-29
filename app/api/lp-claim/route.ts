import { NextRequest, NextResponse } from 'next/server';
import { Percent, Token } from '@uniswap/sdk-core';
import { Pool, Position, V4PositionManager, type MintOptions } from '@uniswap/v4-sdk';
import { createPublicClient, http, parseUnits, isAddress, defineChain, type Hex } from 'viem';

const POSITION_MANAGER_ADDRESS = '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016';
const STATE_VIEW_ADDRESS = '0x77395f3b2e73ae90843717371294fa97cc419d64';
const TOKEN_MOON_ADDRESS = '0x22Cd99EC337a2811F594340a4A6E41e4A3022b07';
const TOKEN_WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const HOOK_ADDRESS = '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc';
const FEE = 8_388_608;
const TICK_SPACING = 200;
const DEFAULT_MONAD_CHAIN_ID = 143;
const DEFAULT_MONAD_RPC_URL = 'https://rpc.monad.xyz';
const BACKSTOP_TICK_LOWER = -106_600;
const BACKSTOP_TICK_UPPER = -104_600;
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

const snapToSpacing = (tick: number) => Math.floor(tick / TICK_SPACING) * TICK_SPACING;

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

  if (preset !== 'backstop') {
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

    const tickLower = snapToSpacing(BACKSTOP_TICK_LOWER);
    const tickUpper = snapToSpacing(BACKSTOP_TICK_UPPER);

    if (tickUpper <= tickLower) {
      throw new Error('invalid_tick_configuration');
    }

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

    // Treat the user input as WMON (token1) and derive the required m00n (token0)
    const position = Position.fromAmount1({
      pool,
      tickLower,
      tickUpper,
      amount1: amountWei.toString()
    });

    const currentBlock = await publicClient.getBlock();
    const currentTimestamp = Number(currentBlock.timestamp);
    const deadlineSeconds = currentTimestamp + DEADLINE_SECONDS;

    const mintOptions: MintOptions = {
      recipient: address,
      // Use 0% slippage at the contract level to avoid SDK integer underflow/overflow bugs.
      // We can always widen user approvals a bit client-side if needed.
      slippageTolerance: new Percent(0, 10_000),
      deadline: deadlineSeconds.toString(),
      hookData: '0x'
    };

    const { calldata, value } = V4PositionManager.addCallParameters(position, mintOptions);

    return NextResponse.json({
      to: POSITION_MANAGER_ADDRESS,
      data: calldata,
      value,
      requiredMoonWei: position.amount0.quotient.toString(),
      requiredWmonWei: position.amount1.quotient.toString()
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
