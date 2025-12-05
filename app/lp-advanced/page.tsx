'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  WagmiProvider,
  createConfig,
  http,
  useAccount,
  useConnect,
  useDisconnect,
  useWalletClient,
  useBalance
} from 'wagmi';
import { farcasterMiniApp as miniAppConnector } from '@farcaster/miniapp-wagmi-connector';
import { metaMask, injected, coinbaseWallet } from 'wagmi/connectors';
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

const TOKEN_MOON_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07' as const;
const TOKEN_WMON_ADDRESS = '0x3bd359C1119dA7Da1d913d1C4D2b7C461115433A' as const;
const ADMIN_FID = 9933;

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

const connectors =
  typeof window === 'undefined'
    ? []
    : ([
        miniAppConnector(),
        metaMask(),
        injected({ shimDisconnect: true }),
        coinbaseWallet({
          appName: 'm00n advanced LP',
          jsonRpcUrl: monadChain.rpcUrls.default.http[0]!
        })
      ] as const);

const wagmiConfig = createConfig({
  chains: [monadChain],
  connectors,
  transports: {
    [monadChain.id]: http(monadChain.rpcUrls.default.http[0]!)
  }
});

const queryClient = new QueryClient();
const MINIAPP_CONNECTOR_ID = 'farcasterMiniApp';

const TICK_SPACING = 200;
const HISTORY_POINTS = 48;
const MOON_CIRC_SUPPLY = 95_000_000_000; // total m00n circulating supply used for market-cap math

const snapDownToSpacing = (tick: number) => Math.floor(tick / TICK_SPACING) * TICK_SPACING;
const snapUpToSpacing = (tick: number) => Math.ceil(tick / TICK_SPACING) * TICK_SPACING;
const tickToPrice = (tick: number) => Math.pow(1.0001, tick);
const priceToTick = (price: number) => Math.log(price) / Math.log(1.0001);

function formatTokenBalance(value?: bigint, decimals = 18) {
  if (value === undefined) return '0';
  const numeric = Number(formatUnits(value, decimals));
  if (!Number.isFinite(numeric)) return '0';
  if (numeric >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(1)}B`;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000_000) return `${numeric.toFixed(1)}M`;
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
          <circle cx={spotX} cy={spotY} r={6} fill="#fdd65b" stroke="none" />
        </g>
      )}
    </svg>
  );
}

export default function LpAdvancedPage() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AdvancedLpContent />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function AdvancedLpContent() {
  const [miniAppState, setMiniAppState] = useState<'unknown' | 'desktop' | 'miniapp'>('unknown');
  const [viewerFid, setViewerFid] = useState<number | null>(null);
  const [miniAppError, setMiniAppError] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const { connect, connectors, error: connectError, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();

  const moonBalance = useBalance({
    address,
    token: TOKEN_MOON_ADDRESS
  });
  const wmonBalance = useBalance({
    address,
    token: TOKEN_WMON_ADDRESS
  });

  const [bandSide, setBandSide] = useState<BandSide>('single');
  const [depositAsset, setDepositAsset] = useState<DepositAsset>('moon');
  const [rangeLowerUsd, setRangeLowerUsd] = useState('');
  const [rangeUpperUsd, setRangeUpperUsd] = useState('');
  const [rangeTouched, setRangeTouched] = useState(false);
  const [singleAmount, setSingleAmount] = useState('');
  const [doubleMoonAmount, setDoubleMoonAmount] = useState('');
  const [doubleWmonAmount, setDoubleWmonAmount] = useState('');
  const [status, setStatus] = useState<DeployState>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [requiredMoonWei, setRequiredMoonWei] = useState<string | null>(null);
  const [requiredWmonWei, setRequiredWmonWei] = useState<string | null>(null);
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
          const context = await sdk.context;
          if (!cancelled) {
            setViewerFid(context.user?.fid ?? null);
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
  }, []);

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

    // Seed defaults: double-sided = ±20%; single-sided m00n = 2–8% above; single-sided WMON = 2–8% below.
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

      const priceLowerWmon = rangeMin / MOON_CIRC_SUPPLY / marketState.wmonUsdPrice;
      const priceUpperWmon = rangeMax / MOON_CIRC_SUPPLY / marketState.wmonUsdPrice;
      const priceCurrentWmon = tickToPrice(marketState.tick);

      // Spot below range -> Only m00n needed
      if (priceCurrentWmon < priceLowerWmon) {
        if (changedSide === 'moon') setDoubleWmonAmount('0');
        // If user types WMON, m00n would be infinite/undefined, so we leave it
        return;
      }
      // Spot above range -> Only WMON needed
      if (priceCurrentWmon > priceUpperWmon) {
        if (changedSide === 'wmon') setDoubleMoonAmount('0');
        return;
      }

      // In range -> Calculate ratio
      const sqrtP = Math.sqrt(priceCurrentWmon);
      const sqrtPa = Math.sqrt(priceLowerWmon);
      const sqrtPb = Math.sqrt(priceUpperWmon);

      const numerator = sqrtP * sqrtPb * (sqrtP - sqrtPa);
      const denominator = sqrtPb - sqrtP;
      if (denominator <= 0) return;

      const ratio = numerator / denominator; // amount1 / amount0

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

      const lowerPriceUsd = rangeMin / MOON_CIRC_SUPPLY;
      const upperPriceUsd = rangeMax / MOON_CIRC_SUPPLY;
      if (!Number.isFinite(lowerPriceUsd) || !Number.isFinite(upperPriceUsd)) {
        throw new Error('invalid_market_cap_range');
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

      const hash = await walletClient.sendTransaction({
        account: address,
        to,
        data,
        value: value ? BigInt(value) : undefined,
        chain: walletClient.chain ?? undefined
      });

      setStatus('success');
      setStatusMessage('Transaction submitted. View on Monadscan below.');
      setTxHash(hash);
    } catch (error) {
      console.error('ADVANCED_LP_DEPLOY', error);
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'Unable to deploy band right now.');
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
    depositAsset
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
  const wmonBalanceDisplay = formatTokenBalance(
    wmonBalance.data?.value,
    wmonBalance.data?.decimals
  );

  if (miniAppState === 'unknown') {
    return renderShell(
      <section className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
        <p className="pixel-font text-xs tracking-[0.4em] text-[var(--moss-green)] uppercase">
          ACCESS CHECK
        </p>
        <article className="lunar-card max-w-md space-y-2">
          <p className="text-xl font-semibold">Calibrating lab access…</p>
          <p className="text-sm text-white/70">
            Hold tight while we verify whether you&apos;re inside the mini app.
          </p>
        </article>
      </section>
    );
  }

  if (miniAppState === 'miniapp' && viewerFid === null) {
    return renderShell(
      <section className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
        <p className="pixel-font text-xs tracking-[0.4em] text-[var(--moss-green)] uppercase">
          ACCESS CHECK
        </p>
        <article className="lunar-card max-w-md space-y-2">
          <p className="text-xl font-semibold">Need Farcaster context</p>
          <p className="text-sm text-white/70">
            {miniAppError ??
              'We need your FID before unlocking the LP Lab. Reload inside Warpcast or open this page in a browser.'}
          </p>
        </article>
      </section>
    );
  }

  if (miniAppState === 'miniapp' && viewerFid !== ADMIN_FID) {
    return renderShell(
      <section className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
        <p className="pixel-font text-xs tracking-[0.4em] text-[var(--moss-green)] uppercase">
          RESTRICTED
        </p>
        <article className="lunar-card max-w-lg space-y-3">
          <p className="text-2xl font-semibold">LP Lab locked inside the mini app</p>
          <p className="text-sm text-white/70">
            Advanced deployments are only available to the cabal operator (FID {ADMIN_FID}) when
            launched inside Warpcast. Open this page in a desktop browser to experiment, or ping
            @m00npapi.eth for help.
          </p>
          <a
            href="https://m00nad.vercel.app/lp-advanced"
            target="_blank"
            rel="noreferrer"
            className="cta-ghost inline-flex justify-center text-xs"
          >
            Open in browser
          </a>
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
        <h1 className="text-3xl sm:text-4xl font-semibold">Advanced LP Lab</h1>
        <div className="flex flex-wrap gap-3 justify-center text-xs text-white/70">
          <span className="px-3 py-1 rounded-full border border-white/15">Monad chain #143</span>
          <span className="px-3 py-1 rounded-full border border-white/15">
            Single + double sided bands
          </span>
          <Link
            href="/miniapp"
            className="px-3 py-1 rounded-full border border-white/15 hover:bg-white/10 transition"
          >
            Back to cabal check
          </Link>
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <div className="relative">
            <div className="absolute top-4 left-4 z-20 pointer-events-none">
              <div className="border border-[#fdd65b] bg-[#fdd65b]/10 px-3 py-2 max-w-[200px]">
                <p className="text-[10px] text-[#fdd65b] leading-tight">
                  example -- current tick = {marketState?.tick ?? '-10400'} and corresponds to m00n
                  mkt cap = {formatUsd(moonMarketCapUsd)}
                </p>
              </div>
            </div>

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
              {isConnected && (
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
                    <p className="font-mono text-lg">{moonBalanceDisplay}</p>
                  </div>
                  <div>
                    <p className="opacity-60">W-MON balance</p>
                    <p className="font-mono text-lg">{wmonBalanceDisplay}</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-white/70">
                  Connect a wallet capable of signing on Monad.
                </p>
                {miniAppState === 'miniapp' && (
                  <button
                    type="button"
                    onClick={handleMiniAppConnect}
                    className="px-4 py-2 border border-[var(--moss-green)] text-[var(--moss-green)] rounded-full text-sm hover:bg-[var(--moss-green)] hover:text-black transition disabled:opacity-40"
                  >
                    Connect Farcaster wallet
                  </button>
                )}
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
              Current tick (in terms of mkt cap of m00n in usd)
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

            {bandSide === 'single' && (
              <div className="flex gap-2 justify-center text-xs mt-2">
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
          </div>

          <div className="pt-4 space-y-2 sticky bottom-0 bg-black/85 backdrop-blur border-t border-white/10 px-3 pb-4 md:static md:bg-transparent md:border-0 md:px-0 md:pb-0">
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
              <a
                href={`https://monadscan.com/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-[10px] text-white/50 underline"
              >
                View on Monadscan
              </a>
            )}
          </div>
        </div>
      </section>

      <footer className="text-center text-xs text-white/60 space-y-2">
        <p>Need an exotic preset or want us to deploy on your behalf? Ping @m00npapi.eth.</p>
        <p>
          Crafted with the lunar design language.{' '}
          <Link href="/advanced_lp.md" className="underline hover:text-white">
            View docs
          </Link>
          .
        </p>
      </footer>
    </>
  );
}
