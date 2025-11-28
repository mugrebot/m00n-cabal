import { NextRequest, NextResponse } from 'next/server';
import JSBI from 'jsbi';
import { Token, Percent } from '@uniswap/sdk-core';
import { Pool, Position, V4PositionManager } from '@uniswap/v4-sdk';
import { createPublicClient, http, parseUnits, isAddress, defineChain, type Hex } from 'viem';

const POSITION_MANAGER_ADDRESS = '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016';
const POOL_MANAGER_ADDRESS = '0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e';
const TOKEN_MOON_ADDRESS = '0x22Cd99EC337a2811F594340a4A6E41e4A3022b07';
const TOKEN_WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const HOOK_ADDRESS = '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc';
const FEE = 8_388_608;
const TICK_SPACING = 200;
const BACKSTOP_PRESET = {
  tickLower: -106_600,
  tickUpper: -104_600
};
const DEFAULT_SLIPPAGE_BPS = BigInt(50); // 0.5%
const DEADLINE_SECONDS = 10 * 60; // 10 minutes

const monadChainId = Number(process.env.MONAD_CHAIN_ID ?? '0');
const monadRpcUrl = process.env.MONAD_RPC_URL;

const monadChain =
  monadRpcUrl && monadChainId
    ? defineChain({
        id: monadChainId,
        name: 'Monad',
        network: 'monad',
        nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
        rpcUrls: {
          default: { http: [monadRpcUrl] },
          public: { http: [monadRpcUrl] }
        }
      })
    : null;

const publicClient =
  monadChain && monadRpcUrl
    ? createPublicClient({
        chain: monadChain,
        transport: http(monadRpcUrl)
      })
    : null;

const poolManagerAbi = [
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

export async function POST(request: NextRequest) {
  if (!publicClient || !monadChain) {
    return buildError('monad_rpc_unconfigured', 500);
  }

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

    const [slot0Result, liquidity] = await Promise.all([
      publicClient.readContract({
        address: POOL_MANAGER_ADDRESS,
        abi: poolManagerAbi,
        functionName: 'getSlot0',
        args: [poolIdHex]
      }),
      publicClient.readContract({
        address: POOL_MANAGER_ADDRESS,
        abi: poolManagerAbi,
        functionName: 'getLiquidity',
        args: [poolIdHex]
      })
    ]);

    const [sqrtPriceX96, tick] = slot0Result as [bigint, number, number, number];
    const poolLiquidity = liquidity as bigint;

    const pool = new Pool(
      moonToken,
      wmonToken,
      FEE,
      TICK_SPACING,
      normalizeAddress(HOOK_ADDRESS),
      JSBI.BigInt(sqrtPriceX96.toString()),
      JSBI.BigInt(poolLiquidity.toString()),
      Number(tick)
    );

    const position = Position.fromAmount1({
      pool,
      tickLower: BACKSTOP_PRESET.tickLower,
      tickUpper: BACKSTOP_PRESET.tickUpper,
      amount1: amountWei.toString()
    });

    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
    const slippageTolerance = new Percent(DEFAULT_SLIPPAGE_BPS.toString(), '10000');

    const { calldata, value } = V4PositionManager.addCallParameters(position, {
      recipient: address,
      deadline: deadline.toString(),
      slippageTolerance,
      hookData: '0x'
    });

    return NextResponse.json({
      to: POSITION_MANAGER_ADDRESS,
      data: calldata,
      value
    });
  } catch (error) {
    console.error('LP claim build failed', error);
    return buildError('lp_claim_failed', 500);
  }
}
