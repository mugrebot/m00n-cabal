import { NextRequest, NextResponse } from 'next/server';
import JSBI from 'jsbi';
import { Token } from '@uniswap/sdk-core';
import { Pool, Position, V4PositionManager, V4PositionPlanner } from '@uniswap/v4-sdk';
import {
  createPublicClient,
  http,
  parseUnits,
  isAddress,
  defineChain,
  keccak256,
  concatHex,
  padHex,
  toHex,
  type Hex
} from 'viem';

const POSITION_MANAGER_ADDRESS = '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016';
const POOL_MANAGER_ADDRESS = '0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e';
const TOKEN_MOON_ADDRESS = '0x22Cd99EC337a2811F594340a4A6E41e4A3022b07';
const TOKEN_WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const HOOK_ADDRESS = '0x94f802a9efe4dd542fdbd77a25d9e69a6dc828cc';
const FEE = 8_388_608;
const TICK_SPACING = 200;
const DEFAULT_MONAD_CHAIN_ID = 143;
const DEFAULT_MONAD_RPC_URL = 'https://rpc.monad.xyz';
const POOLS_SLOT = padHex(toHex(BigInt(6)), { size: 32 });
const LIQUIDITY_OFFSET = BigInt(3);
const ONE = BigInt(1);
const Q96_SHIFT = BigInt(160);
const TICK_SIGN_SHIFT = BigInt(23);
const UINT24_SHIFT = BigInt(24);
const SQRT_PRICE_MASK = (ONE << Q96_SHIFT) - ONE;
const UINT24_MASK = (ONE << UINT24_SHIFT) - ONE;
const UINT256_MAX = (ONE << BigInt(256)) - ONE;
const BACKSTOP_TICK_LOWER = -106_600;
const BACKSTOP_TICK_UPPER = -104_600;
// Use zero slippage in the SDK helper to avoid any negative max-amount artifacts
// 5% slippage, expressed in basis points (out of 10_000)
const DEFAULT_SLIPPAGE_BPS = BigInt(500);
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

const poolManagerAbi = [
  {
    type: 'function',
    name: 'extsload',
    stateMutability: 'view',
    inputs: [{ name: 'slot', type: 'bytes32' }],
    outputs: [{ name: 'value', type: 'bytes32' }]
  }
] as const;

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function buildError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const getPoolStateSlot = (poolId: Hex) => keccak256(concatHex([poolId, POOLS_SLOT]));

const addSlotOffset = (slot: Hex, offset: bigint) =>
  padHex(toHex(BigInt(slot) + offset), { size: 32 });

const decodeSlot0 = (slotWord: bigint) => {
  const sqrtPriceX96 = slotWord & SQRT_PRICE_MASK;
  let tick = (slotWord >> Q96_SHIFT) & UINT24_MASK;
  if (tick >= ONE << TICK_SIGN_SHIFT) {
    tick -= ONE << UINT24_SHIFT;
  }
  const protocolFee = Number((slotWord >> (Q96_SHIFT + UINT24_SHIFT)) & UINT24_MASK);
  const lpFee = Number((slotWord >> (Q96_SHIFT + UINT24_SHIFT + UINT24_SHIFT)) & UINT24_MASK);
  return {
    sqrtPriceX96,
    tick: Number(tick),
    protocolFee,
    lpFee
  };
};

const snapToSpacing = (tick: number) => Math.floor(tick / TICK_SPACING) * TICK_SPACING;

const parseCallValue = (raw?: string) => {
  if (!raw) return BigInt(0);
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '0x' || trimmed === '0x0') return BigInt(0);
  return trimmed.startsWith('0x') ? BigInt(trimmed) : BigInt(trimmed);
};

function clampJsbiToUint256(value: JSBI) {
  const asBig = BigInt(value.toString());
  const zeroBig = BigInt(0);
  const clamped = asBig < zeroBig ? zeroBig : asBig > UINT256_MAX ? UINT256_MAX : asBig;
  return JSBI.BigInt(clamped.toString());
}

function getMaxAmountsWithSlippage(
  amount0Desired: JSBI,
  amount1Desired: JSBI,
  slippageBps: bigint
) {
  const zero = JSBI.BigInt(0);
  const bpsBase = JSBI.BigInt(10_000);
  const bpsPlus = JSBI.add(bpsBase, JSBI.BigInt(slippageBps.toString()));

  const applySlippage = (desired: JSBI) => {
    if (!JSBI.greaterThan(desired, zero)) return zero;
    // floor(amount * (1 + slippageBps / 10_000)), then clamp to uint256
    const num = JSBI.multiply(desired, bpsPlus);
    const withSlippage = JSBI.divide(num, bpsBase);
    return clampJsbiToUint256(withSlippage);
  };

  return {
    amount0Max: applySlippage(amount0Desired),
    amount1Max: applySlippage(amount1Desired)
  };
}

function buildMintCallParameters(position: Position, recipient: string, deadline: bigint) {
  const zero = JSBI.BigInt(0);
  if (!JSBI.greaterThan(position.liquidity, zero)) {
    throw new Error('zero_liquidity');
  }

  // Clamp liquidity to uint256 to avoid any overflow in the ABI encoder,
  // even if pool state decoding were ever to produce an out-of-range value.
  const safeLiquidity = clampJsbiToUint256(position.liquidity);

  // Dual-sided mint: use the position's mintAmounts (derived from your WMON input)
  // and add a fixed 5% slippage cushion to both m00n and WMON.
  const { amount0Max, amount1Max } = getMaxAmountsWithSlippage(
    position.amount0.quotient,
    position.amount1.quotient,
    DEFAULT_SLIPPAGE_BPS
  );

  const planner = new V4PositionPlanner();
  // Single mint in our fixed band, payer is the user (MSG_SENDER)
  planner.addMint(
    position.pool,
    position.tickLower,
    position.tickUpper,
    safeLiquidity,
    amount0Max.toString(),
    amount1Max.toString(),
    recipient,
    '0x'
  );
  // User settles both currencies; no migrate / native path
  planner.addSettlePair(position.pool.currency0, position.pool.currency1);

  const unlockData = planner.finalize();
  const calldata = V4PositionManager.encodeModifyLiquidities(unlockData, deadline.toString());

  return {
    calldata,
    value: '0x0'
  };
}

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

    const poolStateSlot = getPoolStateSlot(poolIdHex);
    const slot0WordHex = await publicClient.readContract({
      address: POOL_MANAGER_ADDRESS,
      abi: poolManagerAbi,
      functionName: 'extsload',
      args: [poolStateSlot]
    });
    const slot0Word = BigInt(slot0WordHex);
    if (slot0Word === BigInt(0)) {
      throw new Error('pool_uninitialized');
    }

    const slot0 = decodeSlot0(slot0Word);
    const tickLower = snapToSpacing(BACKSTOP_TICK_LOWER);
    const tickUpper = snapToSpacing(BACKSTOP_TICK_UPPER);

    if (tickUpper <= tickLower) {
      throw new Error('invalid_tick_configuration');
    }
    const liquiditySlot = addSlotOffset(poolStateSlot, LIQUIDITY_OFFSET);
    const liquidityWordHex = await publicClient.readContract({
      address: POOL_MANAGER_ADDRESS,
      abi: poolManagerAbi,
      functionName: 'extsload',
      args: [liquiditySlot]
    });
    const poolLiquidity = BigInt(liquidityWordHex);

    const pool = new Pool(
      moonToken,
      wmonToken,
      FEE,
      TICK_SPACING,
      normalizeAddress(HOOK_ADDRESS),
      JSBI.BigInt(slot0.sqrtPriceX96.toString()),
      JSBI.BigInt(poolLiquidity.toString()),
      slot0.tick
    );

    // Treat the user input as WMON (token1) and derive the required m00n (token0)
    const position = Position.fromAmount1({
      pool,
      tickLower,
      tickUpper,
      amount1: amountWei.toString()
    });

    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    const { calldata, value } = buildMintCallParameters(position, address, deadline);

    try {
      await publicClient.call({
        account: address as `0x${string}`,
        to: POSITION_MANAGER_ADDRESS,
        data: calldata as Hex,
        value: parseCallValue(value)
      });
    } catch (simulationError) {
      console.error('LP simulation failed', simulationError);
      return buildError('lp_simulation_failed', 400);
    }

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
