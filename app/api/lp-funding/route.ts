import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, defineChain, erc20Abi, http, isAddress } from 'viem';

const WMON_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const POSITION_MANAGER_ADDRESS = '0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016';
const MOON_TOKEN_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
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

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address');
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: 'invalid_address' }, { status: 400 });
  }

  try {
    // Fetch balance, allowance, and decimals first
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
        args: [address as `0x${string}`]
      }),
      publicClient.readContract({
        address: WMON_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address as `0x${string}`, POSITION_MANAGER_ADDRESS as `0x${string}`]
      }),
      publicClient.readContract({
        address: MOON_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as `0x${string}`]
      }),
      publicClient.readContract({
        address: MOON_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address as `0x${string}`, POSITION_MANAGER_ADDRESS as `0x${string}`]
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

    // Try to fetch symbols with fallbacks
    let wmonSymbol = 'WMON';
    let moonSymbol = 'm00n';

    try {
      const symbolResult = await publicClient.readContract({
        address: WMON_ADDRESS,
        abi: erc20Abi,
        functionName: 'symbol'
      });
      if (typeof symbolResult === 'string' && symbolResult.length > 0) {
        wmonSymbol = symbolResult;
      }
    } catch {
      // Keep fallback
    }

    try {
      const symbolResult = await publicClient.readContract({
        address: MOON_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: 'symbol'
      });
      if (typeof symbolResult === 'string' && symbolResult.length > 0) {
        moonSymbol = symbolResult;
      }
    } catch {
      // Keep fallback
    }

    return NextResponse.json({
      wmonBalanceWei: wmonBalanceWei.toString(),
      wmonAllowanceWei: wmonAllowanceWei.toString(),
      moonBalanceWei: moonBalanceWei.toString(),
      moonAllowanceWei: moonAllowanceWei.toString(),
      wmonDecimals: Number(wmonDecimals),
      moonDecimals: Number(moonDecimals),
      wmonSymbol,
      moonSymbol
    });
  } catch (error) {
    console.error('Failed to fetch LP funding data', error);
    return NextResponse.json({ error: 'funding_lookup_failed' }, { status: 500 });
  }
}
