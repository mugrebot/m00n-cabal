'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import Image from 'next/image';
import sdk from '@farcaster/miniapp-sdk';
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiConfig, createConfig, http } from 'wagmi';
import { farcasterMiniApp as miniAppConnector } from '@farcaster/miniapp-wagmi-connector';
import { getTierByReplyCount } from '@/app/lib/tiers';
import { getPersonaCopy, type PersonaActionId, type LpStatus } from '@/app/copy/persona';

interface UserData {
  fid: number;
  username?: string;
  displayName?: string;
  verifiedAddresses: string[];
}

interface AirdropData {
  eligible: boolean;
  amount?: string;
  replyCount?: number | null;
}

interface EngagementData {
  replyCount: number;
  isFollowing: boolean;
}

interface ViewerContext {
  fid: number;
  username?: string;
  displayName?: string;
}

type ScanPhase = 'idle' | 'authenticating' | 'addresses' | 'fetching' | 'ready' | 'error';

const TOKEN_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
const WMON_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const POSITION_MANAGER_ADDRESS = '0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016';
const CLAIM_URL =
  'https://clanker.onchain.cooking/?token=0x22cd99ec337a2811f594340a4a6e41e4a3022b07&risk=warn&riskTag=Warning';
const CLAIM_UNLOCK_TIMESTAMP_MS = 1764272894 * 1000;
const LP_GATE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_LP_GATE === 'true';
const LP_MINT_URL =
  process.env.NEXT_PUBLIC_LP_MINT_URL ??
  'https://clanker.onchain.cooking/lp?token=0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
const LP_DOCS_URL =
  process.env.NEXT_PUBLIC_LP_DOCS_URL ??
  'https://docs.uniswap.org/concepts/protocol/concentrated-liquidity';
const ADMIN_FID = 9933;
const STICKER_EMOJIS = ['🌙', '💜', '🕸️', '🦇', '☠️', '✨', '🧬', '🛸', '🩸', '💾'];
const STICKER_COLORS = ['#6ce5b1', '#8c54ff', '#ff9b54', '#5ea3ff', '#f7e6ff'];
const HOLDER_CHAT_URL =
  process.env.NEXT_PUBLIC_HOLDER_CHAT_URL ?? 'https://warpcast.com/~/channel/m00n';
const HEAVEN_MODE_URL = process.env.NEXT_PUBLIC_HEAVEN_URL ?? 'https://warpcast.com/~/channel/m00n';
const CHAIN_CAIP = 'eip155:143';
const MON_NATIVE_CAIP = `${CHAIN_CAIP}/native`;
const WMON_CAIP = `${CHAIN_CAIP}/erc20:${WMON_ADDRESS.toLowerCase()}`;
const MOON_CAIP = `${CHAIN_CAIP}/erc20:${TOKEN_ADDRESS.toLowerCase()}`;
const truncateAddress = (value?: string | null) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : null;

type UserPersona =
  | 'claimed_sold'
  | 'claimed_held'
  | 'claimed_bought_more'
  | 'lp_gate'
  | 'eligible_holder'
  | 'locked_out';
type AdminPortalView = 'default' | UserPersona;

interface LpPosition {
  tokenId: string;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  poolKey: {
    currency0: string;
    currency1: string;
    fee: number;
    hooks: string;
  };
}

interface LpGateState {
  lpStatus: LpStatus;
  walletAddress?: string | null;
  lpPositions?: LpPosition[];
}

interface ReplyGlow {
  color: string;
  shadow: string;
}

const getReplyGlowConfig = (count: number): ReplyGlow => {
  if (count > 200) {
    return { color: '#ff9b54', shadow: 'rgba(255, 155, 84, 0.55)' };
  }
  if (count > 100) {
    return { color: '#8c54ff', shadow: 'rgba(140, 84, 255, 0.55)' };
  }
  if (count > 50) {
    return { color: '#5ea3ff', shadow: 'rgba(94, 163, 255, 0.6)' };
  }
  if (count > 1) {
    return { color: '#6ce5b1', shadow: 'rgba(108, 229, 177, 0.55)' };
  }
  return { color: '#8c54ff', shadow: 'rgba(140, 84, 255, 0.25)' };
};

const SHARE_URL = 'https://m00nad.vercel.app/miniapp';

const monadChain = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? 'https://rpc.monad.xyz']
    }
  },
  blockExplorers: {
    default: {
      name: 'Monadscan',
      url: 'https://monadscan.com'
    }
  }
};

const wagmiConfig = createConfig({
  chains: [monadChain],
  connectors: [miniAppConnector()],
  transports: {
    [monadChain.id]: http(monadChain.rpcUrls.default.http[0]!)
  }
});

const queryClient = new QueryClient();

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;

const permit2Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' }
    ],
    outputs: []
  }
] as const;

function MiniAppPageInner() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [isMiniApp, setIsMiniApp] = useState<boolean | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [airdropData, setAirdropData] = useState<AirdropData | null>(null);
  const [engagementData, setEngagementData] = useState<EngagementData | null>(null);
  const [showLootReveal, setShowLootReveal] = useState(false);
  const [primaryAddress, setPrimaryAddress] = useState<string | null>(null);
  const [miniWalletAddress, setMiniWalletAddress] = useState<string | null>(null);
  const [dropAddress, setDropAddress] = useState<string | null>(null);
  const [viewerContext, setViewerContext] = useState<ViewerContext | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [copiedContract, setCopiedContract] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [lpGateState, setLpGateState] = useState<LpGateState>({ lpStatus: 'DISCONNECTED' });
  const [isLpLoungeOpen, setIsLpLoungeOpen] = useState(false);
  const [lpRefreshNonce, setLpRefreshNonce] = useState(0);
  const [adminPortalView, setAdminPortalView] = useState<AdminPortalView>('default');
  const [hasZeroPoints, setHasZeroPoints] = useState(false);
  const [timeUntilClaimMs, setTimeUntilClaimMs] = useState(() =>
    Math.max(CLAIM_UNLOCK_TIMESTAMP_MS - Date.now(), 0)
  );
  const [isLpClaimModalOpen, setIsLpClaimModalOpen] = useState(false);
  const [lpClaimAmount, setLpClaimAmount] = useState('');
  const [isSubmittingLpClaim, setIsSubmittingLpClaim] = useState(false);
  const [lpClaimError, setLpClaimError] = useState<string | null>(null);
  const [lpDebugLog, setLpDebugLog] = useState<string>('');
  const [wmonBalanceWei, setWmonBalanceWei] = useState<bigint | null>(null);
  const [wmonAllowanceWei, setWmonAllowanceWei] = useState<bigint | null>(null);
  const [moonBalanceWei, setMoonBalanceWei] = useState<bigint | null>(null);
  const [moonAllowanceWei, setMoonAllowanceWei] = useState<bigint | null>(null);
  const [fundingStatus, setFundingStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fundingRefreshNonce, setFundingRefreshNonce] = useState(0);
  const [isApprovingMoon, setIsApprovingMoon] = useState(false);
  const [swapInFlight, setSwapInFlight] = useState<'wmon' | 'moon' | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState({ wmon: 18, moon: 18 });

  const formatAmount = (amount?: string | number) => {
    if (amount === undefined || amount === null) return '0';
    const numeric = typeof amount === 'string' ? parseInt(amount, 10) : amount;
    if (Number.isNaN(numeric)) return '0';
    return numeric.toLocaleString();
  };

  const isAdmin = viewerContext?.fid === ADMIN_FID;

  const classifyEligiblePersona = useCallback((amount: number, replyCount: number): UserPersona => {
    if (!Number.isFinite(amount) || amount <= 0) {
      return 'locked_out';
    }
    if (replyCount >= 20 || amount > 100000) {
      return 'claimed_bought_more';
    }
    if (replyCount >= 5) {
      return 'claimed_held';
    }
    if (replyCount >= 0) {
      return 'claimed_sold';
    }
    return 'eligible_holder';
  }, []);

  const derivedPersona: UserPersona = useMemo(() => {
    if (!userData) {
      return 'locked_out';
    }
    if (hasZeroPoints) {
      return 'locked_out';
    }
    if (airdropData?.eligible) {
      const amount = Number(airdropData.amount ?? '0');
      const replyCount = engagementData?.replyCount ?? 0;
      return classifyEligiblePersona(amount, replyCount);
    }
    if (LP_GATE_ENABLED) {
      return 'lp_gate';
    }
    return 'locked_out';
  }, [
    airdropData?.amount,
    airdropData?.eligible,
    classifyEligiblePersona,
    engagementData?.replyCount,
    hasZeroPoints,
    userData
  ]);

  const adminPersonaOverride = isAdmin && adminPortalView !== 'default' ? adminPortalView : null;
  const effectivePersona: UserPersona = adminPersonaOverride ?? derivedPersona;

  useEffect(() => {
    if (!isAdmin && adminPortalView !== 'default') {
      setAdminPortalView('default');
    }
  }, [isAdmin, adminPortalView]);

  const fallingStickers = useMemo(
    () =>
      Array.from({ length: 22 }).map((_, idx) => ({
        id: idx,
        emoji: STICKER_EMOJIS[idx % STICKER_EMOJIS.length],
        color: STICKER_COLORS[idx % STICKER_COLORS.length],
        left: Math.random() * 100,
        duration: 10 + Math.random() * 10,
        delay: Math.random() * -15,
        scale: 0.7 + Math.random() * 0.8
      })),
    []
  );

  useEffect(() => {
    const bootstrapSdk = async () => {
      try {
        const insideMiniApp = await sdk.isInMiniApp();
        setIsMiniApp(insideMiniApp);

        if (!insideMiniApp) {
          setError('Open this mini app inside Warpcast to connect your FID.');
          setIsLoading(false);
          return;
        }

        await sdk.actions.ready();
        setIsSdkReady(true);
        setIsLoading(false);

        const context = await sdk.context;
        if (context.user) {
          setViewerContext({
            fid: context.user.fid,
            username: context.user.username,
            displayName: context.user.displayName
          });

          try {
            await syncAddresses(context.user.fid);
          } catch (addressError) {
            console.error('Failed to prefetch addresses', addressError);
          }
        }
      } catch (err) {
        console.error('Failed to call sdk.actions.ready()', err);
        setError('Unable to connect to the Farcaster SDK bridge. Reload to try again.');
      }
    };

    void bootstrapSdk();
  }, []);

  useEffect(() => {
    if (effectivePersona !== 'lp_gate') {
      setLpGateState({
        lpStatus: 'DISCONNECTED',
        walletAddress: miniWalletAddress ?? null,
        lpPositions: []
      });
      setIsLpLoungeOpen(false);
      return;
    }

    if (!miniWalletAddress) {
      setLpGateState({ lpStatus: 'DISCONNECTED', walletAddress: null, lpPositions: [] });
      return;
    }

    let cancelled = false;
    const walletAddress = miniWalletAddress;
    const runCheck = async () => {
      setLpGateState({ lpStatus: 'CHECKING', walletAddress, lpPositions: [] });

      try {
        const response = await fetch(`/api/lp-nft?address=${walletAddress}`);
        if (!response.ok) {
          throw new Error(`LP check failed: ${response.status}`);
        }
        const data = (await response.json()) as {
          hasLpNft: boolean;
          lpPositions: LpPosition[];
          error?: string;
        };
        if (cancelled) return;

        if (data.error) {
          setLpGateState({
            lpStatus: 'ERROR',
            walletAddress,
            lpPositions: []
          });
          return;
        }

        setLpGateState({
          lpStatus: data.hasLpNft ? 'HAS_LP' : 'NO_LP',
          walletAddress,
          lpPositions: data.lpPositions ?? []
        });
      } catch (err) {
        console.error('LP gate lookup failed', err);
        if (cancelled) return;
        setLpGateState({
          lpStatus: 'ERROR',
          walletAddress,
          lpPositions: []
        });
      }
    };

    void runCheck();

    return () => {
      cancelled = true;
    };
  }, [effectivePersona, miniWalletAddress, lpRefreshNonce]);

  useEffect(() => {
    const tick = () => {
      setTimeUntilClaimMs(Math.max(CLAIM_UNLOCK_TIMESTAMP_MS - Date.now(), 0));
    };

    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const syncAddresses = async (fid: number) => {
    const response = await fetch(`/api/addresses?fid=${fid}`);
    if (!response.ok) {
      throw new Error('Unable to sync verified addresses');
    }
    const data = (await response.json()) as { addresses: string[] };
    const fetchedAddresses = data.addresses ?? [];
    setAddresses(fetchedAddresses);
    setPrimaryAddress(fetchedAddresses[0] ?? null);
    return fetchedAddresses;
  };

  const handleSignIn = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setScanPhase('authenticating');

    let activeContext = viewerContext;

    try {
      const nonce =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`;
      await sdk.actions.signIn({ nonce });
      const context = await sdk.context;
      if (context.user) {
        activeContext = {
          fid: context.user.fid,
          username: context.user.username,
          displayName: context.user.displayName
        };
        setViewerContext(activeContext);
      }
    } catch (authErr) {
      console.warn('Sign in failed, falling back to cached context', authErr);
    }

    if (!activeContext) {
      setError('Failed to authenticate. Please try again.');
      setScanPhase('error');
      setIsLoading(false);
      return;
    }

    try {
      setScanPhase('addresses');
      const fetchedAddresses =
        addresses.length > 0 ? addresses : await syncAddresses(activeContext.fid);
      const derivedPrimaryAddress = fetchedAddresses[0];

      if (!derivedPrimaryAddress) {
        setError('No verified address available. Add a wallet in Warpcast and retry.');
        setScanPhase('error');
        return;
      }

      setDropAddress(null);
      let matchedAddress: string | null = null;
      let matchedResult: AirdropData | null = null;

      for (const addr of fetchedAddresses) {
        setScanPhase('fetching');
        try {
          const response = await fetch(`/api/airdrop?address=${addr}`);
          const result = (await response.json()) as AirdropData;
          if (result.eligible) {
            matchedAddress = addr;
            matchedResult = result;
            break;
          }
          if (!matchedResult) {
            matchedResult = result;
          }
        } catch (airdropErr) {
          console.error('Failed to fetch airdrop for address', addr, airdropErr);
        }
      }

      if (!matchedAddress) {
        matchedAddress = derivedPrimaryAddress;
      }

      setDropAddress(matchedAddress);
      setPrimaryAddress(derivedPrimaryAddress);

      setUserData({
        fid: activeContext.fid,
        username: activeContext.username,
        displayName: activeContext.displayName,
        verifiedAddresses: fetchedAddresses
      });

      if (matchedResult) {
        setAirdropData(matchedResult);
      }

      // Check if user has 0 points
      if (
        matchedResult &&
        (!matchedResult.eligible ||
          matchedResult.amount === '0' ||
          matchedResult.amount === undefined)
      ) {
        setHasZeroPoints(true);
        setScanPhase('ready');
        setIsLoading(false);
        return;
      }

      setScanPhase('fetching');
      try {
        const engagementResponse = await fetch(`/api/engagement?fid=${activeContext.fid}`);
        if (engagementResponse.ok) {
          const engagementResult = await engagementResponse.json();
          setEngagementData(engagementResult);

          if (
            matchedResult?.eligible &&
            engagementResult.isFollowing &&
            engagementResult.replyCount > 0
          ) {
            setShowLootReveal(true);
          }
        }
      } catch (engagementErr) {
        console.error('Failed to fetch engagement data', engagementErr);
      }

      setScanPhase('ready');
    } catch (err) {
      console.error('Failed to complete scan:', err);
      setError('Unable to complete the scan. Please try again.');
      setScanPhase('error');
    } finally {
      setIsLoading(false);
    }
  }, [addresses, viewerContext]);

  const handleCopyContract = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_ADDRESS);
      setCopiedContract(true);
      setTimeout(() => setCopiedContract(false), 2500);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleCopyWallet = async (address?: string | null) => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopiedWallet(true);
      setTimeout(() => setCopiedWallet(false), 2500);
    } catch (err) {
      console.error('Failed to copy wallet', err);
    }
  };

  const asHexAddress = (value: string): `0x${string}` =>
    (value.startsWith('0x') ? value : `0x${value}`) as `0x${string}`;

  const formatTokenAmount = (value?: bigint | null, decimals = 18, precision = 4) => {
    if (value === undefined || value === null) return '—';
    try {
      const asNumber = Number(formatUnits(value, decimals));
      if (Number.isFinite(asNumber)) {
        return asNumber.toLocaleString(undefined, { maximumFractionDigits: precision });
      }
      const formatted = formatUnits(value, decimals);
      return Number(formatted).toLocaleString(undefined, { maximumFractionDigits: precision });
    } catch {
      return formatUnits(value, decimals);
    }
  };

  const formatLpClaimErrorMessage = (code?: string) => {
    switch (code) {
      case 'lp_simulation_failed':
        return 'Simulation indicated this LP transaction would revert. Check your m00n balance/approval and try again.';
      case 'lp_claim_failed':
        return 'LP transaction failed to build. Please retry in a moment.';
      default:
        return code ?? 'lp_claim_failed';
    }
  };

  const handleMiniWalletAccountsChanged = useCallback((accounts?: readonly string[]) => {
    if (Array.isArray(accounts) && accounts.length > 0) {
      setMiniWalletAddress(accounts[0] ?? null);
    } else {
      setMiniWalletAddress(null);
    }
  }, []);

  const getMiniWalletProvider = useCallback(async () => {
    return (
      (await sdk.wallet.getEthereumProvider().catch(() => undefined)) ?? sdk.wallet.ethProvider
    );
  }, []);

  const sendCallsViaProvider = useCallback(
    async ({ calls }: { calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] }) => {
      const provider = await getMiniWalletProvider();
      if (!provider || typeof provider.request !== 'function' || !miniWalletAddress) {
        throw new Error('wallet_provider_unavailable');
      }

      const request = provider.request.bind(provider) as <T>(args: {
        method: string;
        params?: unknown[];
      }) => Promise<T>;

      for (const call of calls) {
        const tx = {
          from: miniWalletAddress,
          to: call.to,
          data: call.data,
          value:
            call.value && call.value > BigInt(0) ? `0x${call.value.toString(16)}` : ('0x0' as const)
        };
        // Sequentially send each transaction; Monad does not yet support wallet_sendCalls.
        await request({
          method: 'eth_sendTransaction',
          params: [tx]
        });
      }
    },
    [getMiniWalletProvider, miniWalletAddress]
  );

  const syncMiniWalletAddress = useCallback(async () => {
    try {
      const provider = await getMiniWalletProvider();
      if (!provider || typeof provider.request !== 'function') {
        setMiniWalletAddress(null);
        return null;
      }
      const accounts = (await provider.request({
        method: 'eth_accounts'
      })) as string[] | undefined;
      handleMiniWalletAccountsChanged(accounts);
      return accounts?.[0] ?? null;
    } catch (err) {
      console.warn('Failed to sync mini wallet address', err);
      setMiniWalletAddress(null);
      return null;
    }
  }, [getMiniWalletProvider, handleMiniWalletAccountsChanged]);

  useEffect(() => {
    void syncMiniWalletAddress();
  }, [syncMiniWalletAddress]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const attachListeners = async () => {
      const provider = await getMiniWalletProvider();
      if (!provider) return;

      const anyProvider = provider as typeof provider & {
        on?: (event: string, listener: (...args: unknown[]) => void) => void;
        off?: (event: string, listener: (...args: unknown[]) => void) => void;
        removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
      };

      if (typeof anyProvider.on === 'function') {
        const listener = (...args: unknown[]) => {
          const accounts = Array.isArray(args[0]) ? (args[0] as readonly string[]) : undefined;
          handleMiniWalletAccountsChanged(accounts);
        };
        anyProvider.on('accountsChanged', listener);
        cleanup = () => {
          if (typeof anyProvider.removeListener === 'function') {
            anyProvider.removeListener('accountsChanged', listener);
          } else if (typeof anyProvider.off === 'function') {
            anyProvider.off('accountsChanged', listener);
          }
        };
      }
    };

    void attachListeners();

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [getMiniWalletProvider, handleMiniWalletAccountsChanged]);

  const openExternalUrl = async (url: string) => {
    try {
      await sdk.actions.openUrl({ url });
    } catch (err) {
      console.warn('Failed to open external url via sdk', err);
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const handleOpenClaimSite = async () => {
    try {
      await sdk.actions.openMiniApp({ url: CLAIM_URL });
    } catch (err) {
      console.warn('openMiniApp failed, falling back to openUrl', err);
      if (typeof window !== 'undefined') {
        try {
          await sdk.actions.openUrl({ url: CLAIM_URL });
        } catch (fallbackErr) {
          console.warn('openUrl fallback failed, opening new tab', fallbackErr);
          window.open(CLAIM_URL, '_blank', 'noopener,noreferrer');
        }
      }
    }
  };

  const handleOpenLpSite = async () => {
    await openExternalUrl(LP_MINT_URL);
  };

  const handleOpenLpDocs = async () => {
    await openExternalUrl(LP_DOCS_URL);
  };

  const handleOpenHolderChat = async () => {
    await openExternalUrl(HOLDER_CHAT_URL);
  };

  const handleOpenHeavenMode = async () => {
    await openExternalUrl(HEAVEN_MODE_URL);
  };

  const handleRetryLpStatus = () => {
    setLpRefreshNonce((prev) => prev + 1);
  };

  const handleEnterLpLounge = () => {
    if (lpGateState.lpStatus === 'HAS_LP') {
      setIsLpLoungeOpen(true);
    }
  };

  const handleOpenLpClaimModal = () => {
    setLpClaimError(null);
    setIsLpClaimModalOpen(true);
    void syncMiniWalletAddress();
  };

  const handleCloseLpClaimModal = () => {
    if (isSubmittingLpClaim) return;
    setIsLpClaimModalOpen(false);
    setLpClaimAmount('');
    setLpClaimError(null);
  };

  const refreshFundingStatus = useCallback(async () => {
    if (!miniWalletAddress) {
      setWmonBalanceWei(null);
      setWmonAllowanceWei(null);
      setMoonBalanceWei(null);
      setMoonAllowanceWei(null);
      setFundingStatus('idle');
      return;
    }
    setFundingStatus('loading');
    try {
      const response = await fetch(`/api/lp-funding?address=${miniWalletAddress}`);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error ?? 'funding_lookup_failed');
      }
      const data = (await response.json()) as {
        wmonBalanceWei?: string;
        wmonAllowanceWei?: string;
        moonBalanceWei?: string;
        moonAllowanceWei?: string;
        wmonDecimals?: number;
        moonDecimals?: number;
      };
      setWmonBalanceWei(BigInt(data.wmonBalanceWei ?? '0'));
      setWmonAllowanceWei(BigInt(data.wmonAllowanceWei ?? '0'));
      setMoonBalanceWei(BigInt(data.moonBalanceWei ?? '0'));
      setMoonAllowanceWei(BigInt(data.moonAllowanceWei ?? '0'));
      setTokenDecimals({
        wmon:
          typeof data.wmonDecimals === 'number' && Number.isFinite(data.wmonDecimals)
            ? data.wmonDecimals
            : 18,
        moon:
          typeof data.moonDecimals === 'number' && Number.isFinite(data.moonDecimals)
            ? data.moonDecimals
            : 18
      });
      setFundingStatus('idle');
    } catch (err) {
      console.error('Failed to refresh funding status', err);
      setFundingStatus('error');
    }
  }, [miniWalletAddress]);

  useEffect(() => {
    if (!isLpClaimModalOpen || !miniWalletAddress) return;
    refreshFundingStatus();
  }, [isLpClaimModalOpen, miniWalletAddress, fundingRefreshNonce, refreshFundingStatus]);

  const handleSubmitLpClaim = async () => {
    if (!miniWalletAddress) {
      setLpClaimError('Connect your wallet to continue.');
      setLpDebugLog('❌ No wallet address; aborting LP claim.');
      return;
    }

    const sanitizedAmount = lpClaimAmount.trim();
    if (!sanitizedAmount) {
      setLpClaimError('Enter an amount to deposit.');
      setLpDebugLog('❌ Empty amount input.');
      return;
    }

    const amountWei = desiredAmountWei;
    if (!amountWei) {
      setLpClaimError('Invalid amount.');
      setLpDebugLog(`❌ Invalid amount after parsing: "${lpClaimAmount}".`);
      return;
    }

    if (wmonBalanceWei === null || moonBalanceWei === null) {
      setLpClaimError('Still checking wallet balances. Please retry.');
      setLpDebugLog('⏳ Balances not ready yet (WMON or m00n is null).');
      return;
    }

    // Up-front check: user must at least have enough WMON for their desired input
    if (wmonBalanceWei < amountWei) {
      setLpClaimError('Not enough WMON balance for this deposit.');
      setLpDebugLog(
        `❌ WMON balance too low for input.\n` +
          `  desiredInputWmonWei=${amountWei.toString()}\n` +
          `  walletWmonWei=${wmonBalanceWei.toString()}`
      );
      return;
    }

    setIsSubmittingLpClaim(true);
    setLpClaimError(null);
    setLpDebugLog(
      [
        '🚀 Starting LP claim ritual…',
        `  input (WMON): ${sanitizedAmount} (${amountWei.toString()} wei)`,
        `  wallet WMON: ${wmonBalanceWei.toString()} wei`,
        `  wallet m00n: ${moonBalanceWei.toString()} wei`
      ].join('\n')
    );

    try {
      const response = await fetch('/api/lp-claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: miniWalletAddress,
          amount: sanitizedAmount,
          preset: 'backstop'
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const code = errorBody?.error ?? 'lp_claim_failed';
        setLpDebugLog((prev) =>
          [
            prev,
            '',
            '❌ /api/lp-claim returned non-OK status.',
            `  status=${response.status}`,
            `  errorCode=${code}`
          ]
            .filter(Boolean)
            .join('\n')
        );
        throw new Error(code);
      }

      const payload = (await response.json()) as {
        to: string;
        data: string;
        value?: string;
        requiredMoonWei?: string;
        requiredWmonWei?: string;
      };

      const requiredMoonWei = BigInt(payload.requiredMoonWei ?? '0');
      const requiredWmonWei = BigInt(payload.requiredWmonWei ?? '0');

      setLpDebugLog((prev) =>
        [
          prev,
          '',
          '✅ Built LP position payload from backend.',
          `  requiredWmonWei=${requiredWmonWei.toString()}`,
          `  requiredMoonWei=${requiredMoonWei.toString()}`,
          `  walletWmonWei=${wmonBalanceWei.toString()}`,
          `  walletMoonWei=${moonBalanceWei.toString()}`
        ]
          .filter(Boolean)
          .join('\n')
      );

      if (moonBalanceWei < requiredMoonWei) {
        setLpClaimError('Not enough m00n for this LP band. Swap MON → m00n first.');
        setLpDebugLog((prev) =>
          [
            prev,
            '❌ Not enough m00n for required amount.',
            `  requiredMoonWei=${requiredMoonWei.toString()}`,
            `  walletMoonWei=${moonBalanceWei.toString()}`
          ].join('\n')
        );
        return;
      }
      if (wmonBalanceWei < requiredWmonWei) {
        setLpClaimError('Not enough WMON for this LP band.');
        setLpDebugLog((prev) =>
          [
            prev,
            '❌ Not enough WMON for required amount.',
            `  requiredWmonWei=${requiredWmonWei.toString()}`,
            `  walletWmonWei=${wmonBalanceWei.toString()}`
          ].join('\n')
        );
        return;
      }

      const needsWmonApproval = wmonAllowanceWei === null || wmonAllowanceWei < requiredWmonWei;
      const needsMoonApproval = moonAllowanceWei === null || moonAllowanceWei < requiredMoonWei;

      if (needsWmonApproval || needsMoonApproval) {
        const message =
          'Token approvals are missing for this LP band. Approve WMON and m00n in the modal, then retry the claim.';
        setLpClaimError(message);
        setLpDebugLog((prev) =>
          [
            prev,
            '',
            '❌ Cannot mint: insufficient token approvals.',
            needsWmonApproval ? '  - WMON approval missing or too low.' : '',
            needsMoonApproval ? '  - m00n approval missing or too low.' : ''
          ]
            .filter(Boolean)
            .join('\n')
        );
        return;
      }

      const rawValue = (payload.value ?? '').trim();
      const callValue =
        rawValue && rawValue !== '0' && rawValue !== '0x0' ? BigInt(rawValue) : BigInt(0);

      setLpDebugLog((prev) =>
        [
          prev,
          '🧪 Sending LP mint transaction from mini wallet…',
          callValue > BigInt(0) ? `  with attached value = ${callValue.toString()} wei` : ''
        ]
          .filter(Boolean)
          .join('\n')
      );

      await sendCallsViaProvider({
        calls: [
          {
            to: asHexAddress(payload.to),
            data: payload.data as `0x${string}`,
            value: callValue > BigInt(0) ? callValue : undefined
          }
        ]
      });

      setIsLpClaimModalOpen(false);
      setLpClaimAmount('');
      setLpClaimError(null);
      setLpDebugLog((prev) => `${prev}\n✅ LP claim batch sent to wallet successfully.`);
      setTimeout(() => {
        setLpRefreshNonce((prev) => prev + 1);
        setIsLpLoungeOpen(true);
      }, 2000);
      setFundingRefreshNonce((prev) => prev + 1);
    } catch (err) {
      console.error('LP claim failed', err);
      const errorCode = err instanceof Error ? err.message : 'lp_claim_failed';
      setLpClaimError(formatLpClaimErrorMessage(errorCode));
      setLpDebugLog((prev) =>
        [prev, '', '💥 LP claim threw in frontend handler.', `  errorCode=${errorCode}`]
          .filter(Boolean)
          .join('\n')
      );
    } finally {
      setIsSubmittingLpClaim(false);
    }
  };

  const handleApproveMoon = async () => {
    if (!miniWalletAddress) {
      setLpClaimError('Connect your wallet to continue.');
      return;
    }
    const decimals = Number.isFinite(tokenDecimals.moon) ? tokenDecimals.moon : 18;
    const fallbackAmount = parseUnits('10', decimals);
    const amountToApprove =
      desiredAmountWei && desiredAmountWei > BigInt(0) ? desiredAmountWei : fallbackAmount;

    setIsApprovingMoon(true);
    setLpClaimError(null);
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const permitExpiration = nowSec + 60 * 60 * 24 * 30; // ~30 days

      const approveUnderlyingData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [asHexAddress(PERMIT2_ADDRESS), amountToApprove]
      });

      const permitData = encodeFunctionData({
        abi: permit2Abi,
        functionName: 'approve',
        args: [
          asHexAddress(TOKEN_ADDRESS),
          asHexAddress(POSITION_MANAGER_ADDRESS),
          amountToApprove,
          permitExpiration
        ]
      });

      await sendCallsViaProvider({
        calls: [
          {
            to: asHexAddress(TOKEN_ADDRESS),
            data: approveUnderlyingData,
            value: BigInt(0)
          },
          {
            to: asHexAddress(PERMIT2_ADDRESS),
            data: permitData,
            value: BigInt(0)
          }
        ]
      });

      setFundingRefreshNonce((prev) => prev + 1);
      setLpDebugLog((prev) =>
        [
          prev,
          `✅ Approved m00n via Permit2 for ${amountToApprove.toString()} wei (PositionManager).`
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (err) {
      console.error('Approve m00n failed', err);
      setLpClaimError(err instanceof Error ? err.message : 'approve_failed');
    } finally {
      setIsApprovingMoon(false);
    }
  };

  const handleSwapMonToToken = async (target: 'wmon' | 'moon') => {
    setSwapInFlight(target);
    try {
      await sdk.actions.swapToken({
        sellToken: MON_NATIVE_CAIP,
        buyToken: target === 'wmon' ? WMON_CAIP : MOON_CAIP
      });
      if (target === 'wmon' || target === 'moon') {
        setFundingRefreshNonce((prev) => prev + 1);
      }
    } catch (err) {
      console.error('swapToken failed', err);
    } finally {
      setSwapInFlight((current) => (current === target ? null : current));
    }
  };

  const handleViewToken = async (token: 'wmon' | 'moon') => {
    try {
      await sdk.actions.viewToken({
        token: token === 'wmon' ? WMON_CAIP : MOON_CAIP
      });
    } catch (err) {
      console.error('viewToken failed', err);
    }
  };

  const personaActionHandlers: Record<PersonaActionId, (() => void) | undefined> = {
    lp_connect_wallet: handleSignIn,
    lp_become_lp: handleOpenLpClaimModal,
    lp_open_docs: handleOpenLpDocs,
    lp_try_again: handleRetryLpStatus,
    lp_enter_lounge: handleEnterLpLounge,
    lp_manage: handleOpenLpSite,
    open_claim: handleOpenClaimSite,
    open_chat: handleOpenHolderChat,
    open_heaven_mode: handleOpenHeavenMode,
    learn_more: handleOpenLpDocs
  };

  const renderCopyBody = (lines: string[]) => (
    <div className="space-y-2 text-sm opacity-80">
      {lines.map((line, idx) => (
        <p key={`${line}-${idx}`}>{line}</p>
      ))}
    </div>
  );

  const renderPersonaCtas = (
    copy: ReturnType<typeof getPersonaCopy>,
    options?: { disablePrimary?: boolean; disableSecondary?: boolean }
  ) => {
    if (!copy.primaryCta && !copy.secondaryCta) {
      return null;
    }

    const primaryHandler = copy.primaryCta
      ? personaActionHandlers[copy.primaryCta.actionId]
      : undefined;
    const secondaryHandler = copy.secondaryCta
      ? personaActionHandlers[copy.secondaryCta.actionId]
      : undefined;

    return (
      <div className="flex flex-col sm:flex-row sm:justify-center gap-3">
        {copy.primaryCta && (
          <button
            onClick={primaryHandler}
            disabled={!primaryHandler || options?.disablePrimary}
            type="button"
            className="pixel-font px-6 py-3 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-40"
          >
            {copy.primaryCta.label}
          </button>
        )}
        {copy.secondaryCta && (
          <button
            onClick={secondaryHandler}
            disabled={!secondaryHandler || options?.disableSecondary}
            type="button"
            className="pixel-font px-6 py-3 border border-[var(--monad-purple)] text-[var(--monad-purple)] rounded-lg hover:bg-[var(--monad-purple)] hover:text-white transition-colors disabled:opacity-40"
          >
            {copy.secondaryCta.label}
          </button>
        )}
      </div>
    );
  };

  const desiredAmountWei = useMemo(() => {
    const sanitized = lpClaimAmount.trim();
    if (!sanitized) return null;
    try {
      // Treat modal input as WMON (token1) amount
      return parseUnits(sanitized, tokenDecimals.wmon ?? 18);
    } catch {
      return null;
    }
  }, [lpClaimAmount, tokenDecimals.wmon]);

  const renderLpClaimModal = () => {
    const walletReady = Boolean(miniWalletAddress);
    const hasFundingSnapshot =
      wmonBalanceWei !== null &&
      wmonAllowanceWei !== null &&
      moonBalanceWei !== null &&
      moonAllowanceWei !== null &&
      fundingStatus !== 'loading';
    const tokenInfoPending = walletReady && !hasFundingSnapshot;
    const hasAmountInput = Boolean(lpClaimAmount.trim());
    const hasSufficientWmonInputBalance =
      walletReady &&
      desiredAmountWei !== null &&
      wmonBalanceWei !== null &&
      wmonBalanceWei >= desiredAmountWei;
    const hasSufficientMoonAllowance =
      walletReady && moonAllowanceWei !== null && moonAllowanceWei > BigInt(0);
    const hasSomeWmon = walletReady && wmonBalanceWei !== null && wmonBalanceWei > BigInt(0);
    const hasWmonAllowance =
      walletReady && wmonAllowanceWei !== null && wmonAllowanceWei > BigInt(0);
    const fundingWarning = !walletReady
      ? 'Connect your Warpcast wallet to fund the LP ritual.'
      : !hasAmountInput
        ? 'Enter an amount denominated in WMON.'
        : tokenInfoPending
          ? 'Checking wallet balances…'
          : fundingStatus === 'error'
            ? 'Failed to load wallet balances. Tap refresh or VIEW token.'
            : desiredAmountWei === null
              ? 'Amount is invalid.'
              : !hasSomeWmon
                ? 'You also need some WMON in your Warp wallet for this LP band.'
                : !hasSufficientWmonInputBalance
                  ? 'Not enough WMON for this deposit.'
                  : !hasWmonAllowance
                    ? 'Approve WMON for the position manager before minting.'
                    : !hasSufficientMoonAllowance
                      ? 'Approve m00n for the position manager before minting.'
                      : null;

    const primaryLabel = walletReady
      ? isSubmittingLpClaim
        ? 'CLAIMING…'
        : 'CLAIM LP'
      : 'CONNECT WALLET';
    const approvalDecimals = Number.isFinite(tokenDecimals.moon) ? tokenDecimals.moon : 18;
    const approvalFallbackWei = parseUnits('10', approvalDecimals);
    const approvalAmountWei =
      desiredAmountWei && desiredAmountWei > BigInt(0) ? desiredAmountWei : approvalFallbackWei;
    const approvalAmountDisplay = formatTokenAmount(approvalAmountWei, approvalDecimals, 6);

    const primaryHandler = walletReady ? handleSubmitLpClaim : handleSignIn;
    const primaryDisabled =
      (!walletReady && isSubmittingLpClaim) ||
      isSubmittingLpClaim ||
      !hasAmountInput ||
      Boolean(fundingWarning && walletReady) ||
      tokenInfoPending;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={() => {
            if (!isSubmittingLpClaim) {
              handleCloseLpClaimModal();
            }
          }}
        />
        <div className="relative w-full max-w-md space-y-5 rounded-3xl border border-[var(--monad-purple)] bg-black/80 p-6 text-left shadow-2xl">
          <div className="flex items-center justify-between">
            <h2 className="pixel-font text-xl text-white">Claim LP Backstop</h2>
            <button
              onClick={handleCloseLpClaimModal}
              className="text-sm text-white/60 hover:text-white transition-colors"
              disabled={isSubmittingLpClaim}
              type="button"
            >
              CLOSE
            </button>
          </div>
          <p className="text-sm opacity-80">
            Deploy liquidity into the fixed crash-backstop band (-106600 → -104600) on the m00n /
            W-MON pool. Input is denominated in WMON; required m00n is computed from the pool price.
          </p>
          {!walletReady && (
            <div className="rounded-lg border border-yellow-400/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
              Connect your Warpcast wallet to enter the LP ritual.
            </div>
          )}
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="opacity-70">WMON Balance</span>
              <span className="font-mono text-xs">
                {tokenInfoPending
                  ? '—'
                  : `${formatTokenAmount(wmonBalanceWei, tokenDecimals.wmon)} WMON`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="opacity-70">m00n Balance</span>
              <span className="font-mono text-xs">
                {tokenInfoPending
                  ? '—'
                  : `${formatTokenAmount(moonBalanceWei, tokenDecimals.moon)} m00n`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="opacity-70">m00n Allowance → LP</span>
              <span className="font-mono text-xs">
                {tokenInfoPending
                  ? '—'
                  : `${formatTokenAmount(moonAllowanceWei, tokenDecimals.moon)} m00n`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setFundingRefreshNonce((prev) => prev + 1)}
                disabled={!walletReady || fundingStatus === 'loading'}
                className="pixel-font text-[10px] px-3 py-1 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-colors disabled:opacity-40"
              >
                {fundingStatus === 'loading' ? 'REFRESHING…' : 'REFRESH'}
              </button>
              {fundingStatus === 'error' && (
                <span className="text-xs text-red-300">Failed to load wallet data.</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleViewToken('wmon')}
                className="pixel-font text-[10px] px-3 py-1 border border-white/20 rounded hover:bg-white/10 transition-colors"
              >
                VIEW WMON
              </button>
              <button
                type="button"
                onClick={() => handleViewToken('moon')}
                className="pixel-font text-[10px] px-3 py-1 border border-white/10 rounded hover:bg-white/10 transition-colors"
              >
                VIEW m00n
              </button>
            </div>
          </div>
          {walletReady && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={async () => {
                  if (!miniWalletAddress) return;
                  if (!wmonBalanceWei || wmonBalanceWei <= BigInt(0)) {
                    setLpClaimError('You need some WMON in your Warp wallet before approving it.');
                    return;
                  }
                  setLpClaimError(null);
                  try {
                    const amountToApprove = wmonBalanceWei;
                    const nowSec = Math.floor(Date.now() / 1000);
                    const permitExpiration = nowSec + 60 * 60 * 24 * 30; // ~30 days

                    const approveUnderlyingData = encodeFunctionData({
                      abi: erc20Abi,
                      functionName: 'approve',
                      args: [asHexAddress(PERMIT2_ADDRESS), amountToApprove]
                    });

                    const permitData = encodeFunctionData({
                      abi: permit2Abi,
                      functionName: 'approve',
                      args: [
                        asHexAddress(WMON_ADDRESS),
                        asHexAddress(POSITION_MANAGER_ADDRESS),
                        amountToApprove,
                        permitExpiration
                      ]
                    });

                    await sendCallsViaProvider({
                      calls: [
                        {
                          to: asHexAddress(WMON_ADDRESS),
                          data: approveUnderlyingData,
                          value: BigInt(0)
                        },
                        {
                          to: asHexAddress(PERMIT2_ADDRESS),
                          data: permitData,
                          value: BigInt(0)
                        }
                      ]
                    });

                    setFundingRefreshNonce((prev) => prev + 1);
                    setLpDebugLog((prev) =>
                      [
                        prev,
                        `✅ Approved WMON via Permit2 for ${amountToApprove.toString()} wei (PositionManager).`
                      ]
                        .filter(Boolean)
                        .join('\n')
                    );
                  } catch (err) {
                    console.error('Approve WMON failed', err);
                    setLpClaimError(err instanceof Error ? err.message : 'approve_wmon_failed');
                  }
                }}
                disabled={!walletReady || tokenInfoPending}
                className="w-full rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                APPROVE WMON BALANCE
              </button>
              <button
                type="button"
                onClick={handleApproveMoon}
                disabled={
                  isApprovingMoon ||
                  !miniWalletAddress ||
                  tokenInfoPending ||
                  (hasSufficientMoonAllowance && fundingStatus !== 'error')
                }
                className="w-full rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                {isApprovingMoon ? 'APPROVING…' : `APPROVE ${approvalAmountDisplay} m00n`}
              </button>
              {!hasSufficientMoonAllowance && walletReady && (
                <p className="text-xs text-red-300">
                  Approval lets the position manager pull your m00n just once.
                </p>
              )}
              {walletReady && (
                <p className="text-xs text-white/60">
                  Wallet prompt will approve up to {approvalAmountDisplay} m00n (falls back to 10 if
                  no amount is entered).
                </p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.4em] text-[var(--moss-green)]">
              Amount (WMON)
            </label>
            <input
              type="number"
              min="0"
              step="0.0001"
              value={lpClaimAmount}
              onChange={(event) => setLpClaimAmount(event.target.value)}
              placeholder="1.0"
              className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 font-mono text-sm text-white focus:border-[var(--monad-purple)] focus:outline-none disabled:opacity-40"
              disabled={!walletReady || isSubmittingLpClaim}
            />
          </div>
          {fundingWarning && (
            <div className="rounded-lg border border-red-400/50 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {fundingWarning}
            </div>
          )}
          {lpClaimError && (
            <div className="rounded-lg border border-red-400/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {lpClaimError}
            </div>
          )}
          {lpDebugLog && (
            <div className="space-y-1 rounded-xl border border-white/10 bg-black/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">
                  LP DEBUG TRACE
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(lpDebugLog);
                      } catch {
                        // ignore clipboard failures; this is purely a debug helper
                      }
                    }}
                    className="text-[10px] text-white/40 hover:text-white/80 transition-colors"
                  >
                    COPY
                  </button>
                  <button
                    type="button"
                    onClick={() => setLpDebugLog('')}
                    className="text-[10px] text-white/40 hover:text-white/80 transition-colors"
                  >
                    CLEAR
                  </button>
                </div>
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-white/70">
                {lpDebugLog}
              </pre>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={primaryHandler}
              disabled={primaryDisabled}
              type="button"
              className="flex-1 rounded-xl bg-[var(--monad-purple)] px-4 py-3 text-sm font-semibold text-white transition-all disabled:opacity-40"
            >
              {primaryLabel}
            </button>
            <button
              onClick={handleCloseLpClaimModal}
              disabled={isSubmittingLpClaim}
              type="button"
              className="flex-1 rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/5 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--moss-green)]">
              NEED MATERIALS?
            </p>
            <p className="text-xs opacity-70">
              Use the Warpcast swapper to convert native MON into m00n (or WMON if you&apos;re
              balancing elsewhere) before joining the cabal. Swaps open in-place and you can adjust
              the details there.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => handleSwapMonToToken('wmon')}
                disabled={swapInFlight === 'wmon'}
                className="flex-1 rounded-xl border border-[var(--monad-purple)] px-4 py-3 text-sm font-semibold text-[var(--monad-purple)] hover:bg-[var(--monad-purple)] hover:text-white transition-colors disabled:opacity-40"
              >
                {swapInFlight === 'wmon' ? 'OPENING…' : 'Swap MON → WMON'}
              </button>
              <button
                type="button"
                onClick={() => handleSwapMonToToken('moon')}
                disabled={swapInFlight === 'moon'}
                className="flex-1 rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                {swapInFlight === 'moon' ? 'OPENING…' : 'Swap MON → m00n'}
              </button>
            </div>
          </div>
          <p className="text-xs opacity-60">
            Transaction executes via the Farcaster mini wallet. Unlocks the LP lounge once
            confirmed.
          </p>
        </div>
      </div>
    );
  };

  const repliesCount = airdropData?.replyCount ?? engagementData?.replyCount ?? 0;
  const tier = repliesCount ? getTierByReplyCount(repliesCount) : null;
  const replyGlow = useMemo(() => getReplyGlowConfig(repliesCount), [repliesCount]);
  const claimCountdown = useMemo(() => {
    const totalSeconds = Math.max(Math.floor(timeUntilClaimMs / 1000), 0);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
      totalSeconds,
      days,
      hours,
      minutes,
      seconds
    };
  }, [timeUntilClaimMs]);
  const countdownUnits = useMemo(
    () => [
      { label: 'DAYS', value: claimCountdown.days },
      { label: 'HOURS', value: claimCountdown.hours },
      { label: 'MINS', value: claimCountdown.minutes },
      { label: 'SECS', value: claimCountdown.seconds }
    ],
    [claimCountdown.days, claimCountdown.hours, claimCountdown.minutes, claimCountdown.seconds]
  );
  const formatCountdownValue = (value: number) => value.toString().padStart(2, '0');

  const handleShare = async () => {
    if (!airdropData?.eligible || !airdropData.amount || !userData) return;

    const baseText = `I'm part of the m00n cabal! Receiving ${formatAmount(
      airdropData.amount
    )} $m00n tokens 🌙✨`;
    const finalText = `${baseText}\n\n${SHARE_URL}`;

    await sdk.actions.composeCast({
      text: finalText,
      embeds: [SHARE_URL]
    });
  };

  const PANEL_CLASS =
    'bg-black/45 border border-[var(--monad-purple)] rounded-2xl px-8 py-6 backdrop-blur';

  const renderSessionCard = (fid?: number, wallet?: string | null, extraClass = '') => (
    <div
      className={`grid grid-cols-1 md:grid-cols-2 gap-8 text-sm ${PANEL_CLASS} ${extraClass} [&>div]:space-y-2`}
    >
      <div>
        <p className="uppercase text-[var(--moss-green)] text-[11px] tracking-[0.4em]">
          Connected FID
        </p>
        <p className="font-mono text-lg leading-tight">{fid ?? '—'}</p>
      </div>
      <div>
        <p className="uppercase text-[var(--moss-green)] text-[11px] tracking-[0.4em]">Wallet</p>
        <div className="flex items-center gap-3 font-mono text-lg leading-tight">
          <span className="break-all">
            {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '—'}
          </span>
          {wallet && (
            <button
              onClick={() => handleCopyWallet(wallet)}
              className="pixel-font text-[10px] px-3 py-1 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-colors"
            >
              {copiedWallet ? 'COPIED' : 'COPY'}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const renderLpGatePanel = () => {
    const { lpStatus, walletAddress, lpPositions } = lpGateState;
    const truncatedWallet = truncateAddress(walletAddress);
    const positionCount = lpPositions?.length ?? 0;
    const copy = getPersonaCopy({
      persona: 'lp_gate',
      lpState: { status: lpStatus, positionCount }
    });
    const showLoader = lpStatus === 'CHECKING';
    const previewPositions = (lpPositions ?? []).slice(0, 2);

    const positionsPreview =
      lpStatus === 'HAS_LP' && positionCount > 0 ? (
        <div className={`${PANEL_CLASS} text-left space-y-2`}>
          <p className="uppercase text-[var(--moss-green)] text-[11px] tracking-[0.4em]">
            LP SIGILS
          </p>
          {previewPositions.map((position) => (
            <div key={position.tokenId} className="text-sm opacity-85">
              <p>Token #{position.tokenId}</p>
              <p className="text-xs opacity-70">
                Tick band: {position.tickLower} → {position.tickUpper}
              </p>
            </div>
          ))}
          {positionCount > 2 && (
            <p className="text-xs opacity-60">+{positionCount - 2} more sigils detected.</p>
          )}
        </div>
      ) : null;

    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
        <div className="max-w-2xl w-full space-y-6 text-center scanline bg-black/45 border border-[var(--monad-purple)] rounded-3xl px-8 py-10">
          <div className="flex justify-center">
            <NeonHaloLogo size={140} />
          </div>
          <h1 className="pixel-font text-2xl glow-purple">{copy.title}</h1>
          {renderCopyBody(copy.body)}
          {truncatedWallet && lpStatus === 'HAS_LP' && (
            <p className="text-xs opacity-60">Wallet: {truncatedWallet}</p>
          )}
          {showLoader && (
            <div className="flex justify-center">
              <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-[var(--monad-purple)] animate-pulse" />
              </div>
            </div>
          )}
          {renderPersonaCtas(copy, { disablePrimary: lpStatus === 'CHECKING' })}
          {positionsPreview}
          <div className="text-xs opacity-60">
            Need help?{' '}
            <button onClick={handleOpenLpDocs} className="underline hover:text-white transition">
              Read the LP primer
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderLpLoungePanel = () => {
    const positionCount = lpGateState.lpPositions?.length ?? 0;
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-4xl w-full space-y-8 scanline bg-black/50 border border-[var(--monad-purple)] rounded-3xl px-10 py-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <NeonHaloLogo size={150} />
            <div className="text-right">
              <p className="pixel-font text-sm tracking-[0.5em] text-[var(--moss-green)]">
                LP LOUNGE
              </p>
              <p className="text-xs opacity-70">
                {positionCount} active {positionCount === 1 ? 'sigil' : 'sigils'}
              </p>
            </div>
          </div>

          <div className={`${PANEL_CLASS} space-y-3 text-left`}>
            <p className="text-lg font-semibold">Recommended band</p>
            <p className="text-sm opacity-80">
              We park your LP around spot so you earn fees without thinking about ticks.
            </p>
            <button
              onClick={handleOpenLpSite}
              className="pixel-font px-6 py-3 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-colors"
            >
              Use recommended band
            </button>
            <p className="text-xs opacity-60">
              Starts mixed m00nad / MON, automatically rebalances as price moves.
            </p>
          </div>

          <div className={`${PANEL_CLASS} space-y-3 text-left`}>
            <p className="text-lg font-semibold">Custom band</p>
            <p className="text-sm opacity-80">
              Choose your own range if you want a buy wall, sell wall, or wide basin.
            </p>
            <button
              onClick={handleOpenLpSite}
              className="pixel-font px-6 py-3 border border-[var(--monad-purple)] text-[var(--monad-purple)] rounded-lg hover:bg-[var(--monad-purple)] hover:text-white transition-colors"
            >
              Tune my own LP band
            </button>
            <p className="text-xs opacity-60">
              Closer to spot = more fee action; deeper bands wait for dramatic moves.
            </p>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setIsLpLoungeOpen(false)}
              className="pixel-font text-xs px-4 py-2 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-colors"
            >
              Back to gate
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderClaimedSoldPortal = () => {
    const copy = getPersonaCopy({ persona: 'claimed_sold' });
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-2xl w-full text-center space-y-6 scanline bg-black/55 border border-red-600 rounded-3xl px-8 py-12">
          <div className="flex justify-center">
            <NeonHaloLogo size={140} />
          </div>
          <h1 className="pixel-font text-3xl text-red-500">{copy.title}</h1>
          {renderCopyBody(copy.body)}
          {renderPersonaCtas(copy)}
        </div>
      </div>
    );
  };

  const renderClaimedHeldPortal = () => {
    const copy = getPersonaCopy({ persona: 'claimed_held' });
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-3xl w-full space-y-6 scanline bg-black/45 border border-[var(--monad-purple)] rounded-3xl px-8 py-10">
          <div className="flex items-center justify-between">
            <NeonHaloLogo size={130} />
            <div className="text-right">
              <p className="pixel-font text-xs tracking-[0.5em] text-[var(--moss-green)]">
                CABAL CHAT
              </p>
              <p className="text-xs opacity-70">Hold-mode group line</p>
            </div>
          </div>
          <div className="text-center space-y-3">{renderCopyBody(copy.body)}</div>
          {renderPersonaCtas(copy)}
          <div className="bg-black/50 border border-white/10 rounded-2xl p-4 space-y-3 text-left h-64 overflow-y-auto">
            <div>
              <p className="text-xs text-[var(--moss-green)]">oracle.m00n</p>
              <p className="text-sm opacity-85">
                Keep holding. Fees drip. The moonlight stays purple.
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--moss-green)]">clanker.herald</p>
              <p className="text-sm opacity-85">LP wall solid. Chat stays calm.</p>
            </div>
            <div>
              <p className="text-xs text-[var(--moss-green)]">you</p>
              <p className="text-sm opacity-85 italic">Typing…</p>
            </div>
          </div>
          <div className="flex gap-3">
            <input
              readOnly
              placeholder="Only holders can speak…"
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm opacity-60 cursor-not-allowed"
            />
            <button className="pixel-font px-4 py-2 bg-[var(--monad-purple)] text-white rounded-lg opacity-40 cursor-not-allowed">
              SEND
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderClaimedBoughtMorePortal = () => {
    const copy = getPersonaCopy({ persona: 'claimed_bought_more' });
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-3xl w-full space-y-6 text-center scanline bg-black/45 border border-white/20 rounded-3xl px-8 py-10">
          <div className="flex justify-center">
            <div className="w-48 h-48 rounded-full bg-gradient-to-br from-purple-200 via-pink-200 to-white blur-2xl opacity-70" />
          </div>
          <h1 className="pixel-font text-3xl text-white">{copy.title}</h1>
          {renderCopyBody(copy.body)}
          {renderPersonaCtas(copy)}
        </div>
      </div>
    );
  };

  const renderEligibleHolderPanel = () => {
    if (!airdropData || !userData) {
      return renderLockedOutPanel();
    }
    const copy = getPersonaCopy({ persona: 'eligible_holder' });
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-3xl w-full space-y-8 scanline p-10 bg-black/50 rounded-lg border-2 border-[var(--monad-purple)]">
          <div className="flex justify-center mb-2">
            <NeonHaloLogo size={150} />
          </div>
          <h1 className="pixel-font text-2xl text-center glow-purple">{copy.title}</h1>
          {renderCopyBody(copy.body)}
          {renderPersonaCtas(copy)}

          <div className="text-center space-y-4">
            <p className="text-3xl font-bold glow-green">
              {formatAmount(airdropData.amount!)} $m00n
            </p>
            <p className="text-lg">
              {userData.displayName ? `${userData.displayName} ` : ''}
              {userData.username ? `@${userData.username}` : `FID: ${userData.fid}`}
            </p>
          </div>

          <div className={`${PANEL_CLASS} text-center`}>
            <p className="pixel-font text-[11px] uppercase tracking-[0.5em] text-[var(--moss-green)] mb-4">
              {claimCountdown.totalSeconds > 0 ? 'Claim unlocks in' : 'Claim window active'}
            </p>
            {claimCountdown.totalSeconds > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {countdownUnits.map((unit) => (
                  <div
                    key={unit.label}
                    className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-black/30 py-3"
                  >
                    <span className="text-3xl font-mono glow-green">
                      {formatCountdownValue(unit.value)}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.4em] text-[var(--moss-green)]">
                      {unit.label}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--moss-green)]">
                Claim window is live — head to the portal to execute.
              </p>
            )}
          </div>

          <div className="flex justify-center mb-6">
            <div
              className="pixel-font text-[11px] uppercase tracking-[0.5em] px-8 py-3 rounded-full"
              style={{
                border: `2px solid ${replyGlow.color}`,
                color: replyGlow.color,
                boxShadow: `0 0 22px ${replyGlow.shadow}`,
                background: 'rgba(0, 0, 0, 0.45)'
              }}
            >
              {repliesCount} replies logged
            </div>
          </div>

          <div className="mb-2">{renderSessionCard(userData?.fid, primaryAddress)}</div>
          {dropAddress && dropAddress !== primaryAddress && (
            <p className="text-xs opacity-70">
              Allocation detected on{' '}
              <span className="font-mono">{`${dropAddress.slice(0, 6)}…${dropAddress.slice(-4)}`}</span>
              .
            </p>
          )}

          {tier && engagementData?.isFollowing && (
            <div
              className={`mt-8 p-8 bg-purple-900/30 rounded-lg border ${
                showLootReveal ? 'crt-flicker' : ''
              }`}
              style={{
                borderColor: replyGlow.color,
                boxShadow: `0 0 28px ${replyGlow.shadow}`
              }}
            >
              <h3 className="pixel-font text-lg mb-3" style={{ color: replyGlow.color }}>
                {tier.icon} {tier.title}
              </h3>
              <p className="text-sm mb-4 italic">{tier.flavorText}</p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Tier: {tier.name}</span>
                  <span>Replies: {repliesCount}</span>
                </div>
                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--monad-purple)] to-[var(--moss-green)] transition-all duration-1000"
                    style={{ width: `${tier.progressPercentage}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-center mt-8">
            <button
              onClick={handleShare}
              className="pixel-font px-6 py-2 bg-[var(--monad-purple)] text-white rounded hover:bg-opacity-90 transition-all"
            >
              SHARE CAST
            </button>
          </div>

          {renderContractCard()}
        </div>
      </div>
    );
  };

  const renderLockedOutPanel = () => {
    const copy = getPersonaCopy({ persona: 'locked_out' });
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
        <div className="max-w-2xl w-full text-center space-y-6 scanline shake">
          <div className="flex justify-center">
            <NeonHaloLogo size={160} />
          </div>

          <h1 className="pixel-font text-2xl text-red-400">{copy.title}</h1>
          {renderCopyBody(copy.body)}
          {renderPersonaCtas(copy)}

          {userData && (
            <div className="text-sm text-left bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-6 space-y-3">
              <p className="uppercase text-[var(--moss-green)] text-xs tracking-widest">Session</p>
              <p>FID: {userData.fid}</p>
              <div className="flex items-center gap-3 font-mono text-base">
                <span>
                  Wallet:{' '}
                  {primaryAddress
                    ? `${primaryAddress.slice(0, 6)}…${primaryAddress.slice(-4)}`
                    : '—'}
                </span>
                {primaryAddress && (
                  <button
                    onClick={() => handleCopyWallet(primaryAddress)}
                    className="pixel-font text-[10px] px-3 py-1 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-colors"
                  >
                    {copiedWallet ? 'COPIED' : 'COPY'}
                  </button>
                )}
              </div>
            </div>
          )}

          {dropAddress && dropAddress !== primaryAddress && (
            <p className="text-xs opacity-70">
              Drop checks were performed against{' '}
              <span className="font-mono">{`${dropAddress.slice(0, 6)}…${dropAddress.slice(-4)}`}</span>
              .
            </p>
          )}

          <div className="w-full">{renderContractCard()}</div>
        </div>
      </div>
    );
  };

  const StickerRain = () => (
    <div className="sticker-rain" aria-hidden="true">
      {fallingStickers.map((drop) => (
        <span
          key={drop.id}
          className="sticker"
          style={
            {
              left: `${drop.left}%`,
              color: drop.color,
              animationDuration: `${drop.duration}s`,
              animationDelay: `${drop.delay}s`,
              '--scale': drop.scale
            } as CSSProperties
          }
        >
          {drop.emoji}
        </span>
      ))}
    </div>
  );

  const NeonHaloLogo = ({ size = 140 }: { size?: number }) => (
    <div className="neon-logo-wrapper" style={{ width: size, height: size }}>
      <span className="neon-halo" />
      <span className="neon-halo halo-sm" />
      <div className="neon-logo-core">
        <Image
          src="/brand/logo.png"
          alt="m00n"
          width={size - 24}
          height={size - 24}
          className="neon-logo-img"
        />
      </div>
    </div>
  );

  const renderAdminPanel = () => {
    if (!isAdmin) return null;

    const portals: { id: AdminPortalView; label: string }[] = [
      { id: 'default', label: 'Live state' },
      { id: 'claimed_sold', label: 'Claimed + sold' },
      { id: 'claimed_held', label: 'Claimed + held' },
      { id: 'claimed_bought_more', label: 'Claimed + bought' },
      { id: 'eligible_holder', label: 'Claim console' },
      { id: 'locked_out', label: 'Lockout gate' },
      { id: 'lp_gate', label: 'No claim + LP' }
    ];

    return (
      <div className="fixed top-4 right-4 z-50 bg-black/70 border border-[var(--monad-purple)] rounded-2xl p-4 w-64 space-y-3 backdrop-blur">
        <div className="text-left">
          <p className="pixel-font text-[10px] uppercase tracking-[0.4em] text-[var(--moss-green)]">
            Admin portal
          </p>
          <p className="text-xs opacity-70">Preview each basket instantly</p>
        </div>
        <button
          onClick={handleOpenClaimSite}
          className="w-full text-xs px-3 py-2 rounded-lg border border-[var(--moss-green)] text-[var(--moss-green)] hover:bg-[var(--moss-green)] hover:text-black transition-colors"
        >
          Open claim site
        </button>
        <div className="grid grid-cols-1 gap-2">
          {portals.map((portal) => (
            <button
              key={portal.id}
              onClick={() => setAdminPortalView(portal.id)}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
                adminPortalView === portal.id
                  ? 'bg-[var(--monad-purple)] text-white border-[var(--monad-purple)]'
                  : 'border-white/20 text-white/80 hover:bg-white/5'
              }`}
            >
              {portal.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderShell = (content: ReactNode) => (
    <div className="relative min-h-screen overflow-x-hidden">
      {renderAdminPanel()}
      <BackgroundOrbs />
      <StickerRain />
      {content}
      {isLpClaimModalOpen && renderLpClaimModal()}
    </div>
  );

  const BackgroundOrbs = () => (
    <>
      <span className="floating-orb orb-one" />
      <span className="floating-orb orb-two" />
      <span className="floating-orb orb-three" />
    </>
  );

  const renderContractCard = () => (
    <div className="bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-6 space-y-4 text-left backdrop-blur">
      <div>
        <p className="uppercase text-[var(--moss-green)] text-xs tracking-widest mb-2">
          m00n contract
        </p>
        <p className="font-mono text-sm break-all px-1">{TOKEN_ADDRESS}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={handleCopyContract}
          className="pixel-font text-xs px-4 py-2 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-all"
        >
          {copiedContract ? 'COPIED' : 'COPY CA'}
        </button>
        <button
          onClick={handleOpenClaimSite}
          className="pixel-font text-xs px-4 py-2 border border-[var(--moss-green)] rounded text-[var(--moss-green)] hover:bg-[var(--moss-green)] hover:text-black transition-all"
        >
          OPEN CLAIM SITE
        </button>
      </div>
    </div>
  );

  const statusState = useMemo(() => {
    if (isMiniApp === false) {
      return {
        label: 'OPEN IN WARPCAST',
        detail: 'This portal only unlocks inside the Warpcast mini app shell.',
        actionable: false
      };
    }
    if (!isSdkReady) {
      return {
        label: 'SYNCING SDK…',
        detail: 'Bridging to the Farcaster relay.',
        actionable: false
      };
    }
    if (scanPhase === 'authenticating') {
      return {
        label: 'AUTHENTICATING…',
        detail: 'Awaiting approval from your Farcaster wallet.',
        actionable: false
      };
    }
    if (scanPhase === 'addresses') {
      return {
        label: 'SYNCING ADDRESSES…',
        detail: 'Pulling verified wallets from Neynar.',
        actionable: false
      };
    }
    if (scanPhase === 'fetching') {
      return {
        label: 'CALCULATING DROP…',
        detail: 'Crunching the $m00n ledger entries.',
        actionable: false
      };
    }
    if (scanPhase === 'idle') {
      return {
        label: 'SCAN FID',
        detail: 'Tap to connect and fetch your drop.',
        actionable: true
      };
    }
    if (error || scanPhase === 'error') {
      return {
        label: 'RETRY SCAN',
        detail: error ?? 'Tap to try again.',
        actionable: true
      };
    }
    if (airdropData) {
      return {
        label: 'DROP READY',
        detail: airdropData.eligible
          ? 'Scroll to reveal your allocation.'
          : 'No cabal allotment this round.',
        actionable: !airdropData.eligible
      };
    }
    return {
      label: 'SCAN AGAIN',
      detail: 'Tap to re-link your wallet and fetch the ledger.',
      actionable: true
    };
  }, [isMiniApp, isSdkReady, airdropData, error, scanPhase]);

  if (!userData) {
    // Show special message for users with 0 points
    if (hasZeroPoints) {
      return renderShell(
        <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
          <div className="max-w-2xl w-full text-center">
            <h1 className="pixel-font text-3xl text-red-400 glow-red">
              You don&apos;t have to go home but can&apos;t stay here
            </h1>
          </div>
        </div>
      );
    }

    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
        <div className="w-full max-w-sm space-y-8 text-center">
          <div className={`${PANEL_CLASS} space-y-4`}>
            <h1 className="pixel-font text-2xl glow-purple">m00n Cabal Check</h1>
            <p className="text-sm opacity-80 px-2">
              Only cabal members with an allocation can enter. Scan inside Warpcast to verify.
            </p>
          </div>

          {!isMiniApp && (
            <a
              href="https://warpcast.com/~/add-mini-app?domain=m00nad.vercel.app"
              className="pixel-font inline-block px-6 py-2 bg-[var(--monad-purple)] text-white rounded hover:bg-opacity-90 transition-all text-[11px] tracking-[0.4em]"
            >
              OPEN IN WARPCAST
            </a>
          )}

          <div className="text-center space-y-3">
            <button
              onClick={handleSignIn}
              className="pixel-font w-full px-6 py-3 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-all disabled:opacity-40 text-xs tracking-[0.4em]"
              disabled={!statusState.actionable}
            >
              {statusState.label}
            </button>
            <p className="text-xs opacity-70 px-2">{statusState.detail}</p>
            {error && <p className="text-red-400 px-2">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return renderShell(
      <div className="min-h-screen flex items-center justify-center relative z-10">
        <div className="text-center space-y-4 crt-flicker">
          <div className="pixel-font text-xl glow-purple">LOADING...</div>
          <div className="w-64 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--monad-purple)] animate-pulse"
              style={{ width: '60%' }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (isAdmin && adminPortalView !== 'default') {
    switch (adminPortalView) {
      case 'claimed_sold':
        return renderClaimedSoldPortal();
      case 'claimed_held':
        return renderClaimedHeldPortal();
      case 'claimed_bought_more':
        return renderClaimedBoughtMorePortal();
      case 'lp_gate':
        return isLpLoungeOpen && lpGateState.lpStatus === 'HAS_LP'
          ? renderLpLoungePanel()
          : renderLpGatePanel();
      case 'eligible_holder':
        return renderEligibleHolderPanel();
      case 'locked_out':
        return renderLockedOutPanel();
      default:
        break;
    }
  }

  switch (effectivePersona) {
    case 'claimed_sold':
      return renderClaimedSoldPortal();
    case 'claimed_held':
      return renderClaimedHeldPortal();
    case 'claimed_bought_more':
      return renderClaimedBoughtMorePortal();
    case 'lp_gate':
      if (isLpLoungeOpen && lpGateState.lpStatus === 'HAS_LP') {
        return renderLpLoungePanel();
      }
      return renderLpGatePanel();
    case 'eligible_holder':
      return renderEligibleHolderPanel();
    case 'locked_out':
    default:
      return renderLockedOutPanel();
  }
}

export default function MiniAppPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiConfig config={wagmiConfig}>
        <MiniAppPageInner />
      </WagmiConfig>
    </QueryClientProvider>
  );
}
