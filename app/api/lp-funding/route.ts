import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, defineChain, erc20Abi, http, isAddress } from 'viem';

const WMON_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const MOON_TOKEN_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
// For Uniswap v4 on Monad, the PositionManager uses Permit2 for token
// pull logic. We therefore track ERC20 allowances to Permit2 here, rather
// than to the PositionManager itself.
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
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

const transport = http(monadRpcUrl, {
  batch: true,
  timeout: 30_000
});

const publicClient = createPublicClient({
  chain: monadChain,
  transport
});

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address');
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: 'invalid_address' }, { status: 400 });
  }

  try {
    const [
      wmonBalanceWei,
      wmonAllowanceWei,
      moonBalanceWei,
      moonAllowanceWei,
      wmonDecimals,
      moonDecimals
    ] = await Promise.all([
      publicClient.readContract({
        address: WMON_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
        batch: { multicall: true }
      }),
      publicClient.readContract({
        address: WMON_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address as `0x${string}`, PERMIT2_ADDRESS as `0x${string}`],
        batch: { multicall: true }
      }),
      publicClient.readContract({
        address: MOON_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
        batch: { multicall: true }
      }),
      publicClient.readContract({
        address: MOON_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address as `0x${string}`, PERMIT2_ADDRESS as `0x${string}`],
        batch: { multicall: true }
      }),
      publicClient.readContract({
        address: WMON_ADDRESS,
        abi: erc20Abi,
        functionName: 'decimals'
      }),
      publicClient.readContract({
        address: MOON_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: 'decimals'
      })
    ]);

    return NextResponse.json({
      wmonBalanceWei: wmonBalanceWei.toString(),
      wmonAllowanceWei: wmonAllowanceWei.toString(),
      moonBalanceWei: moonBalanceWei.toString(),
      moonAllowanceWei: moonAllowanceWei.toString(),
      wmonDecimals: Number(wmonDecimals),
      moonDecimals: Number(moonDecimals)
    });
  } catch (error) {
    console.error('Failed to fetch LP funding data', error);
    return NextResponse.json({ error: 'funding_lookup_failed' }, { status: 500 });
  }
}
