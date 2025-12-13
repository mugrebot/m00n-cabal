'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { PrivyProvider, usePrivy, type PrivyProviderProps } from '@privy-io/react-auth';
import {
  WagmiProvider,
  createConfig,
  http,
  useAccount,
  useConnect,
  useDisconnect,
  useWalletClient,
  useBalance,
  useReadContract,
  usePublicClient
} from 'wagmi';
import {
  createPublicClient,
  erc20Abi,
  encodeFunctionData,
  getAddress,
  http as viemHttp
} from 'viem';
import { farcasterMiniApp as miniAppConnector } from '@farcaster/miniapp-wagmi-connector';
import { formatUnits } from 'viem';
import sdk from '@farcaster/miniapp-sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type DepositAsset = 'moon' | 'wmon';
type BandSide = 'single' | 'double';
type DeployState = 'idle' | 'building' | 'success' | 'error';

interface PoolState {
  tick: number;
  moonUsdPrice: number | null;
  wmonUsdPrice: number | null;
  updatedAt: string;
}

interface ChartPoint {
  x: number;
  y: number;
}

const TOKEN_MOON_ADDRESS = getAddress('0x22cd99ec337a2811f594340a4a6e41e4a3022b07');
const TOKEN_WMON_ADDRESS = getAddress('0x3bd359C1119dA7Da1d913d1C4D2b7C461115433A');

const CHAIN_CAIP = 'eip155:143';
const MON_NATIVE_CAIP = `${CHAIN_CAIP}/native`;
const WMON_CAIP = `${CHAIN_CAIP}/erc20:${TOKEN_WMON_ADDRESS.toLowerCase()}`;
const MOON_CAIP = `${CHAIN_CAIP}/erc20:${TOKEN_MOON_ADDRESS.toLowerCase()}`;
const APPROVAL_BUFFER_BPS = BigInt(200); // 2% buffer to avoid edge under-approvals on large sizes
const DEFAULT_MONAD_RPC = process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? 'https://rpc.monad.xyz';
const PERMIT2_ADDRESS = getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3');
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? process.env.PRIVY_APP_ID ?? '';
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
    default: { name: 'Monadscan', url: 'https://monadscan.com' }
  }
};

type MiniAppState = 'unknown' | 'desktop' | 'miniapp';

const queryClient = new QueryClient();
const MINIAPP_CONNECTOR_ID = 'farcasterMiniApp';

async function buildConnectors(state: MiniAppState) {
  const base = [miniAppConnector()];
  if (typeof window === 'undefined') return base;
  if (state !== 'desktop') return base;

  try {
    const { metaMask, injected, coinbaseWallet } = await import('wagmi/connectors');
    return [
      ...base,
      metaMask(),
      injected({ shimDisconnect: true }),
      coinbaseWallet({
        appName: 'm00n advanced LP',
        jsonRpcUrl: monadChain.rpcUrls.default.http[0]!
      })
    ] as const;
  } catch (error) {
    console.warn('ADV_LP:desktop_connectors_failed', error);
    return base;
  }
}

const HISTORY_POINTS = 48;
const MOON_CIRC_SUPPLY = 100_000_000_000; // market cap conversion factor
const POSITION_MANAGER_ADDRESS = getAddress('0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016');
const BUY_MOON_URL = process.env.NEXT_PUBLIC_BUY_MOON_URL ?? 'https://farcaster.xyz/miniapps';
const BUY_WMON_URL = process.env.NEXT_PUBLIC_BUY_WMON_URL ?? 'https://farcaster.xyz/miniapps';

function openExternalUrl(url: string) {
  if (!url) return;
  try {
    sdk?.actions?.openUrl(url);
  } catch {
    /* noop */
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noreferrer');
  }
}

// spacing utils (unused in client but kept for reference)
const tickToPrice = (tick: number) => Math.pow(1.0001, tick);

// --- Probability & Risk Helpers (desktop-only) ---
// Standard normal CDF approximation (Abramowitz & Stegun)
function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Probability that a lognormal asset stays within [lower, upper] over horizon.
 * Uses a simplified BM band-hit approximation (conservative underestimate).
 * @param spot Current price
 * @param lower Lower bound
 * @param upper Upper bound
 * @param sigmaAnn Annualized volatility (decimal, e.g. 1.0 = 100%)
 * @param days Time horizon in days
 */
function probStayInRange(
  spot: number,
  lower: number,
  upper: number,
  sigmaAnn: number,
  days: number
): number {
  if (spot <= 0 || lower <= 0 || upper <= 0 || sigmaAnn <= 0 || days <= 0) return 0;
  if (lower >= upper) return 0;
  if (spot < lower || spot > upper) return 0;
  const T = days / 365;
  const sigmaT = sigmaAnn * Math.sqrt(T);
  // Log distances from spot to bounds
  const dLower = Math.log(lower / spot);
  const dUpper = Math.log(upper / spot);
  // Prob of staying inside using approximate formula (no drift, symmetric BM)
  // P(stay) ≈ Φ(dUpper/sigmaT) - Φ(dLower/sigmaT)
  // This is simplified; real barrier option math is more complex but this gives intuition.
  const pUpper = normCdf(dUpper / sigmaT);
  const pLower = normCdf(dLower / sigmaT);
  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, pUpper - pLower));
}

/**
 * Expected 1-sigma move (in USD) over the horizon, using forward vol.
 */
function expectedMove(spot: number, sigmaAnn: number, days: number): number {
  if (spot <= 0 || sigmaAnn <= 0 || days <= 0) return 0;
  const T = days / 365;
  return spot * sigmaAnn * Math.sqrt(T);
}

function formatTokenBalance(value?: bigint, decimals = 18) {
  if (value === undefined) return '0';
  const numeric = Number(formatUnits(value, decimals));
  if (!Number.isFinite(numeric)) return '0';
  if (numeric >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(1)}B`;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `${numeric.toFixed(1)}k`;
  return numeric.toFixed(4);
}

function formatUsd(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return '$0.00';
  let digits = 2;
  if (value >= 100) {
    digits = 0;
  } else if (value >= 1) {
    digits = 2;
  } else if (value >= 0.01) {
    digits = 4;
  } else {
    digits = 6;
  }
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function generateMockSeries(anchor: number | null): ChartPoint[] {
  const finalValue = anchor && anchor > 0 ? anchor : 50_000;
  const base = finalValue || 50_000;
  const points: ChartPoint[] = [];
  let value = base * 0.85;
  for (let i = 0; i < HISTORY_POINTS; i += 1) {
    const drift = Math.sin(i / 6) * base * 0.02;
    const noise = (Math.random() - 0.5) * base * 0.01;
    value = Math.max(base * 0.35, Math.min(base * 1.8, value + drift + noise));
    points.push({ x: i, y: value });
  }
  if (points.length) {
    points[points.length - 1] = { x: HISTORY_POINTS - 1, y: finalValue };
  } else {
    points.push({ x: 0, y: finalValue });
  }
  return points;
}

interface RangeChartProps {
  series: ChartPoint[];
  currentUsd: number | null;
  lowerUsd: number | null;
  upperUsd: number | null;
}

function RangeChart({ series, currentUsd, lowerUsd, upperUsd }: RangeChartProps) {
  const width = 800;
  const height = 320;
  const paddingRight = 200;
  const chartWidth = width - paddingRight;

  const minValue = useMemo(() => {
    const candidates = series.map((point) => point.y);
    if (currentUsd) candidates.push(currentUsd);
    if (lowerUsd) candidates.push(lowerUsd);
    if (upperUsd) candidates.push(upperUsd);
    const min = Math.min(...candidates);
    return Math.max(0, min * 0.9);
  }, [series, currentUsd, lowerUsd, upperUsd]);

  const maxValue = useMemo(() => {
    const candidates = series.map((point) => point.y);
    if (currentUsd) candidates.push(currentUsd);
    if (lowerUsd) candidates.push(lowerUsd);
    if (upperUsd) candidates.push(upperUsd);
    const max = Math.max(...candidates);
    return max * 1.1;
  }, [series, currentUsd, lowerUsd, upperUsd]);

  const scaleY = useCallback(
    (value: number) => {
      const clamped = Math.min(Math.max(value, minValue), maxValue);
      const range = maxValue - minValue;
      const ratio = range === 0 ? 0.5 : (clamped - minValue) / range;
      return height - ratio * height;
    },
    [minValue, maxValue, height]
  );

  const scaleX = useCallback(
    (index: number) => (index / Math.max(series.length - 1, 1)) * chartWidth,
    [series.length, chartWidth]
  );

  if (series.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 h-[320px] flex items-center justify-center text-sm text-white/60">
        Loading telemetry…
      </div>
    );
  }

  const pathD = series
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${scaleX(index)} ${scaleY(point.y)}`)
    .join(' ');

  const hasRange = lowerUsd !== null && upperUsd !== null;
  const upperValue = hasRange ? Math.max(lowerUsd!, upperUsd!) : null;
  const lowerValue = hasRange ? Math.min(lowerUsd!, upperUsd!) : null;
  const upperY = upperValue !== null ? scaleY(upperValue) : null;
  const lowerY = lowerValue !== null ? scaleY(lowerValue) : null;

  const spotX = currentUsd ? scaleX(series.length - 1) : null;
  const spotY = currentUsd ? scaleY(currentUsd) : null;

  // Bracket geometry
  const bracketStartX = (spotX ?? scaleX(series.length - 1)) + 15;
  const bracketEndX = bracketStartX + 60;
  const textX = bracketEndX + 10;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full bg-transparent relative overflow-visible"
    >
      <defs>
        <linearGradient id="telemetryLine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fdd65b" />
          <stop offset="100%" stopColor="#fdd65b" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {hasRange && upperY !== null && lowerY !== null && (
        <>
          {/* Top bracket arm */}
          <line
            x1={bracketStartX}
            x2={bracketEndX}
            y1={upperY}
            y2={upperY}
            stroke="#4a6bfa"
            strokeWidth={2}
          />
          {/* Top bracket serif */}
          <line
            x1={bracketEndX}
            x2={bracketEndX}
            y1={upperY - 8}
            y2={upperY + 8}
            stroke="#4a6bfa"
            strokeWidth={2}
          />
          {/* Top Label */}
          <text
            x={textX}
            y={upperY + 5}
            fill="white"
            fontSize="14"
            fontWeight="bold"
            fontFamily="monospace"
          >
            {formatUsd(upperValue!).replace('$', '')}
          </text>

          {/* Bottom bracket arm */}
          <line
            x1={bracketStartX}
            x2={bracketEndX}
            y1={lowerY}
            y2={lowerY}
            stroke="#4a6bfa"
            strokeWidth={2}
          />
          {/* Bottom bracket serif */}
          <line
            x1={bracketEndX}
            x2={bracketEndX}
            y1={lowerY - 8}
            y2={lowerY + 8}
            stroke="#4a6bfa"
            strokeWidth={2}
          />
          {/* Bottom Label */}
          <text
            x={textX}
            y={lowerY + 5}
            fill="white"
            fontSize="14"
            fontWeight="bold"
            fontFamily="monospace"
          >
            {formatUsd(lowerValue!).replace('$', '')}
          </text>

          {/* Vertical connecting line */}
          <line
            x1={bracketStartX + 40}
            x2={bracketStartX + 40}
            y1={upperY}
            y2={lowerY}
            stroke="#4a6bfa"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        </>
      )}

      <path
        d={pathD}
        fill="none"
        stroke="url(#telemetryLine)"
        strokeWidth={3}
        strokeLinecap="round"
        filter="url(#glow)"
      />

      {spotX !== null && spotY !== null && (
        <g>
          <image
            href="/assets/m00nsvg.svg"
            x={spotX - 10}
            y={spotY - 10}
            width={20}
            height={20}
            preserveAspectRatio="xMidYMid meet"
          />
        </g>
      )}
    </svg>
  );
}

export default function LpAdvancedPage() {
  if (!PRIVY_APP_ID) {
    console.warn('PRIVY_APP_ID missing; Privy desktop connect will be disabled.');
  }

  const privyConfig: PrivyProviderProps['config'] = {
    loginMethods: ['wallet'],
    appearance: {
      theme: 'dark',
      showWalletLoginFirst: true
    }
  };

  return <LpAdvancedProviders privyConfig={privyConfig} />;
}

function LpAdvancedProviders({ privyConfig }: { privyConfig: PrivyProviderProps['config'] }) {
  const [miniAppState, setMiniAppState] = useState<MiniAppState>('unknown');
  const [wagmiConfig, setWagmiConfig] = useState<ReturnType<typeof createConfig> | null>(null);
  const [forcedViewerFid, setForcedViewerFid] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      let state: MiniAppState = 'desktop';
      try {
        state = (await sdk.isInMiniApp()) ? 'miniapp' : 'desktop';
      } catch (error) {
        console.warn('ADV_LP:miniapp_detect_outer_failed', error);
      }
      if (cancelled) return;
      setMiniAppState(state);

      // If we are inside the mini app, try to prime the viewer FID up front.
      if (state === 'miniapp') {
        try {
          await sdk.actions.ready();
          if (!cancelled) {
            const context = await sdk.context;
            if (!cancelled) {
              setForcedViewerFid(context.user?.fid ?? null);
              // username is captured in AdvancedLpContent
            }
          }
        } catch (error) {
          console.warn('ADV_LP:outer_context_failed', error);
          if (!cancelled) setForcedViewerFid(null);
        }
      } else {
        setForcedViewerFid(null);
      }

      try {
        const connectors = await buildConnectors(state);
        if (cancelled) return;
        setWagmiConfig(
          createConfig({
            chains: [monadChain],
            connectors,
            transports: {
              [monadChain.id]: http(monadChain.rpcUrls.default.http[0]!)
            }
          })
        );
      } catch (error) {
        console.error('ADV_LP:wagmi_config_failed', error);
        if (!cancelled) {
          setWagmiConfig(
            createConfig({
              chains: [monadChain],
              connectors: [miniAppConnector()],
              transports: {
                [monadChain.id]: http(monadChain.rpcUrls.default.http[0]!)
              }
            })
          );
        }
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!wagmiConfig || miniAppState === 'unknown') {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <span className="text-sm text-white/80">Loading LP planner…</span>
      </main>
    );
  }

  const baseChildren = (
    <QueryClientProvider client={queryClient}>
      <AdvancedLpContent forcedMiniAppState={miniAppState} forcedViewerFid={forcedViewerFid} />
    </QueryClientProvider>
  );

  if (!wagmiConfig) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <span className="text-sm text-white/80">Loading LP planner…</span>
      </main>
    );
  }

  // Always wrap with PrivyProvider to keep hooks safe; if app ID is missing, use a placeholder
  const privyAppId = PRIVY_APP_ID || 'missing-privy-app-id';

  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      <WagmiProvider config={wagmiConfig}>{baseChildren}</WagmiProvider>
    </PrivyProvider>
  );
}

function AdvancedLpContent({
  forcedMiniAppState,
  forcedViewerFid
}: {
  forcedMiniAppState?: MiniAppState;
  forcedViewerFid?: number | null;
}) {
  const [miniAppState, setMiniAppState] = useState<MiniAppState>(forcedMiniAppState ?? 'unknown');
  const [viewerFid, setViewerFid] = useState<number | null>(forcedViewerFid ?? null);
  const [viewerUsername, setViewerUsername] = useState<string | null>(null);
  const [, setMiniAppError] = useState<string | null>(null);
  const [privyError, setPrivyError] = useState<string | null>(null);
  const [privyActivating, setPrivyActivating] = useState(false);

  const { address, isConnected } = useAccount();
  const { connect, connectors, error: connectError, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: monadChain.id });
  const fallbackPublicClient = useMemo(
    () =>
      createPublicClient({
        chain: monadChain,
        transport: viemHttp(monadChain.rpcUrls.default.http[0]!)
      }),
    []
  );
  const effectivePublicClient = publicClient ?? fallbackPublicClient;

  const moonBalance = useBalance({
    address,
    token: TOKEN_MOON_ADDRESS,
    chainId: monadChain.id,
    query: { enabled: Boolean(address), refetchInterval: 30000 }
  });
  const wmonBalance = useBalance({
    address,
    token: TOKEN_WMON_ADDRESS,
    chainId: monadChain.id,
    query: { enabled: Boolean(address), refetchInterval: 30000 }
  });
  const moonAllowance = useReadContract({
    address: TOKEN_MOON_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [address ?? '0x0000000000000000000000000000000000000000', POSITION_MANAGER_ADDRESS],
    query: { enabled: Boolean(address) }
  });
  const wmonAllowance = useReadContract({
    address: TOKEN_WMON_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [address ?? '0x0000000000000000000000000000000000000000', POSITION_MANAGER_ADDRESS],
    query: { enabled: Boolean(address) }
  });

  const [swapInFlight, setSwapInFlight] = useState<'moon' | 'wmon' | null>(null);
  const [manualWmonBalance, setManualWmonBalance] = useState<bigint | null>(null);

  const { login } = usePrivy();

  const handleSwapToken = useCallback(
    async (target: 'moon' | 'wmon') => {
      setSwapInFlight(target);
      try {
        if (sdk?.actions?.swapToken) {
          await sdk.actions.swapToken({
            sellToken: MON_NATIVE_CAIP,
            buyToken: target === 'wmon' ? WMON_CAIP : MOON_CAIP
          });
        } else {
          openExternalUrl(target === 'wmon' ? BUY_WMON_URL : BUY_MOON_URL);
        }
      } catch (error) {
        console.error('ADV_LP_SWAP', error);
      } finally {
        setSwapInFlight((current) => (current === target ? null : current));
      }
    },
    [setSwapInFlight]
  );

  const [bandSide, setBandSide] = useState<BandSide>('single');
  const [depositAsset, setDepositAsset] = useState<DepositAsset>('moon');
  const [rangeLowerUsd, setRangeLowerUsd] = useState('');
  const [rangeUpperUsd, setRangeUpperUsd] = useState('');
  const [rangeTouched, setRangeTouched] = useState(false);
  const [singleAmount, setSingleAmount] = useState('');
  const [doubleMoonAmount, setDoubleMoonAmount] = useState('');
  const [doubleWmonAmount, setDoubleWmonAmount] = useState('');
  const [lpListLoading, setLpListLoading] = useState(false);
  const [lpListError, setLpListError] = useState<string | null>(null);
  const [lpList, setLpList] = useState<
    Array<{
      tokenId: string;
      bandType: string;
      rangeStatus: string;
      tickLower: number;
      tickUpper: number;
    }>
  >([]);
  const [collectStatus, setCollectStatus] = useState<
    Record<string, 'idle' | 'loading' | 'success' | 'error'>
  >({});
  const [collectError, setCollectError] = useState<Record<string, string | null>>({});
  const [removeStatus, setRemoveStatus] = useState<
    Record<string, 'idle' | 'loading' | 'success' | 'error'>
  >({});
  const [removeError, setRemoveError] = useState<Record<string, string | null>>({});

  // Volatility / probability inputs (desktop-only feature)
  const [sigmaStay, setSigmaStay] = useState('100'); // % annualized for stay-in-range prob
  const [sigmaFwd, setSigmaFwd] = useState('120'); // % annualized for forward outcomes
  const [horizonDays, setHorizonDays] = useState('7');
  const [volFetchStatus, setVolFetchStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  const [volFetchMessage, setVolFetchMessage] = useState<string | null>(null);
  const [volFetchCooldown, setVolFetchCooldown] = useState(0);

  // Cooldown timer effect
  useEffect(() => {
    if (volFetchCooldown <= 0) return;
    const timer = setTimeout(() => setVolFetchCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [volFetchCooldown]);

  // Auto-fetch volatility on page load (both desktop and mini-app)
  useEffect(() => {
    if (volFetchStatus === 'idle' && miniAppState) {
      handleFetchVolatility();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miniAppState]);

  const handleFetchVolatility = useCallback(async () => {
    if (volFetchCooldown > 0) return; // Prevent spam
    setVolFetchStatus('loading');
    setVolFetchMessage(null);
    try {
      const res = await fetch(`/api/volatility?days=30`);
      const data = await res.json();
      if (data.success && data.suggestedSigmaStay && data.suggestedSigmaFwd) {
        setSigmaStay(String(data.suggestedSigmaStay));
        setSigmaFwd(String(data.suggestedSigmaFwd));
        setVolFetchStatus('success');
        setVolFetchMessage(
          `Fetched ${data.sampleCount} samples over ${data.periodDays?.toFixed(1) ?? '?'}d. σ=${data.annualizedVolPercent?.toFixed(0)}% ann.`
        );
        setVolFetchCooldown(60); // 60s cooldown after success
      } else {
        setVolFetchStatus('error');
        setVolFetchMessage(data.message || 'No data available. Using manual defaults.');
        setVolFetchCooldown(10); // 10s cooldown after error
      }
    } catch (err) {
      console.error('VOL_FETCH', err);
      setVolFetchStatus('error');
      setVolFetchMessage('Failed to fetch. Using manual defaults.');
      setVolFetchCooldown(10);
    }
  }, [volFetchCooldown]);
  const [feeData, setFeeData] = useState<
    Record<
      string,
      {
        unclaimedUsd: number | null;
        lifetimeUsd: number | null;
        unclaimed0: string;
        unclaimed1: string;
        lifetime0: string;
        lifetime1: string;
        token0Symbol: string;
        token1Symbol: string;
      }
    >
  >({});
  const [status, setStatus] = useState<DeployState>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [requiredMoonWei, setRequiredMoonWei] = useState<string | null>(null);
  const [requiredWmonWei, setRequiredWmonWei] = useState<string | null>(null);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const [marketState, setMarketState] = useState<PoolState | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [miniAppConnectError, setMiniAppConnectError] = useState<string | null>(null);

  const moonSpotPriceUsd = useMemo(() => {
    if (marketState?.moonUsdPrice && marketState.moonUsdPrice > 0) {
      return marketState.moonUsdPrice;
    }
    if (
      marketState &&
      typeof marketState.tick === 'number' &&
      marketState.wmonUsdPrice &&
      marketState.wmonUsdPrice > 0
    ) {
      return Math.pow(1.0001, marketState.tick) * marketState.wmonUsdPrice;
    }
    return null;
  }, [marketState]);

  const moonMarketCapUsd = useMemo(() => {
    if (!moonSpotPriceUsd) return null;
    return moonSpotPriceUsd * MOON_CIRC_SUPPLY;
  }, [moonSpotPriceUsd]);

  const chartSeries = useMemo(() => generateMockSeries(moonMarketCapUsd), [moonMarketCapUsd]);

  // Normalized range & probability metrics (desktop-only)
  const riskMetrics = useMemo(() => {
    const spotMcap = moonMarketCapUsd;
    const lower = Number(rangeLowerUsd);
    const upper = Number(rangeUpperUsd);
    const sigma = Number(sigmaStay) / 100; // convert % to decimal
    const sigmaI = Number(sigmaFwd) / 100;
    const days = Number(horizonDays);

    if (!spotMcap || spotMcap <= 0 || !lower || !upper || lower >= upper || lower <= 0) {
      return null;
    }

    // Normalized range (% offset from spot)
    const pctLower = (lower / spotMcap - 1) * 100;
    const pctUpper = (upper / spotMcap - 1) * 100;

    // Log distances (for display)
    const logLower = Math.log(lower / spotMcap);
    const logUpper = Math.log(upper / spotMcap);

    // Probability of staying in range using σ (stay)
    const probStay =
      sigma > 0 && days > 0 ? probStayInRange(spotMcap, lower, upper, sigma, days) : null;

    // Expected 1-sigma move using σᵢ (forward)
    const expMove = sigmaI > 0 && days > 0 ? expectedMove(spotMcap, sigmaI, days) : null;

    // Expected move as percentage
    const expMovePct = expMove && spotMcap ? (expMove / spotMcap) * 100 : null;

    // Suggested range for ~50% probability (roughly ±1σ for the horizon)
    // Cap lower at -90% since mcap can't go negative
    const sigmaT = sigma * Math.sqrt(days / 365);
    const suggestedRange =
      sigma > 0 && days > 0
        ? {
            lower: Math.max(-90, -sigmaT * 100), // cap at -90% (can't go below 0)
            upper: sigmaT * 100 // as % above spot
          }
        : null;

    return {
      spotMcap,
      lower,
      upper,
      pctLower,
      pctUpper,
      logLower,
      logUpper,
      probStay,
      expMove,
      expMovePct,
      suggestedRange,
      sigma,
      sigmaI,
      days
    };
  }, [moonMarketCapUsd, rangeLowerUsd, rangeUpperUsd, sigmaStay, sigmaFwd, horizonDays]);

  const [stars] = useState(() => {
    return [...Array(100)].map((_, i) => ({
      id: i,
      x: Math.random(),
      y: Math.random(),
      size: Math.random() > 0.8 ? 2 : 1,
      opacity: Math.random() * 0.5 + 0.1
    }));
  });

  const renderShell = useCallback(
    (children: ReactNode, backgroundElement?: ReactNode) => (
      <main className="min-h-screen bg-[#05030b] text-white relative overflow-hidden flex items-center justify-center p-4 md:p-10">
        {/* Global ambient backgrounds */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#130a26] via-transparent to-black opacity-70" />
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_20%,rgba(140,84,255,0.3),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(108,229,177,0.18),transparent_40%)]" />

        {/* Main Dashboard Container */}
        <div
          className="relative z-10 w-full max-w-6xl rounded-[32px] border border-white/10 bg-[#000000] overflow-hidden shadow-2xl"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.03) 1px, transparent 1px), radial-gradient(circle at 80% 40%, rgba(255, 255, 255, 0.03) 1px, transparent 1px), radial-gradient(circle at 40% 70%, rgba(255, 255, 255, 0.03) 1px, transparent 1px), radial-gradient(circle at 90% 10%, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
            backgroundSize: '120px 120px'
          }}
        >
          {/* Stars Layer */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-60">
            {stars.map((star) => (
              <rect
                key={star.id}
                x={`${star.x * 100}%`}
                y={`${star.y * 100}%`}
                width={star.size}
                height={star.size}
                fill="white"
                opacity={star.opacity}
              />
            ))}
          </svg>

          {/* Optional background chart layer */}
          {backgroundElement && (
            <div className="absolute inset-0 z-0 pointer-events-none">{backgroundElement}</div>
          )}

          <div className="relative z-10 p-6 md:p-10 space-y-8">{children}</div>
        </div>
      </main>
    ),
    [stars]
  );

  useEffect(() => {
    if (forcedMiniAppState && forcedMiniAppState !== 'unknown') {
      setMiniAppState(forcedMiniAppState);
      // Even when forced, if we're in the mini app and missing the FID, try to fetch it.
      if (forcedMiniAppState !== 'miniapp' || viewerFid !== null) return;
    }

    let cancelled = false;
    const detectMiniApp = async () => {
      try {
        const insideMiniApp = await sdk.isInMiniApp();
        if (cancelled) return;
        if (!insideMiniApp) {
          setMiniAppState('desktop');
          return;
        }

        setMiniAppState('miniapp');
        try {
          await sdk.actions.ready();
          if (cancelled) return;

          // Try to sign in to get full user profile with username
          try {
            const nonce = crypto.randomUUID();
            await sdk.actions.signIn({ nonce });
          } catch (signInErr) {
            console.warn('ADV_LP:signIn_skipped', signInErr);
            // Continue without sign-in - we can still get basic context
          }

          const context = await sdk.context;
          console.log('ADV_LP:context.user=', JSON.stringify(context.user));
          if (!cancelled) {
            setViewerFid(context.user?.fid ?? null);
            // Try username first, then displayName
            setViewerUsername(context.user?.username || context.user?.displayName || null);
          }
        } catch (readyError) {
          console.warn('ADV_LP:sdk_ready_failed', readyError);
          if (!cancelled) {
            setMiniAppError('Unable to load Farcaster context. Reload the mini app.');
          }
        }
      } catch (error) {
        console.warn('ADV_LP:miniapp_detection_failed', error);
        if (!cancelled) {
          setMiniAppState('desktop');
        }
      }
    };

    void detectMiniApp();
    return () => {
      cancelled = true;
    };
  }, [forcedMiniAppState, viewerFid]);

  useEffect(() => {
    let mounted = true;
    const loadTelemetry = async () => {
      try {
        setMarketLoading(true);
        const response = await fetch('/api/pool-state');
        if (!response.ok) throw new Error(`pool_state_${response.status}`);
        const data = (await response.json()) as PoolState;
        if (mounted) {
          setMarketState(data);
          setMarketError(null);
        }
      } catch (error) {
        console.error('POOL_STATE_FAILED', error);
        if (mounted) setMarketError('Unable to sync pool state. Try again shortly.');
      } finally {
        if (mounted) setMarketLoading(false);
      }
    };

    void loadTelemetry();
    const interval = window.setInterval(loadTelemetry, 30_000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!moonMarketCapUsd || rangeTouched) return;

    // Seed defaults in market-cap USD: double-sided = ±20%; single m00n = 2–8% above; single WMON = 2–8% below.
    let nextLower: string | null = null;
    let nextUpper: string | null = null;

    if (bandSide === 'double') {
      const pad = 0.2;
      nextLower = (moonMarketCapUsd * (1 - pad)).toFixed(0);
      nextUpper = (moonMarketCapUsd * (1 + pad)).toFixed(0);
    } else if (bandSide === 'single') {
      if (depositAsset === 'moon') {
        nextLower = (moonMarketCapUsd * 1.02).toFixed(0);
        nextUpper = (moonMarketCapUsd * 1.08).toFixed(0);
      } else {
        nextLower = (moonMarketCapUsd * 0.92).toFixed(0);
        nextUpper = (moonMarketCapUsd * 0.98).toFixed(0);
      }
    } else {
      return;
    }

    if (nextLower !== null && nextLower !== rangeLowerUsd) {
      setRangeLowerUsd(nextLower);
    }
    if (nextUpper !== null && nextUpper !== rangeUpperUsd) {
      setRangeUpperUsd(nextUpper);
    }
  }, [moonMarketCapUsd, bandSide, depositAsset, rangeTouched, rangeLowerUsd, rangeUpperUsd]);

  const parsedLower = Number(rangeLowerUsd);
  const parsedUpper = Number(rangeUpperUsd);
  const hasValidRange = Number.isFinite(parsedLower) && Number.isFinite(parsedUpper);
  const [rangeMin, rangeMax] = hasValidRange
    ? parsedLower < parsedUpper
      ? [parsedLower, parsedUpper]
      : [parsedUpper, parsedLower]
    : [null, null];

  const singleRangeInvalid = useMemo(() => {
    if (!hasValidRange || rangeMin === null || rangeMax === null || !moonMarketCapUsd) return false;
    if (bandSide !== 'single') return false;
    if (depositAsset === 'moon') {
      return rangeMin <= moonMarketCapUsd || rangeMax <= moonMarketCapUsd;
    }
    // WMON single-sided: both bounds must be below spot
    return rangeMax >= moonMarketCapUsd || rangeMin >= moonMarketCapUsd;
  }, [bandSide, depositAsset, hasValidRange, rangeMin, rangeMax, moonMarketCapUsd]);

  const rangeError = useMemo(() => {
    if (!hasValidRange || rangeMin === null || rangeMax === null) return 'Enter both USD bounds.';
    if (rangeMin === rangeMax) return 'Bounds must differ.';
    if (rangeMin <= 0) return 'Bounds must be positive.';
    if (singleRangeInvalid && bandSide === 'single') {
      return depositAsset === 'moon'
        ? 'For m00n-only, set both bounds above the current price.'
        : 'For WMON-only, set both bounds below the current price.';
    }
    return null;
  }, [hasValidRange, rangeMin, rangeMax, singleRangeInvalid, bandSide, depositAsset]);

  const updateDoubleSidedAmounts = useCallback(
    (changedSide: 'moon' | 'wmon', value: string) => {
      if (changedSide === 'moon') setDoubleMoonAmount(value);
      else setDoubleWmonAmount(value);

      if (bandSide !== 'double') return;
      if (!value || !marketState || !marketState.wmonUsdPrice || !rangeMin || !rangeMax) return;

      const amountIn = parseFloat(value);
      if (isNaN(amountIn) || amountIn <= 0) return;

      // Convert market cap bounds to per-token USD, then to W-MON price space
      const lowerPriceUsd = rangeMin / MOON_CIRC_SUPPLY;
      const upperPriceUsd = rangeMax / MOON_CIRC_SUPPLY;
      const priceLowerWmon = lowerPriceUsd / marketState.wmonUsdPrice;
      const priceUpperWmon = upperPriceUsd / marketState.wmonUsdPrice;
      const priceCurrentWmon = tickToPrice(marketState.tick);

      // Clamp spot into the band to always derive a ratio (avoid zeroed counterpart)
      const clampedPrice = Math.min(Math.max(priceCurrentWmon, priceLowerWmon), priceUpperWmon);

      // Calculate ratio (amount1/amount0) using clamped price
      const sqrtP = Math.sqrt(clampedPrice);
      const sqrtPa = Math.sqrt(priceLowerWmon);
      const sqrtPb = Math.sqrt(priceUpperWmon);

      const numerator = sqrtP * sqrtPb * (sqrtP - sqrtPa);
      const denominator = sqrtPb - sqrtP;

      let ratio = numerator / denominator; // amount1 / amount0

      // Fallback if ratio is invalid or zero-ish: use clamped spot price as ratio
      if (!Number.isFinite(ratio) || ratio <= 0) {
        ratio = clampedPrice;
      }

      if (changedSide === 'moon') {
        const other = amountIn * ratio;
        setDoubleWmonAmount(other.toFixed(6));
      } else {
        const other = amountIn / ratio;
        setDoubleMoonAmount(other.toFixed(2));
      }
    },
    [bandSide, marketState, rangeMin, rangeMax]
  );

  const handleDeploy = useCallback(async () => {
    if (!address || !walletClient) {
      setStatus('error');
      setStatusMessage('Connect a wallet on Monad first.');
      return;
    }
    if (bandSide === 'single') {
      if (!singleAmount || Number(singleAmount) <= 0) {
        setStatus('error');
        setStatusMessage('Enter a positive deposit amount.');
        return;
      }
    } else {
      if (!doubleMoonAmount || Number(doubleMoonAmount) <= 0) {
        setStatus('error');
        setStatusMessage('Enter a positive m00n deposit.');
        return;
      }
      if (!doubleWmonAmount || Number(doubleWmonAmount) <= 0) {
        setStatus('error');
        setStatusMessage('Enter a positive W-MON deposit.');
        return;
      }
    }
    if (rangeMin === null || rangeMax === null || rangeError) {
      setStatus('error');
      setStatusMessage(rangeError ?? 'Enter a valid USD range first.');
      return;
    }

    try {
      setStatus('building');
      setStatusMessage('Building calldata with V4 PositionManager…');
      setTxHash(null);
      setApprovalMessage(null);

      const lowerPriceUsd = rangeMin / MOON_CIRC_SUPPLY;
      const upperPriceUsd = rangeMax / MOON_CIRC_SUPPLY;
      if (!Number.isFinite(lowerPriceUsd) || !Number.isFinite(upperPriceUsd)) {
        throw new Error('invalid_price_range');
      }

      const payload: Record<string, unknown> = {
        recipient: address,
        side: bandSide,
        rangeLowerUsd: lowerPriceUsd,
        rangeUpperUsd: upperPriceUsd
      };

      if (bandSide === 'single') {
        payload.singleDepositAsset = depositAsset;
        payload.singleAmount = singleAmount;
      } else {
        payload.doubleMoonAmount = doubleMoonAmount;
        payload.doubleWmonAmount = doubleWmonAmount;
      }

      const response = await fetch('/api/lp-advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const responsePayload = await response.json().catch(() => ({}));
        throw new Error(responsePayload.error ?? 'lp_advanced_failed');
      }

      const {
        to,
        data,
        value,
        requiredMoonWei: respRequiredMoonWei,
        requiredWmonWei: respRequiredWmonWei
      } = (await response.json()) as {
        to: `0x${string}`;
        data: `0x${string}`;
        value?: string;
        requiredMoonWei?: string;
        requiredWmonWei?: string;
      };

      setRequiredMoonWei(respRequiredMoonWei ?? null);
      setRequiredWmonWei(respRequiredWmonWei ?? null);

      const neededMoon = respRequiredMoonWei ? BigInt(respRequiredMoonWei) : BigInt(0);
      const neededWmon = respRequiredWmonWei ? BigInt(respRequiredWmonWei) : BigInt(0);
      const hasMoon = moonBalance.data?.value ?? BigInt(0);
      const hasWmon = manualWmonBalance ?? wmonBalance.data?.value ?? BigInt(0);

      if (neededMoon > hasMoon || neededWmon > hasWmon) {
        setStatus('error');
        setStatusMessage('Insufficient balance for required amounts.');
        return;
      }

      const waitForReceipt = async (hash: `0x${string}`) => {
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash });
        } else {
          await new Promise((resolve) => setTimeout(resolve, 4000));
        }
      };

      const withBuffer = (amount: bigint) =>
        amount <= BigInt(0)
          ? BigInt(0)
          : amount + (amount * APPROVAL_BUFFER_BPS) / BigInt(10_000) + BigInt(1);

      const approveWithPermit2 = async (
        tokenAddress: `0x${string}`,
        label: 'm00n' | 'WMON',
        required: bigint
      ) => {
        if (required <= BigInt(0)) return;

        const buffered = withBuffer(required);
        const nowSec = Math.floor(Date.now() / 1000);
        const permitExpiration = nowSec + 60 * 60 * 24 * 30;

        // Check existing ERC20 allowance to Permit2
        let existingAllowance = BigInt(0);
        try {
          if (publicClient) {
            existingAllowance = await publicClient.readContract({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [address, PERMIT2_ADDRESS]
            });
          }
        } catch {
          existingAllowance = BigInt(0);
        }

        // Only approve ERC20 → Permit2 if needed
        if (existingAllowance < buffered) {
          setStatusMessage(`Approving ${label} to Permit2…`);
          const approveUnderlyingData = encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [PERMIT2_ADDRESS, buffered]
          });
          const approveUnderlyingTx = await walletClient.sendTransaction({
            account: address,
            to: tokenAddress,
            data: approveUnderlyingData,
            chain: walletClient.chain ?? undefined
          });
          await waitForReceipt(approveUnderlyingTx);
        }

        // Check existing Permit2 allowance to PositionManager
        let permit2Allowance = BigInt(0);
        try {
          if (publicClient) {
            const result = await publicClient.readContract({
              address: PERMIT2_ADDRESS,
              abi: permit2Abi,
              functionName: 'allowance',
              args: [address, tokenAddress, POSITION_MANAGER_ADDRESS]
            });
            // Permit2 returns [amount, expiration, nonce] tuple
            permit2Allowance = Array.isArray(result) ? BigInt(result[0]) : BigInt(0);
          }
        } catch {
          permit2Allowance = BigInt(0);
        }

        // Only approve Permit2 → PositionManager if needed
        if (permit2Allowance < buffered) {
          setStatusMessage(`Setting ${label} Permit2 allowance…`);
          const permitData = encodeFunctionData({
            abi: permit2Abi,
            functionName: 'approve',
            args: [tokenAddress, POSITION_MANAGER_ADDRESS, buffered, permitExpiration]
          });
          const approvePermitTx = await walletClient.sendTransaction({
            account: address,
            to: PERMIT2_ADDRESS,
            data: permitData,
            chain: walletClient.chain ?? undefined
          });
          await waitForReceipt(approvePermitTx);
        }
      };

      await approveWithPermit2(TOKEN_MOON_ADDRESS, 'm00n', neededMoon);
      await approveWithPermit2(TOKEN_WMON_ADDRESS, 'WMON', neededWmon);

      setStatusMessage('Submitting transaction…');
      const tx = await walletClient.sendTransaction({
        account: address,
        to,
        data,
        value: value ? BigInt(value) : undefined,
        chain: walletClient.chain ?? undefined
      });

      await waitForReceipt(tx);
      void moonBalance.refetch?.();
      void wmonBalance.refetch?.();

      setStatus('success');
      setStatusMessage('Transaction submitted. View on Monadscan below.');
      setTxHash(tx);
    } catch (error) {
      console.error('ADVANCED_LP_DEPLOY', error);
      setStatus('error');
      if (error instanceof Error && /reject|denied|User rejected/i.test(error.message)) {
        setStatusMessage('Transaction canceled.');
      } else {
        setStatusMessage(
          error instanceof Error ? error.message : 'Unable to deploy band right now.'
        );
      }
    }
  }, [
    address,
    walletClient,
    bandSide,
    singleAmount,
    doubleMoonAmount,
    doubleWmonAmount,
    rangeMin,
    rangeMax,
    rangeError,
    depositAsset,
    publicClient,
    moonBalance,
    wmonBalance,
    manualWmonBalance
  ]);

  useEffect(() => {
    if (miniAppState !== 'miniapp') return;
    if (isConnected) return;
    const miniConnector = connectors.find((c) => c.id === MINIAPP_CONNECTOR_ID);
    if (miniConnector) {
      try {
        connect({ connector: miniConnector, chainId: monadChain.id });
      } catch (err) {
        console.warn('ADV_LP:auto_connect_miniapp_failed', err);
        setMiniAppConnectError('Connect your Farcaster wallet to deploy from the mini app.');
      }
    }
  }, [miniAppState, isConnected, connectors, connect]);

  const handleMiniAppConnect = useCallback(() => {
    const miniConnector = connectors.find((c) => c.id === MINIAPP_CONNECTOR_ID);
    if (!miniConnector) {
      setMiniAppConnectError('Farcaster mini-app wallet not available.');
      return;
    }
    try {
      connect({ connector: miniConnector, chainId: monadChain.id });
      setMiniAppConnectError(null);
    } catch (err) {
      console.warn('ADV_LP:manual_connect_miniapp_failed', err);
      setMiniAppConnectError('Unable to connect Farcaster wallet. Please retry.');
    }
  }, [connectors, connect]);

  const moonBalanceDisplay = formatTokenBalance(
    moonBalance.data?.value,
    moonBalance.data?.decimals
  );
  const wmonDecimals = wmonBalance.data?.decimals ?? 18;
  const wmonBalanceDisplay = formatTokenBalance(
    manualWmonBalance ?? wmonBalance.data?.value,
    wmonDecimals
  );

  useEffect(() => {
    if (!isConnected) return;
    void moonBalance.refetch?.();
    void wmonBalance.refetch?.();
    void moonAllowance.refetch?.();
    void wmonAllowance.refetch?.();
  }, [isConnected, moonBalance, wmonBalance, moonAllowance, wmonAllowance]);

  // Manual W-MON balance read (in case wagmi balance is stale/zero)
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    (async () => {
      try {
        if (effectivePublicClient) {
          const bal = await effectivePublicClient.readContract({
            address: TOKEN_WMON_ADDRESS,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address]
          });
          if (!cancelled) {
            setManualWmonBalance(bal as bigint);
          }
          return;
        }
      } catch (err) {
        console.warn('ADV_LP:manual_wmon_balance_failed_via_client', err);
      }

      // Fallback: raw JSON-RPC eth_call
      try {
        const callData = encodeFunctionData({
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address]
        });
        const resp = await fetch(DEFAULT_MONAD_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_call',
            params: [{ to: TOKEN_WMON_ADDRESS, data: callData }, 'latest'],
            id: 1
          })
        });
        const json = (await resp.json()) as { result?: string | null };
        const hex = json.result;
        if (hex && typeof hex === 'string' && hex.startsWith('0x')) {
          const bal = BigInt(hex);
          if (!cancelled) {
            setManualWmonBalance(bal);
          }
        }
      } catch (err) {
        console.warn('ADV_LP:manual_wmon_balance_failed_via_fetch', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, effectivePublicClient, wmonBalance.data?.value]);

  // Desktop-only: allow Privy login; button will be enabled once provider is present
  useEffect(() => {
    if (miniAppState !== 'desktop') return;
    setPrivyActivating(false);
  }, [miniAppState]);

  const handleCollect = useCallback(
    async (tokenId: string) => {
      if (!walletClient || !address) {
        setStatus('error');
        setStatusMessage('Connect a wallet on Monad first.');
        return;
      }
      setCollectStatus((prev) => ({ ...prev, [tokenId]: 'loading' }));
      setCollectError((prev) => ({ ...prev, [tokenId]: null }));
      try {
        const resp = await fetch('/api/lp-collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokenId, recipient: address })
        });
        if (!resp.ok) throw new Error(`collect_${resp.status}`);
        const { to, data, value } = (await resp.json()) as {
          to: string;
          data: `0x${string}`;
          value: string;
        };
        const hash = await walletClient.sendTransaction({
          to: to as `0x${string}`,
          data,
          value: BigInt(value ?? '0')
        });
        setCollectStatus((prev) => ({ ...prev, [tokenId]: 'success' }));
        setStatusMessage(`Collect tx sent: ${hash.slice(0, 10)}…`);
      } catch (err) {
        console.error('ADV_LP:collect_failed', err);
        setCollectStatus((prev) => ({ ...prev, [tokenId]: 'error' }));
        setCollectError((prev) => ({ ...prev, [tokenId]: 'Collect failed. Try again.' }));
      }
    },
    [walletClient, address]
  );

  const handleRemoveLiquidity = useCallback(
    async (tokenId: string) => {
      if (!walletClient || !address) {
        setStatus('error');
        setStatusMessage('Connect a wallet on Monad first.');
        return;
      }
      // Confirm with user
      const confirmed = window.confirm(
        'Remove all liquidity from this position?\n\nThis will withdraw your tokens and any uncollected fees. The position NFT will be burned.'
      );
      if (!confirmed) return;

      setRemoveStatus((prev) => ({ ...prev, [tokenId]: 'loading' }));
      setRemoveError((prev) => ({ ...prev, [tokenId]: null }));
      try {
        const resp = await fetch('/api/lp-remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenId,
            recipient: address,
            percentageToRemove: 100,
            burnToken: true
          })
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.message || `remove_${resp.status}`);
        }
        const { to, data, value } = (await resp.json()) as {
          to: string;
          data: `0x${string}`;
          value: string;
        };
        const hash = await walletClient.sendTransaction({
          to: to as `0x${string}`,
          data,
          value: BigInt(value ?? '0')
        });
        setRemoveStatus((prev) => ({ ...prev, [tokenId]: 'success' }));
        setStatusMessage(`Remove tx sent: ${hash.slice(0, 10)}… Position closed!`);
        // Refresh the positions list after successful removal
        setTimeout(() => {
          setLpList((prev) => prev.filter((p) => p.tokenId !== tokenId));
        }, 2000);
      } catch (err) {
        console.error('ADV_LP:remove_failed', err);
        setRemoveStatus((prev) => ({ ...prev, [tokenId]: 'error' }));
        setRemoveError((prev) => ({
          ...prev,
          [tokenId]: err instanceof Error ? err.message : 'Remove failed. Try again.'
        }));
      }
    },
    [walletClient, address]
  );

  const handleOpenLpManager = useCallback(async () => {
    const absolute =
      typeof window !== 'undefined'
        ? `${window.location.origin}/miniapp?lp=manager`
        : '/miniapp?lp=manager';
    if (miniAppState === 'miniapp') {
      // Stay in-place if already in the mini app; this avoids reload loops/access issues.
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.href = absolute;
    }
  }, [miniAppState]);

  const handlePrivyLogin = useCallback(async () => {
    try {
      setPrivyActivating(true);
      setPrivyError(null);
      await login();
    } catch {
      setPrivyError('Privy login failed.');
    } finally {
      setPrivyActivating(false);
    }
  }, [login]);

  // Desktop-only: fetch LP positions summary to view/collect (read-only here)
  useEffect(() => {
    if (miniAppState !== 'desktop') return;
    if (!address) return;
    let cancelled = false;
    const load = async () => {
      setLpListLoading(true);
      setLpListError(null);
      try {
        const resp = await fetch(`/api/lp-nft?address=${address}`);
        if (!resp.ok) throw new Error(`lp_nft_${resp.status}`);
        const data = (await resp.json()) as {
          lpPositions?: Array<{
            tokenId: string;
            bandType: string;
            rangeStatus: string;
            tickLower: number;
            tickUpper: number;
          }>;
        };
        if (cancelled) return;
        setLpList(
          (data.lpPositions ?? []).map((p) => ({
            tokenId: p.tokenId,
            bandType: p.bandType,
            rangeStatus: p.rangeStatus,
            tickLower: p.tickLower,
            tickUpper: p.tickUpper
          }))
        );
      } catch (err) {
        if (cancelled) return;
        console.warn('ADV_LP:lp_list_failed', err);
        setLpListError('Unable to load positions right now.');
      } finally {
        if (!cancelled) setLpListLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [miniAppState, address]);

  // Desktop-only: fetch fees for LP positions
  useEffect(() => {
    if (miniAppState !== 'desktop') return;
    if (!address) return;
    let cancelled = false;
    const loadFees = async () => {
      try {
        const resp = await fetch(`/api/lp-fees?address=${address}`);
        if (!resp.ok) throw new Error(`lp_fees_${resp.status}`);
        const data = (await resp.json()) as {
          positions?: Array<{
            tokenId: string;
            unclaimed: { token0: string; token1: string; usd?: number | null };
            lifetime: { token0: string; token1: string; usd?: number | null };
            token0?: { symbol?: string };
            token1?: { symbol?: string };
          }>;
        };
        if (cancelled) return;
        const next: typeof feeData = {};
        (data.positions ?? []).forEach((p) => {
          next[p.tokenId] = {
            unclaimedUsd: p.unclaimed?.usd ?? null,
            lifetimeUsd: p.lifetime?.usd ?? null,
            unclaimed0: p.unclaimed?.token0 ?? '0',
            unclaimed1: p.unclaimed?.token1 ?? '0',
            lifetime0: p.lifetime?.token0 ?? '0',
            lifetime1: p.lifetime?.token1 ?? '0',
            token0Symbol: p.token0?.symbol ?? 't0',
            token1Symbol: p.token1?.symbol ?? 't1'
          };
        });
        setFeeData(next);
      } catch (err) {
        if (cancelled) return;
        console.warn('ADV_LP:lp_fees_failed', err);
      }
    };
    void loadFees();
    return () => {
      cancelled = true;
    };
  }, [miniAppState, address, feeData]);

  // Previously gated mini-app access to ADMIN_FID only; now allow all mini-app users to proceed.
  // We still show a brief loading state while detecting, but do not block access by FID.
  if (miniAppState === 'unknown') {
    return renderShell(
      <section className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
        <p className="pixel-font text-xs tracking-[0.4em] text-[var(--moss-green)] uppercase">
          ACCESS CHECK
        </p>
        <article className="lunar-card max-w-md space-y-2">
          <p className="text-xl font-semibold">Calibrating lab access…</p>
          <p className="text-sm text-white/70">Hold tight while we verify your session.</p>
        </article>
      </section>
    );
  }

  return renderShell(
    <>
      <header className="space-y-3 text-center">
        <p className="pixel-font text-xs tracking-[0.4em] text-[var(--moss-green)] uppercase">
          ADVANCED LP
        </p>
        <div className="flex items-center justify-center gap-3">
          <h1 className="text-3xl sm:text-4xl font-semibold">Custom LP Planner</h1>
          <Link
            href="/lp-advanced/help"
            className="w-8 h-8 rounded-full border border-white/20 text-white/80 flex items-center justify-center text-sm hover:bg-white/10"
            aria-label="Open Advanced LP guide"
          >
            ?
          </Link>
        </div>
        <div className="flex flex-wrap gap-3 justify-center text-xs text-white/70">
          <Link
            href="/miniapp"
            className="px-3 py-1 rounded-full border border-white/15 hover:bg-white/10 transition"
          >
            ← Back to Home
          </Link>
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <div className="relative">
            <p
              className="absolute -left-8 top-[60%] -translate-y-1/2 -rotate-90 text-xs tracking-[0.2em] text-[#fdd65b] origin-center whitespace-nowrap hidden sm:block font-bold z-20"
              style={{ textShadow: '0 0 10px rgba(253, 214, 91, 0.5)' }}
            >
              Price of m00n
            </p>
            <div className="mt-12">
              <RangeChart
                series={chartSeries}
                currentUsd={moonMarketCapUsd}
                lowerUsd={rangeMin}
                upperUsd={rangeMax}
              />
            </div>
          </div>
          <p className="text-xs text-white/60 text-center max-w-lg mx-auto">
            Yellow trace = simulated m00n market cap. The ribbon highlights the USD range you are
            LPing into.
          </p>

          <article className="lunar-card space-y-3">
            <div className="flex items-center justify-between">
              <p className="lunar-heading">Wallet status</p>
              {isConnected && miniAppState !== 'miniapp' && (
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="text-[10px] px-3 py-1 border border-white/15 rounded-full uppercase tracking-[0.3em] hover:bg-white/10"
                >
                  Disconnect
                </button>
              )}
            </div>
            {isConnected && address ? (
              <>
                <p className="font-semibold text-lg">{`${address.slice(0, 6)}…${address.slice(-4)}`}</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="opacity-60">m00n balance</p>
                    <p className="font-mono text-lg">
                      {moonBalance.data ? moonBalanceDisplay : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="opacity-60">W-MON balance</p>
                    <p className="font-mono text-lg">
                      {manualWmonBalance !== null || wmonBalance.data ? wmonBalanceDisplay : '—'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleSwapToken('moon')}
                    disabled={swapInFlight === 'moon'}
                    className="flex-1 rounded-xl border border-[var(--monad-purple)] px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-[var(--monad-purple)] hover:bg-[var(--monad-purple)] hover:text-black transition-colors disabled:opacity-50"
                  >
                    {swapInFlight === 'moon' ? 'Opening…' : 'Buy m00n'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwapToken('wmon')}
                    disabled={swapInFlight === 'wmon'}
                    className="flex-1 rounded-xl border border-white/40 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    {swapInFlight === 'wmon' ? 'Opening…' : 'Buy W-MON'}
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-white/70">
                  Connect a wallet capable of signing on Monad.
                </p>
                {miniAppState === 'miniapp' ? (
                  <button
                    type="button"
                    onClick={handleMiniAppConnect}
                    className="px-4 py-2 border border-[var(--moss-green)] text-[var(--moss-green)] rounded-full text-sm hover:bg-[var(--moss-green)] hover:text-black transition disabled:opacity-40"
                  >
                    Connect Farcaster wallet
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handlePrivyLogin}
                      disabled={privyActivating}
                      className="px-4 py-2 border border-white/40 rounded-full text-sm hover:bg-white/10 transition disabled:opacity-50"
                    >
                      {privyActivating ? 'Connecting…' : 'Connect with Privy'}
                    </button>
                    <div className="flex flex-wrap gap-3">
                      {connectors.map((connector) => (
                        <button
                          key={connector.id}
                          onClick={() => connect({ connector })}
                          className="px-4 py-2 border border-white/20 rounded-full text-sm hover:bg-white/10 transition disabled:opacity-40"
                          disabled={!connector.ready || isPending}
                        >
                          {connector.name}
                          {isPending && '…'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {privyError && <p className="text-sm text-red-300">{privyError}</p>}
                {connectError && <p className="text-sm text-red-300">{connectError.message}</p>}
                {miniAppConnectError && (
                  <p className="text-sm text-red-300">{miniAppConnectError}</p>
                )}
              </div>
            )}
          </article>
        </div>

        <div className="space-y-6">
          <div>
            <label className="lunar-heading text-[var(--moss-green)] text-lg block mb-4">
              Input LP
            </label>
            <div className="space-y-4">
              <button
                type="button"
                className="flex items-start gap-3 w-full text-left group"
                onClick={() => {
                  setBandSide('single');
                  setRangeTouched(false);
                }}
              >
                <div
                  className={`mt-1 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                    bandSide === 'single'
                      ? 'border-white bg-white'
                      : 'border-white/40 group-hover:border-white'
                  }`}
                >
                  {bandSide === 'single' && <div className="w-2 h-2 rounded-full bg-black" />}
                </div>
                <div>
                  <p className="font-bold text-sm uppercase tracking-wider">single sided</p>
                  <p className="text-xs text-white/50 font-mono mt-1">
                    (requires only m00n or wmon)
                  </p>
                </div>
              </button>

              <button
                type="button"
                className="flex items-start gap-3 w-full text-left group"
                onClick={() => {
                  setBandSide('double');
                  setRangeTouched(false);
                }}
              >
                <div
                  className={`mt-1 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                    bandSide === 'double'
                      ? 'border-white bg-white'
                      : 'border-white/40 group-hover:border-white'
                  }`}
                >
                  {bandSide === 'double' && <div className="w-2 h-2 rounded-full bg-black" />}
                </div>
                <div>
                  <p className="font-bold text-sm uppercase tracking-wider">double-sided</p>
                  <p className="text-xs text-white/50 font-mono mt-1">
                    (requires both m00n + wmon depending on range set)
                  </p>
                </div>
              </button>
            </div>
          </div>

          <div className="border border-red-500 bg-red-500/10 p-4 text-center space-y-1 relative overflow-hidden">
            <div
              className={`absolute inset-0 bg-red-500/5 pointer-events-none ${marketLoading ? 'animate-pulse' : ''}`}
            />
            <p className="relative text-[9px] uppercase tracking-widest text-red-300 font-semibold">
              Current m00n market cap (USD)
            </p>
            {marketError ? (
              <p className="relative text-xs text-red-300 py-2">Telemetry unavailable</p>
            ) : (
              <>
                <p className="relative text-2xl font-mono text-white drop-shadow-lg">
                  {marketLoading && !moonMarketCapUsd ? 'Syncing…' : formatUsd(moonMarketCapUsd)}
                </p>
                {marketState && (
                  <p className="relative text-[10px] text-white/40 font-mono">
                    Tick: {marketState.tick}
                  </p>
                )}
              </>
            )}
          </div>

          {bandSide === 'single' && (
            <div className="flex gap-2 justify-center text-xs mt-4">
              <button
                className={`px-3 py-1 border ${
                  depositAsset === 'moon'
                    ? 'border-[var(--moss-green)] text-[var(--moss-green)]'
                    : 'border-white/20 text-white/40'
                }`}
                onClick={() => setDepositAsset('moon')}
              >
                Input m00n
              </button>
              <button
                className={`px-3 py-1 border ${
                  depositAsset === 'wmon'
                    ? 'border-[var(--moss-green)] text-[var(--moss-green)]'
                    : 'border-white/20 text-white/40'
                }`}
                onClick={() => setDepositAsset('wmon')}
              >
                Input WMON
              </button>
            </div>
          )}

          <div className="space-y-2">
            <label className="lunar-heading text-white/80 text-center block">set range</label>
            <div className="space-y-3 p-4 border border-[#4a6bfa] bg-transparent">
              <div className="flex items-center justify-between gap-4">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={rangeLowerUsd}
                  onChange={(event) => {
                    setRangeLowerUsd(event.target.value);
                    setRangeTouched(true);
                  }}
                  className="flex-1 bg-white text-black py-2 px-3 text-right font-mono font-bold focus:outline-none"
                  placeholder="0.00"
                />
                <span className="text-xs text-white w-8 font-bold">usd</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={rangeUpperUsd}
                  onChange={(event) => {
                    setRangeUpperUsd(event.target.value);
                    setRangeTouched(true);
                  }}
                  className="flex-1 bg-white text-black py-2 px-3 text-right font-mono font-bold focus:outline-none"
                  placeholder="0.00"
                />
                <span className="text-xs text-white w-8 font-bold">usd</span>
              </div>
            </div>
            {rangeError && <p className="text-xs text-red-300 text-center">{rangeError}</p>}
          </div>

          {/* Risk / Volatility Panel (Desktop Only) */}
          {miniAppState === 'desktop' && (
            <div className="space-y-3 p-4 border border-white/10 bg-white/5 rounded-xl">
              <div className="flex items-center justify-between">
                <h3 className="lunar-heading text-white/80 text-sm">Range Check</h3>
                <button
                  type="button"
                  onClick={handleFetchVolatility}
                  disabled={volFetchStatus === 'loading' || volFetchCooldown > 0}
                  className="text-[10px] px-2 py-1 border border-white/20 text-white/70 hover:border-[var(--moss-green)] hover:text-[var(--moss-green)] transition disabled:opacity-50"
                >
                  {volFetchStatus === 'loading'
                    ? 'Checking…'
                    : volFetchCooldown > 0
                      ? `${volFetchCooldown}s`
                      : '↻ Refresh Vol'}
                </button>
              </div>

              {/* Warning if using defaults */}
              {volFetchStatus === 'idle' && (
                <p className="text-[10px] text-amber-400 text-center">
                  ⚠ Using default 100% vol — click Refresh to get actual volatility
                </p>
              )}

              {/* Main Verdict */}
              {riskMetrics ? (
                <div className="space-y-3">
                  {/* Verdict Box */}
                  {riskMetrics.probStay !== null ? (
                    <div
                      className={`p-3 rounded-lg text-center ${
                        riskMetrics.probStay > 0.5
                          ? 'bg-emerald-500/20 border border-emerald-500/40'
                          : riskMetrics.probStay > 0.2
                            ? 'bg-amber-500/20 border border-amber-500/40'
                            : 'bg-red-500/20 border border-red-500/40'
                      }`}
                    >
                      <p
                        className={`text-lg font-bold ${
                          riskMetrics.probStay > 0.5
                            ? 'text-emerald-400'
                            : riskMetrics.probStay > 0.2
                              ? 'text-amber-400'
                              : 'text-red-400'
                        }`}
                      >
                        {riskMetrics.probStay > 0.5
                          ? '✓ Good Range'
                          : riskMetrics.probStay > 0.2
                            ? '⚠ Risky Range'
                            : '✗ Too Narrow'}
                      </p>
                      <p className="text-xs text-white/70 mt-1">
                        {riskMetrics.probStay > 0.5
                          ? `${(riskMetrics.probStay * 100).toFixed(0)}% chance to stay in range over ${riskMetrics.days}d`
                          : riskMetrics.probStay > 0.2
                            ? `Only ${(riskMetrics.probStay * 100).toFixed(0)}% chance to stay in range`
                            : `< ${Math.max(1, riskMetrics.probStay * 100).toFixed(0)}% chance — price will likely exit quickly`}
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg text-center bg-white/5 border border-white/10">
                      <p className="text-white/60 text-sm">Set volatility to see range analysis</p>
                    </div>
                  )}

                  {/* Key Stats */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-black/30 p-2 rounded">
                      <p className="text-white/50 text-[10px]">Your Range</p>
                      <p className="font-mono text-white">
                        {riskMetrics.pctLower >= 0 ? '+' : ''}
                        {riskMetrics.pctLower.toFixed(0)}% to {riskMetrics.pctUpper >= 0 ? '+' : ''}
                        {riskMetrics.pctUpper.toFixed(0)}%
                      </p>
                    </div>
                    <div className="bg-black/30 p-2 rounded">
                      <p className="text-white/50 text-[10px]">
                        Expected Swing ({riskMetrics.days}d)
                      </p>
                      <p className="font-mono text-white">
                        ±{riskMetrics.expMovePct ? riskMetrics.expMovePct.toFixed(0) : '--'}%
                      </p>
                    </div>
                  </div>

                  {/* Suggestion */}
                  {riskMetrics.probStay !== null &&
                    riskMetrics.probStay < 0.5 &&
                    riskMetrics.suggestedRange && (
                      <div className="text-[11px] text-white/60 bg-black/20 p-2 rounded">
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            <span className="text-amber-400">💡</span> Try{' '}
                            <span className="text-white font-mono">
                              {riskMetrics.suggestedRange.lower.toFixed(0)}% to +
                              {riskMetrics.suggestedRange.upper.toFixed(0)}%
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (riskMetrics.suggestedRange && riskMetrics.spotMcap) {
                                const newLower =
                                  riskMetrics.spotMcap *
                                  (1 + riskMetrics.suggestedRange.lower / 100);
                                const newUpper =
                                  riskMetrics.spotMcap *
                                  (1 + riskMetrics.suggestedRange.upper / 100);
                                setRangeLowerUsd(Math.max(100, newLower).toFixed(0));
                                setRangeUpperUsd(newUpper.toFixed(0));
                                setRangeTouched(true);
                              }
                            }}
                            className="px-2 py-0.5 bg-amber-500/30 hover:bg-amber-500/50 text-amber-300 text-[10px] rounded transition"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    )}

                  {/* Collapsible Advanced */}
                  <details className="text-[10px]">
                    <summary className="text-white/40 cursor-pointer hover:text-white/60">
                      Advanced settings
                    </summary>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div className="space-y-1">
                        <label className="text-white/50 block text-center">Vol %</label>
                        <input
                          type="number"
                          min="1"
                          max="9999"
                          value={sigmaStay}
                          onChange={(e) => setSigmaStay(e.target.value)}
                          className="w-full bg-black/60 border border-white/20 text-white py-1 px-2 text-center font-mono focus:outline-none focus:border-[var(--moss-green)]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-white/50 block text-center">Fwd Vol %</label>
                        <input
                          type="number"
                          min="1"
                          max="9999"
                          value={sigmaFwd}
                          onChange={(e) => setSigmaFwd(e.target.value)}
                          className="w-full bg-black/60 border border-white/20 text-white py-1 px-2 text-center font-mono focus:outline-none focus:border-[var(--moss-green)]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-white/50 block text-center">Days</label>
                        <input
                          type="number"
                          min="1"
                          max="365"
                          value={horizonDays}
                          onChange={(e) => setHorizonDays(e.target.value)}
                          className="w-full bg-black/60 border border-white/20 text-white py-1 px-2 text-center font-mono focus:outline-none focus:border-[var(--moss-green)]"
                        />
                      </div>
                    </div>
                    {volFetchMessage && (
                      <p
                        className={`mt-2 ${volFetchStatus === 'error' ? 'text-amber-400' : 'text-[var(--moss-green)]'}`}
                      >
                        {volFetchMessage}
                      </p>
                    )}
                  </details>
                </div>
              ) : (
                <p className="text-xs text-white/50 text-center py-2">
                  Set your range bounds above to check if it&apos;s wide enough.
                </p>
              )}
            </div>
          )}

          {/* Compact Range Check for Mini-App */}
          {miniAppState !== 'desktop' && riskMetrics && riskMetrics.probStay !== null && (
            <div
              className={`p-3 rounded-lg ${
                riskMetrics.probStay > 0.5
                  ? 'bg-emerald-500/20 border border-emerald-500/40'
                  : riskMetrics.probStay > 0.2
                    ? 'bg-amber-500/20 border border-amber-500/40'
                    : 'bg-red-500/20 border border-red-500/40'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <p
                  className={`text-sm font-bold ${
                    riskMetrics.probStay > 0.5
                      ? 'text-emerald-400'
                      : riskMetrics.probStay > 0.2
                        ? 'text-amber-400'
                        : 'text-red-400'
                  }`}
                >
                  {riskMetrics.probStay > 0.5
                    ? '✓ Good Range'
                    : riskMetrics.probStay > 0.2
                      ? '⚠ Risky'
                      : '✗ Too Narrow'}
                </p>
                <button
                  type="button"
                  onClick={handleFetchVolatility}
                  disabled={volFetchStatus === 'loading' || volFetchCooldown > 0}
                  className="text-[9px] px-2 py-0.5 border border-white/30 text-white/70 rounded disabled:opacity-50"
                >
                  {volFetchStatus === 'loading'
                    ? '...'
                    : volFetchCooldown > 0
                      ? `${volFetchCooldown}s`
                      : '↻ Vol'}
                </button>
              </div>
              <p className="text-[10px] text-white/60 text-center">
                {riskMetrics.probStay > 0.5
                  ? `${(riskMetrics.probStay * 100).toFixed(0)}% stay chance`
                  : riskMetrics.probStay > 0.2
                    ? `${(riskMetrics.probStay * 100).toFixed(0)}% stay — consider wider`
                    : 'Price will likely exit fast'}
              </p>
              <p className="text-[9px] text-white/40 text-center mt-0.5">
                {volFetchStatus === 'success'
                  ? `Using ${Number(sigmaStay).toFixed(0)}% chain vol`
                  : `Default ${Number(sigmaStay).toFixed(0)}% vol — tap ↻`}
              </p>
              {/* Apply Suggested Range for mini-app */}
              {riskMetrics.probStay < 0.5 && riskMetrics.suggestedRange && (
                <div className="flex items-center justify-center gap-2 mt-2 pt-2 border-t border-white/10">
                  <span className="text-[10px] text-white/60">
                    💡 Try{' '}
                    <span className="font-mono text-white">
                      {riskMetrics.suggestedRange.lower.toFixed(0)}% to +
                      {riskMetrics.suggestedRange.upper.toFixed(0)}%
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (riskMetrics.suggestedRange && riskMetrics.spotMcap) {
                        const newLower =
                          riskMetrics.spotMcap * (1 + riskMetrics.suggestedRange.lower / 100);
                        const newUpper =
                          riskMetrics.spotMcap * (1 + riskMetrics.suggestedRange.upper / 100);
                        setRangeLowerUsd(Math.max(100, newLower).toFixed(0));
                        setRangeUpperUsd(newUpper.toFixed(0));
                        setRangeTouched(true);
                      }
                    }}
                    className="px-2 py-0.5 bg-amber-500/30 hover:bg-amber-500/50 text-amber-300 text-[10px] rounded transition"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="lunar-heading text-white/80 text-center block">amount</label>
            <div className="space-y-3">
              <div className="flex items-center justify-end gap-4">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={
                    bandSide === 'single'
                      ? depositAsset === 'moon'
                        ? singleAmount
                        : ''
                      : doubleMoonAmount
                  }
                  disabled={bandSide === 'single' && depositAsset !== 'moon'}
                  onChange={(e) => {
                    if (bandSide === 'single') setSingleAmount(e.target.value);
                    else updateDoubleSidedAmounts('moon', e.target.value);
                  }}
                  className="w-2/3 bg-white text-black py-2 px-3 text-right font-mono font-bold focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed disabled:bg-white/50"
                  placeholder="0"
                />
                <span className="text-xs text-white w-12 font-bold">m00n</span>
              </div>

              <div className="flex items-center justify-end gap-4">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={
                    bandSide === 'single'
                      ? depositAsset === 'wmon'
                        ? singleAmount
                        : ''
                      : doubleWmonAmount
                  }
                  disabled={bandSide === 'single' && depositAsset !== 'wmon'}
                  onChange={(e) => {
                    if (bandSide === 'single') setSingleAmount(e.target.value);
                    else updateDoubleSidedAmounts('wmon', e.target.value);
                  }}
                  className="w-2/3 bg-white text-black py-2 px-3 text-right font-mono font-bold focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed disabled:bg-white/50"
                  placeholder="0"
                />
                <span className="text-xs text-white w-12 font-bold">wmon</span>
              </div>
            </div>

            <p className="text-[10px] text-white/60 leading-relaxed border border-white/20 p-2 mt-4">
              the amount will calculate the other side based on the range set; depending on the
              range we disable one or the other, or allow a user to input one and calculate the
              other required for a double sided position.
            </p>
          </div>

          <div className="pt-4 space-y-2 sticky bottom-0 bg-black/85 backdrop-blur border-t border-white/10 px-3 pb-4 md:static md:bg-transparent md:border-0 md:px-0 md:pb-0">
            {approvalMessage && (
              <p className="text-xs text-amber-300 text-center">{approvalMessage}</p>
            )}
            <button
              type="button"
              onClick={handleDeploy}
              disabled={!isConnected || status === 'building'}
              className="w-full cta-primary text-sm py-4 disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {status === 'building' ? 'DEPLOYING…' : 'DEPLOY BAND'}
            </button>
            {statusMessage && (
              <p
                className={`text-xs text-center ${status === 'error' ? 'text-red-300' : 'text-[var(--moss-green)]'}`}
              >
                {statusMessage}
              </p>
            )}
            {(requiredMoonWei || requiredWmonWei) && (
              <div className="text-[11px] text-white/70 text-center space-y-1">
                <p className="uppercase tracking-[0.2em] text-white/60">Required amounts</p>
                {requiredMoonWei && (
                  <p className="font-mono">
                    m00n: {formatTokenBalance(BigInt(requiredMoonWei), 18)}
                  </p>
                )}
                {requiredWmonWei && (
                  <p className="font-mono">
                    WMON: {formatTokenBalance(BigInt(requiredWmonWei), 18)}
                  </p>
                )}
              </div>
            )}
            {txHash && (
              <div className="flex flex-col gap-2 items-center">
                <a
                  href={`https://monadscan.com/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-center text-[10px] text-white/50 underline"
                >
                  View on Monadscan
                </a>
                {status === 'success' && (
                  <button
                    type="button"
                    onClick={async () => {
                      const baseUrl =
                        typeof window !== 'undefined'
                          ? window.location.origin
                          : 'https://m00nad.vercel.app';

                      const currentMcap = moonMarketCapUsd ?? 0;

                      // Classify band type based on position type and range
                      let bandType: 'crash_band' | 'upside_band' | 'double_sided' = 'double_sided';

                      if (bandSide === 'single') {
                        // Single-sided: crash band if WMON only (below current), sky band if m00n only (above current)
                        if (depositAsset === 'wmon') {
                          bandType = 'crash_band'; // Betting on price drop
                        } else {
                          bandType = 'upside_band'; // Betting on price rise
                        }
                      } else {
                        // Double-sided: both tokens deposited
                        bandType = 'double_sided';
                      }

                      const bandEmoji =
                        bandType === 'crash_band' ? '🔻' : bandType === 'upside_band' ? '🚀' : '⚖️';

                      // Calculate position value in USD from deposit amounts
                      const wmonPrice = marketState?.wmonUsdPrice ?? 0;
                      const moonPrice = moonSpotPriceUsd ?? 0;
                      let positionValueUsd = 0;

                      if (bandSide === 'single') {
                        const amt = Number(singleAmount) || 0;
                        positionValueUsd =
                          depositAsset === 'moon' ? amt * moonPrice : amt * wmonPrice;
                        console.log('SHARE_CALC:single', {
                          depositAsset,
                          amt,
                          moonPrice,
                          wmonPrice,
                          positionValueUsd
                        });
                      } else {
                        const moonAmt = Number(doubleMoonAmount) || 0;
                        const wmonAmt = Number(doubleWmonAmount) || 0;
                        positionValueUsd = moonAmt * moonPrice + wmonAmt * wmonPrice;
                        console.log('SHARE_CALC:double', {
                          moonAmt,
                          wmonAmt,
                          moonPrice,
                          wmonPrice,
                          positionValueUsd
                        });
                      }

                      // Get username - fallback to fid
                      const displayUsername =
                        viewerUsername || (viewerFid ? `fid:${viewerFid}` : 'anon');

                      // Build share URL with position data for OG image
                      const shareParams = new URLSearchParams({
                        bandType,
                        rangeStatus: 'in-range',
                        rangeLower: String(Math.round(Number(rangeLowerUsd) || 0)),
                        rangeUpper: String(Math.round(Number(rangeUpperUsd) || 0)),
                        username: displayUsername,
                        ...(positionValueUsd > 0 ? { valueUsd: positionValueUsd.toFixed(2) } : {})
                      });
                      const shareUrl = `${baseUrl}/share/position/new?${shareParams.toString()}`;

                      const shareText = `${bandEmoji} Just deployed a $m00n LP position!

Range: $${Number(rangeLowerUsd).toLocaleString()} → $${Number(rangeUpperUsd).toLocaleString()}

Join the $m00n cabal 🌙`;

                      try {
                        await sdk.actions.composeCast({
                          text: shareText,
                          embeds: [shareUrl]
                        });
                      } catch (err) {
                        console.error('SHARE_DEPLOY:failed', err);
                      }
                    }}
                    className="px-4 py-1.5 border border-[#8c54ff]/50 text-[#8c54ff] rounded-full text-[11px] hover:bg-[#8c54ff]/10 transition"
                  >
                    SHARE 🌙
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {miniAppState === 'desktop' && (
            <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Your LP positions</h2>
                {lpListLoading && <span className="text-[11px] text-white/60">Loading…</span>}
              </div>
              {lpListError && <p className="text-xs text-red-300">{lpListError}</p>}
              {!lpListLoading && lpList.length === 0 && !lpListError && (
                <p className="text-xs text-white/70">No positions found for this wallet.</p>
              )}
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {lpList.map((p) => {
                  const state = collectStatus[p.tokenId] ?? 'idle';
                  const err = collectError[p.tokenId];
                  const fees = feeData[p.tokenId];
                  return (
                    <div
                      key={p.tokenId}
                      className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white space-y-1"
                    >
                      <div className="flex justify-between">
                        <span className="font-mono text-white/90">#{p.tokenId}</span>
                        <span className="uppercase tracking-[0.2em] text-[10px] text-[var(--moss-green)]">
                          {p.bandType.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex justify-between text-white/70">
                        <span>Range</span>
                        <span>
                          {p.tickLower} → {p.tickUpper}
                        </span>
                      </div>
                      <div className="flex justify-between text-white/70">
                        <span>Status</span>
                        <span>{p.rangeStatus}</span>
                      </div>
                      {fees && (
                        <div className="space-y-1 text-white/70">
                          <div className="flex justify-between">
                            <span>Unclaimed</span>
                            <span>
                              {fees.unclaimed0} {fees.token0Symbol} / {fees.unclaimed1}{' '}
                              {fees.token1Symbol}
                            </span>
                          </div>
                          {fees.unclaimedUsd !== null && (
                            <div className="flex justify-between">
                              <span>Unclaimed (USD)</span>
                              <span className="text-[var(--moss-green)]">
                                ~{formatUsd(fees.unclaimedUsd)}
                              </span>
                            </div>
                          )}
                          {fees.lifetimeUsd !== null && (
                            <div className="flex justify-between text-white/60">
                              <span>Lifetime fees (USD)</span>
                              <span>{formatUsd(fees.lifetimeUsd)}</span>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleCollect(p.tokenId)}
                          disabled={state === 'loading' || !isConnected}
                          className="px-3 py-1 rounded-full border border-[var(--moss-green)] text-[var(--moss-green)] hover:bg-[var(--moss-green)] hover:text-black transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {state === 'loading' ? 'Collecting…' : 'Collect'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveLiquidity(p.tokenId)}
                          disabled={
                            (removeStatus[p.tokenId] ?? 'idle') === 'loading' || !isConnected
                          }
                          className="px-3 py-1 rounded-full border border-red-400 text-red-400 hover:bg-red-400 hover:text-black transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {(removeStatus[p.tokenId] ?? 'idle') === 'loading'
                            ? 'Removing…'
                            : 'Remove'}
                        </button>
                        <div className="flex-1 text-right">
                          {state === 'success' && (
                            <span className="text-[10px] text-[var(--moss-green)]">✓</span>
                          )}
                          {state === 'error' && err && (
                            <span className="text-[10px] text-red-300" title={err}>
                              Error
                            </span>
                          )}
                          {(removeStatus[p.tokenId] ?? 'idle') === 'success' && (
                            <span className="text-[10px] text-[var(--moss-green)]">Removed!</span>
                          )}
                          {(removeStatus[p.tokenId] ?? 'idle') === 'error' && (
                            <span
                              className="text-[10px] text-red-300"
                              title={removeError[p.tokenId] ?? ''}
                            >
                              Failed
                            </span>
                          )}
                        </div>
                      </div>
                      {err && <p className="text-[10px] text-red-300">{err}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3">
            <h2 className="text-sm font-semibold text-white">Status</h2>
            <p className="text-xs text-white/70">{statusMessage ?? 'Ready to deploy.'}</p>
            {txHash && (
              <a
                href={`https://monadscan.com/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-[var(--moss-green)] underline"
              >
                View last tx on Monadscan
              </a>
            )}
          </div>
        </div>
      </section>

      <footer className="text-center text-xs text-white/60 space-y-2">
        <p>Need an exotic preset or want us to deploy on your behalf? Ping @m00npapi.eth.</p>
        <p>
          <Link href="/lp-advanced/help" className="underline hover:text-white">
            LP Guide
          </Link>
          {' • '}
          <span className="opacity-60">m00nad.vercel.app</span>
        </p>
      </footer>
    </>
  );
}
