'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  WagmiConfig,
  createConfig,
  http,
  useAccount,
  useConnect,
  useDisconnect,
  useWalletClient,
  useBalance
} from 'wagmi';
import { metaMask, injected, coinbaseWallet } from 'wagmi/connectors';
import { formatUnits } from 'viem';
import sdk from '@farcaster/miniapp-sdk';

type BandMode = 'sky' | 'crash';
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

const wagmiConfig = createConfig({
  chains: [monadChain],
  connectors: [
    metaMask(),
    injected({ shimDisconnect: true }),
    coinbaseWallet({
      appName: 'm00n advanced LP',
      jsonRpcUrl: monadChain.rpcUrls.default.http[0]!
    })
  ],
  transports: {
    [monadChain.id]: http(monadChain.rpcUrls.default.http[0]!)
  }
});

const TICK_SPACING = 200;
const HISTORY_POINTS = 48;

const snapDownToSpacing = (tick: number) => Math.floor(tick / TICK_SPACING) * TICK_SPACING;
const snapUpToSpacing = (tick: number) => Math.ceil(tick / TICK_SPACING) * TICK_SPACING;
const tickToPrice = (tick: number) => Math.pow(1.0001, tick);
const priceToTick = (price: number) => Math.log(price) / Math.log(1.0001);

function formatTokenBalance(value?: bigint, decimals = 18) {
  if (value === undefined) return '0';
  const numeric = Number(formatUnits(value, decimals));
  if (!Number.isFinite(numeric)) return '0';
  if (numeric >= 1_000_000) return `${numeric.toFixed(1)}M`;
  if (numeric >= 1_000) return `${numeric.toFixed(1)}k`;
  return numeric.toFixed(4);
}

function formatUsd(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return '$0.00';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2
  });
}

function generateMockSeries(anchor: number | null): ChartPoint[] {
  const base = anchor && anchor > 0 ? anchor : 50_000;
  const points: ChartPoint[] = [];
  let value = base * 0.85;
  for (let i = 0; i < HISTORY_POINTS; i += 1) {
    const drift = Math.sin(i / 6) * base * 0.02;
    const noise = (Math.random() - 0.5) * base * 0.01;
    value = Math.max(base * 0.35, Math.min(base * 1.8, value + drift + noise));
    points.push({ x: i, y: value });
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
  const width = 640;
  const height = 320;
  const minValue = useMemo(() => {
    const candidates = series.map((point) => point.y);
    if (currentUsd) candidates.push(currentUsd);
    if (lowerUsd) candidates.push(lowerUsd);
    if (upperUsd) candidates.push(upperUsd);
    const min = Math.min(...candidates, 1);
    return min * 0.9;
  }, [series, currentUsd, lowerUsd, upperUsd]);

  const maxValue = useMemo(() => {
    const candidates = series.map((point) => point.y);
    if (currentUsd) candidates.push(currentUsd);
    if (lowerUsd) candidates.push(lowerUsd);
    if (upperUsd) candidates.push(upperUsd);
    const max = Math.max(...candidates, 1);
    return max * 1.08;
  }, [series, currentUsd, lowerUsd, upperUsd]);

  const scaleY = useCallback(
    (value: number) => {
      const clamped = Math.min(Math.max(value, minValue), maxValue);
      const ratio = (clamped - minValue) / (maxValue - minValue || 1);
      return height - ratio * height;
    },
    [minValue, maxValue]
  );

  const scaleX = useCallback(
    (index: number) => (index / Math.max(series.length - 1, 1)) * width,
    [series.length, width]
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
  const rangeY1 = hasRange ? scaleY(Math.max(lowerUsd!, upperUsd!)) : 0;
  const rangeY2 = hasRange ? scaleY(Math.min(lowerUsd!, upperUsd!)) : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full rounded-[32px] border border-white/10 bg-gradient-to-b from-[#090512] to-[#05030b] p-4"
    >
      <defs>
        <linearGradient id="telemetryLine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fdd65b" />
          <stop offset="100%" stopColor="#6ce5b1" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width={width} height={height} rx="28" fill="url(#telemetryGrid)" opacity="0.1" />

      {hasRange && (
        <rect
          x={scaleX(0)}
          y={Math.min(rangeY1, rangeY2)}
          width={width}
          height={Math.abs(rangeY2 - rangeY1) || 2}
          fill="rgba(108,229,177,0.08)"
          stroke="rgba(108,229,177,0.35)"
          strokeDasharray="6 8"
        />
      )}

      <path
        d={pathD}
        fill="none"
        stroke="url(#telemetryLine)"
        strokeWidth={4}
        strokeLinecap="round"
        filter="url(#glow)"
      />

      {currentUsd && (
        <g>
          <line
            x1={scaleX(series.length - 1)}
            x2={scaleX(series.length - 1)}
            y1={scaleY(currentUsd)}
            y2={height}
            stroke="rgba(255,255,255,0.25)"
            strokeDasharray="2 6"
          />
          <circle
            cx={scaleX(series.length - 1)}
            cy={scaleY(currentUsd)}
            r={7}
            fill="#fdd65b"
            stroke="#ffffff"
            strokeWidth={2}
          />
        </g>
      )}

      {hasRange && (
        <>
          <text
            x={width - 12}
            y={rangeY2 - 6}
            textAnchor="end"
            className="fill-white"
            fontSize="11"
            fontFamily="var(--font-sans)"
          >
            Upper {formatUsd(Math.max(lowerUsd!, upperUsd!))}
          </text>
          <text
            x={width - 12}
            y={rangeY1 + 18}
            textAnchor="end"
            fontFamily="var(--font-sans)"
            fontSize="11"
            fill="rgba(255,255,255,0.65)"
          >
            Lower {formatUsd(Math.min(lowerUsd!, upperUsd!))}
          </text>
        </>
      )}

      <text
        x={16}
        y={24}
        fontSize="11"
        letterSpacing="0.3em"
        textTransform="uppercase"
        fill="rgba(255,255,255,0.6)"
      >
        price of m00n
      </text>
    </svg>
  );
}

export default function LpAdvancedPage() {
  return (
    <WagmiConfig config={wagmiConfig}>
      <AdvancedLpContent />
    </WagmiConfig>
  );
}

function AdvancedLpContent() {
  const [miniAppState, setMiniAppState] = useState<'unknown' | 'desktop' | 'miniapp'>('unknown');
  const [viewerFid, setViewerFid] = useState<number | null>(null);
  const [miniAppError, setMiniAppError] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const { connect, connectors, error: connectError, isPending, pendingConnector } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();

  const moonBalance = useBalance({
    address,
    token: TOKEN_MOON_ADDRESS,
    watch: true,
    enabled: Boolean(address)
  });
  const wmonBalance = useBalance({
    address,
    token: TOKEN_WMON_ADDRESS,
    watch: true,
    enabled: Boolean(address)
  });

  const [bandMode, setBandMode] = useState<BandMode>('sky');
  const [bandSide, setBandSide] = useState<BandSide>('single');
  const [rangeLowerUsd, setRangeLowerUsd] = useState('');
  const [rangeUpperUsd, setRangeUpperUsd] = useState('');
  const [rangeTouched, setRangeTouched] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [status, setStatus] = useState<DeployState>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [marketState, setMarketState] = useState<PoolState | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);

  const marketUsdPrice = marketState?.moonUsdPrice ?? null;
  const chartSeries = useMemo(() => generateMockSeries(marketUsdPrice), [marketUsdPrice]);

  const renderShell = useCallback(
    (children: ReactNode) => (
      <main className="min-h-screen bg-[#05030b] text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#130a26] via-transparent to-black opacity-70" />
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_20%,rgba(140,84,255,0.3),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(108,229,177,0.18),transparent_40%)]" />

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-10 space-y-10">{children}</div>
      </main>
    ),
    []
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
    if (!marketUsdPrice || rangeTouched) return;
    const [low, high] =
      bandMode === 'sky'
        ? [marketUsdPrice * 1.2, marketUsdPrice * 4.5]
        : [marketUsdPrice * 0.35, marketUsdPrice * 0.95];
    setRangeLowerUsd(low.toFixed(0));
    setRangeUpperUsd(high.toFixed(0));
  }, [bandMode, marketUsdPrice, rangeTouched]);

  const parsedLower = Number(rangeLowerUsd);
  const parsedUpper = Number(rangeUpperUsd);
  const hasValidRange = Number.isFinite(parsedLower) && Number.isFinite(parsedUpper);
  const [rangeMin, rangeMax] = hasValidRange
    ? parsedLower < parsedUpper
      ? [parsedLower, parsedUpper]
      : [parsedUpper, parsedLower]
    : [null, null];

  const rangeError = useMemo(() => {
    if (!hasValidRange || rangeMin === null || rangeMax === null) return 'Enter both USD bounds.';
    if (rangeMin === rangeMax) return 'Bounds must differ.';
    if (!marketUsdPrice) return null;
    if (bandMode === 'sky' && rangeMin <= marketUsdPrice) {
      return 'Sky ladders must start above current market cap.';
    }
    if (bandMode === 'crash' && rangeMax >= marketUsdPrice) {
      return 'Crash backstops must sit below spot.';
    }
    return null;
  }, [bandMode, hasValidRange, rangeMin, rangeMax, marketUsdPrice]);

  const preview = useMemo(() => {
    if (!marketState || marketState.wmonUsdPrice === null) return null;
    if (rangeMin === null || rangeMax === null || rangeError) return null;
    const lowerRatio = rangeMin / marketState.wmonUsdPrice;
    const upperRatio = rangeMax / marketState.wmonUsdPrice;
    if (lowerRatio <= 0 || upperRatio <= 0) return null;

    const tickLower = snapDownToSpacing(Math.floor(priceToTick(lowerRatio)));
    let tickUpper = snapUpToSpacing(Math.floor(priceToTick(upperRatio)));
    if (tickUpper <= tickLower) tickUpper = tickLower + TICK_SPACING;

    return {
      tickLower,
      tickUpper,
      priceLowerUsd: tickToPrice(tickLower) * marketState.wmonUsdPrice,
      priceUpperUsd: tickToPrice(tickUpper) * marketState.wmonUsdPrice
    };
  }, [marketState, rangeMin, rangeMax, rangeError]);

  const handleDeploy = useCallback(async () => {
    if (!address || !walletClient) {
      setStatus('error');
      setStatusMessage('Connect a wallet on Monad first.');
      return;
    }
    if (bandSide !== 'single') {
      setStatus('error');
      setStatusMessage('Double-sided deployment is coming soon.');
      return;
    }
    if (!amountInput || Number(amountInput) <= 0) {
      setStatus('error');
      setStatusMessage('Enter a positive deposit amount.');
      return;
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

      const response = await fetch('/api/lp-advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: address,
          amount: amountInput,
          mode: bandMode,
          side: bandSide,
          rangeLowerUsd: rangeMin,
          rangeUpperUsd: rangeMax
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'lp_advanced_failed');
      }

      const { to, data, value } = (await response.json()) as {
        to: `0x${string}`;
        data: `0x${string}`;
        value?: string;
      };

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
  }, [address, walletClient, bandSide, amountInput, rangeMin, rangeMax, rangeError, bandMode]);

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
          LP Lab
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold">Advanced Single-Sided Deployment</h1>
        <p className="text-sm text-white/80 max-w-2xl mx-auto">
          Sculpt bespoke m00n / W-MON sigils with human-friendly controls. Set ranges in USD,
          preview the orbit, then mint direct to Monad with one transaction.
        </p>
        <div className="flex flex-wrap gap-3 justify-center text-xs text-white/70">
          <span className="px-3 py-1 rounded-full border border-white/15">Monad chain #143</span>
          <span className="px-3 py-1 rounded-full border border-white/15">
            Single-sided (LP-only)
          </span>
          <Link
            href="/miniapp"
            className="px-3 py-1 rounded-full border border-white/15 hover:bg-white/10 transition"
          >
            Back to cabal check
          </Link>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="lunar-card space-y-3">
          <div className="flex items-center justify-between">
            <p className="lunar-heading">Pool telemetry</p>
            <button
              type="button"
              disabled={marketLoading}
              onClick={() => {
                setMarketLoading(true);
                fetch('/api/pool-state')
                  .then((res) => res.json())
                  .then((data) => {
                    setMarketState(data);
                    setMarketError(null);
                  })
                  .catch(() => setMarketError('Unable to refresh pool state.'))
                  .finally(() => setMarketLoading(false));
              }}
              className="text-[10px] px-3 py-1 border border-white/15 rounded-full uppercase tracking-[0.3em] hover:bg-white/10 disabled:opacity-40"
            >
              {marketLoading ? 'syncing…' : 'refresh'}
            </button>
          </div>
          {marketError && <p className="text-sm text-red-300">{marketError}</p>}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="opacity-60">Current tick</p>
              <p className="font-mono text-lg">{marketState?.tick ?? '—'}</p>
            </div>
            <div>
              <p className="opacity-60">m00n price</p>
              <p className="font-mono text-lg">{formatUsd(marketUsdPrice)}</p>
            </div>
            <div>
              <p className="opacity-60">W-MON price</p>
              <p className="font-mono text-lg">{formatUsd(marketState?.wmonUsdPrice)}</p>
            </div>
            <div>
              <p className="opacity-60">Last update</p>
              <p className="text-xs">
                {marketState?.updatedAt
                  ? new Date(marketState.updatedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : '—'}
              </p>
            </div>
          </div>
        </article>

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
                Connect a wallet capable of signing on Monad. MetaMask, Coinbase Wallet, and other
                injected providers are supported.
              </p>
              <div className="flex flex-wrap gap-3">
                {connectors.map((connector) => (
                  <button
                    key={connector.id}
                    onClick={() => connect({ connector })}
                    className="px-4 py-2 border border-white/20 rounded-full text-sm hover:bg-white/10 transition disabled:opacity-40"
                    disabled={!connector.ready || isPending}
                  >
                    {connector.name}
                    {isPending && pendingConnector?.id === connector.id && '…'}
                  </button>
                ))}
              </div>
              {connectError && <p className="text-sm text-red-300">{connectError.message}</p>}
            </div>
          )}
        </article>

        <article className="lunar-card space-y-3 text-sm text-white/80">
          <p className="lunar-heading">Checklist</p>
          <ul className="space-y-2">
            <li>• Single-sided deployment only. Double-sided coming soon.</li>
            <li>• Calldata built with Uniswap V4 PositionManager.</li>
            <li>• Gas and slippage guardrails baked in (5% tolerance).</li>
            <li>• Keep a margin of MON for gas on Monad.</li>
          </ul>
        </article>
      </section>

      <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <RangeChart
            series={chartSeries}
            currentUsd={marketUsdPrice}
            lowerUsd={rangeMin}
            upperUsd={rangeMax}
          />
          <p className="text-xs text-white/70 text-center">
            Yellow trace = live m00n price. Shaded ribbon shows where your sigil will orbit once
            deployed.
          </p>
        </div>

        <div className="lunar-card space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setBandMode('sky');
                setRangeTouched(false);
              }}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                bandMode === 'sky'
                  ? 'border-[var(--moss-green)] bg-[var(--moss-green)]/15'
                  : 'border-white/15 hover:bg-white/5'
              }`}
            >
              <p className="font-semibold">Sky ladder</p>
              <p className="text-xs text-white/70">m00n-only. Range above spot.</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setBandMode('crash');
                setRangeTouched(false);
              }}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                bandMode === 'crash'
                  ? 'border-[#fdd65b] bg-[#fdd65b]/10'
                  : 'border-white/15 hover:bg-white/5'
              }`}
            >
              <p className="font-semibold">Crash backstop</p>
              <p className="text-xs text-white/70">WMON-only. Range below spot.</p>
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 rounded-full border px-4 py-2 text-xs tracking-[0.3em] ${
                bandSide === 'single'
                  ? 'border-[var(--moss-green)] bg-[var(--moss-green)]/10'
                  : 'border-white/15'
              }`}
              onClick={() => setBandSide('single')}
            >
              SINGLE-SIDED
            </button>
            <button
              type="button"
              disabled
              className="flex-1 rounded-full border px-4 py-2 text-xs tracking-[0.3em] border-white/15 text-white/40"
            >
              DOUBLE (SOON)
            </button>
          </div>

          <div className="space-y-2">
            <label className="lunar-heading">
              Deposit amount ({bandMode === 'sky' ? 'm00n' : 'W-MON'})
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder="e.g. 1,000,000"
              className="w-full rounded-2xl border border-white/20 bg-black/40 px-4 py-3 text-lg font-mono focus:outline-none focus:border-[var(--moss-green)]"
            />
            <div className="flex justify-between text-xs text-white/60">
              <span>
                Balance: {bandMode === 'sky' ? moonBalanceDisplay : wmonBalanceDisplay}{' '}
                {bandMode === 'sky' ? 'm00n' : 'WMON'}
              </span>
              <button
                type="button"
                onClick={() => {
                  const formatted =
                    bandMode === 'sky' ? moonBalance.data?.formatted : wmonBalance.data?.formatted;
                  if (formatted) setAmountInput(formatted);
                }}
                className="text-[var(--moss-green)] hover:underline disabled:opacity-30"
                disabled={!isConnected}
              >
                Max
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="lunar-heading">Lower bound (USD)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={rangeLowerUsd}
                onChange={(event) => {
                  setRangeLowerUsd(event.target.value);
                  setRangeTouched(true);
                }}
                className="w-full rounded-2xl border border-white/20 bg-black/40 px-3 py-3 text-sm font-mono focus:outline-none focus:border-[var(--moss-green)]"
              />
            </div>
            <div className="space-y-2">
              <label className="lunar-heading">Upper bound (USD)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={rangeUpperUsd}
                onChange={(event) => {
                  setRangeUpperUsd(event.target.value);
                  setRangeTouched(true);
                }}
                className="w-full rounded-2xl border border-white/20 bg-black/40 px-3 py-3 text-sm font-mono focus:outline-none focus:border-[var(--moss-green)]"
              />
            </div>
          </div>
          <p className="text-xs text-white/60">
            Tip: Sky ladders chase upside (above spot). Crash backstops defend downside (below
            spot). Enter USD caps to match your thesis.
          </p>
          {rangeError && <p className="text-sm text-red-300">{rangeError}</p>}

          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-2 text-sm">
            <p className="lunar-heading">Band preview</p>
            {preview ? (
              <>
                <p className="flex justify-between">
                  <span>Ticks</span>
                  <span className="font-mono">
                    {preview.tickLower} → {preview.tickUpper}
                  </span>
                </p>
                <p className="flex justify-between">
                  <span>Range (USD)</span>
                  <span className="font-mono">
                    {formatUsd(preview.priceLowerUsd)} → {formatUsd(preview.priceUpperUsd)}
                  </span>
                </p>
              </>
            ) : (
              <p className="text-white/60">Enter valid bounds to preview the exact ticks.</p>
            )}
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleDeploy}
              disabled={!isConnected || status === 'building'}
              className="w-full cta-primary disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {status === 'building' ? 'DEPLOYING…' : 'DEPLOY BAND ON MONAD'}
            </button>
            {statusMessage && (
              <p
                className={`text-sm ${status === 'error' ? 'text-red-300' : 'text-[var(--moss-green)]'}`}
              >
                {statusMessage}
              </p>
            )}
            {txHash && (
              <a
                href={`https://monadscan.com/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/70 underline"
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
