import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, defineChain, erc20Abi, http, isAddress } from 'viem';

const WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const POSITION_MANAGER_ADDRESS = '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016';
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
    const [balanceWei, allowanceWei] = await Promise.all([
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
      })
    ]);

    return NextResponse.json({
      balanceWei: balanceWei.toString(),
      allowanceWei: allowanceWei.toString()
    });
  } catch (error) {
    console.error('Failed to fetch LP funding data', error);
    return NextResponse.json({ error: 'funding_lookup_failed' }, { status: 500 });
  }
}
