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
import { getTierByReplyCount } from '@/app/lib/tiers';

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
const truncateAddress = (value?: string | null) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : null;

type UserPersona = 'eligible_holder' | 'lp_gate' | 'locked_out';
type LpStatus = 'DISCONNECTED' | 'CHECKING' | 'NO_LP' | 'HAS_LP' | 'ERROR';
type AdminPortalView =
  | 'default'
  | 'claimed_sold'
  | 'claimed_held'
  | 'claimed_bought_more'
  | 'lp_gate';

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

export default function MiniAppPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [isMiniApp, setIsMiniApp] = useState<boolean | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [airdropData, setAirdropData] = useState<AirdropData | null>(null);
  const [engagementData, setEngagementData] = useState<EngagementData | null>(null);
  const [showLootReveal, setShowLootReveal] = useState(false);
  const [primaryAddress, setPrimaryAddress] = useState<string | null>(null);
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

  const formatAmount = (amount?: string | number) => {
    if (amount === undefined || amount === null) return '0';
    const numeric = typeof amount === 'string' ? parseInt(amount, 10) : amount;
    if (Number.isNaN(numeric)) return '0';
    return numeric.toLocaleString();
  };

  const userPersona: UserPersona = useMemo(() => {
    if (airdropData?.eligible) {
      return 'eligible_holder';
    }
    if (LP_GATE_ENABLED && userData && !airdropData?.eligible) {
      return 'lp_gate';
    }
    return 'locked_out';
  }, [airdropData?.eligible, userData]);

  const isAdmin = viewerContext?.fid === ADMIN_FID;

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
    if (userPersona !== 'lp_gate') {
      setLpGateState({ lpStatus: 'DISCONNECTED' });
      setIsLpLoungeOpen(false);
      return;
    }

    if (!primaryAddress) {
      setLpGateState({ lpStatus: 'DISCONNECTED', walletAddress: null, lpPositions: [] });
      return;
    }

    let cancelled = false;
    const runCheck = async () => {
      setLpGateState({ lpStatus: 'CHECKING', walletAddress: primaryAddress, lpPositions: [] });

      try {
        const response = await fetch(`/api/lp-nft?address=${primaryAddress}`);
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
            walletAddress: primaryAddress,
            lpPositions: []
          });
          return;
        }

        setLpGateState({
          lpStatus: data.hasLpNft ? 'HAS_LP' : 'NO_LP',
          walletAddress: primaryAddress,
          lpPositions: data.lpPositions ?? []
        });
      } catch (err) {
        console.error('LP gate lookup failed', err);
        if (cancelled) return;
        setLpGateState({
          lpStatus: 'ERROR',
          walletAddress: primaryAddress,
          lpPositions: []
        });
      }
    };

    void runCheck();

    return () => {
      cancelled = true;
    };
  }, [userPersona, primaryAddress, lpRefreshNonce]);

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
    try {
      await sdk.actions.openUrl({ url: LP_MINT_URL });
    } catch (err) {
      console.warn('Failed to open LP site via sdk, falling back to window', err);
      if (typeof window !== 'undefined') {
        window.open(LP_MINT_URL, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const handleOpenLpDocs = async () => {
    try {
      await sdk.actions.openUrl({ url: LP_DOCS_URL });
    } catch (err) {
      console.warn('Failed to open LP docs via sdk, falling back to window', err);
      if (typeof window !== 'undefined') {
        window.open(LP_DOCS_URL, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const handleRetryLpStatus = () => {
    setLpRefreshNonce((prev) => prev + 1);
  };

  const handleEnterLpLounge = () => {
    if (lpGateState.lpStatus === 'HAS_LP') {
      setIsLpLoungeOpen(true);
    }
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

    let title = 'LP Cabal Gate';
    let body: ReactNode = (
      <p className="text-sm opacity-80">
        To unlock the inner room you need an LP sigil in the m00nad / W-MON pool.
      </p>
    );
    let primaryLabel = '';
    let primaryAction: (() => void) | null = null;
    let primaryDisabled = false;
    let secondaryLabel: string | null = null;
    let secondaryAction: (() => void) | null = null;
    let showLoader = false;

    switch (lpStatus) {
      case 'DISCONNECTED':
        title = '🜁 LP Cabal Gate';
        body = (
          <p className="text-sm opacity-80">
            You bought m00nad, but the door stays closed. Connect a wallet so I can scan the m00n /
            W-MON LP sigil.
          </p>
        );
        primaryLabel = 'CONNECT WALLET';
        primaryAction = handleSignIn;
        secondaryLabel = 'BECOME LP';
        secondaryAction = handleOpenLpSite;
        break;
      case 'CHECKING':
        title = '🔍 Scanning Liquidity Sigils…';
        body = (
          <p className="text-sm opacity-80">
            Give me a beat while I crawl your LP positions. This only takes a moment.
          </p>
        );
        primaryLabel = 'SCANNING';
        primaryDisabled = true;
        showLoader = true;
        break;
      case 'NO_LP':
        title = '🚫 No LP. No Entry.';
        body = (
          <div className="space-y-2 text-sm opacity-85">
            <p>You&apos;ve touched m00nad, but you&apos;re not in the m00n / W-MON LP.</p>
            <p className="opacity-70">This room is for the liquidity cabal only.</p>
          </div>
        );
        primaryLabel = 'BECOME LP';
        primaryAction = handleOpenLpSite;
        secondaryLabel = 'WHY LP MATTERS?';
        secondaryAction = handleOpenLpDocs;
        break;
      case 'HAS_LP':
        title = '✅ Welcome, LP Cabalist';
        body = (
          <div className="space-y-2 text-sm opacity-85">
            {truncatedWallet && <p>Wallet: {truncatedWallet}</p>}
            <p>
              Detected {positionCount} live LP {positionCount === 1 ? 'position' : 'positions'} in
              the m00n / W-MON pool.
            </p>
            <p className="opacity-70">You&apos;re cleared to enter the lounge.</p>
          </div>
        );
        primaryLabel = 'ENTER LP LOUNGE';
        primaryAction = handleEnterLpLounge;
        secondaryLabel = 'MANAGE LP';
        secondaryAction = handleOpenLpSite;
        break;
      case 'ERROR':
        title = '⚠️ Ritual Jammed';
        body = (
          <div className="space-y-2 text-sm opacity-85">
            <p>Something broke while reading your LP sigils.</p>
            <p className="opacity-70">Try again, or open the LP site to double-check manually.</p>
          </div>
        );
        primaryLabel = 'TRY AGAIN';
        primaryAction = handleRetryLpStatus;
        secondaryLabel = 'OPEN LP SITE';
        secondaryAction = handleOpenLpSite;
        break;
      default:
        break;
    }

    const positionsPreview =
      lpStatus === 'HAS_LP' && positionCount > 0 ? (
        <div className={`${PANEL_CLASS} text-left space-y-2`}>
          <p className="uppercase text-[var(--moss-green)] text-[11px] tracking-[0.4em]">
            LP SIGILS
          </p>
          {lpPositions.slice(0, 2).map((position) => (
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
          <h1 className="pixel-font text-2xl glow-purple">{title}</h1>
          <div className="space-y-4">{body}</div>
          {showLoader && (
            <div className="flex justify-center">
              <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-[var(--monad-purple)] animate-pulse" />
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:justify-center gap-3">
            {primaryLabel && (
              <button
                onClick={primaryAction ?? undefined}
                disabled={!primaryAction || primaryDisabled}
                className="pixel-font px-6 py-3 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-40"
              >
                {primaryLabel}
              </button>
            )}
            {secondaryLabel && (
              <button
                onClick={secondaryAction ?? undefined}
                className="pixel-font px-6 py-3 border border-[var(--monad-purple)] text-[var(--monad-purple)] rounded-lg hover:bg-[var(--monad-purple)] hover:text-white transition-colors"
              >
                {secondaryLabel}
              </button>
            )}
          </div>
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

  const renderAdminClaimPanel = () =>
    renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-2xl w-full space-y-6 text-center scanline bg-black/50 border border-[var(--monad-purple)] rounded-3xl px-8 py-12">
          <div className="flex justify-center">
            <NeonHaloLogo size={150} />
          </div>
          <h1 className="pixel-font text-3xl glow-purple">CLAIM CONSOLE</h1>
          <p className="text-sm opacity-80">
            Only fid 9933 can operate the drop while the rest of Warpcast stays sealed out.
          </p>
          <button
            onClick={handleOpenClaimSite}
            className="pixel-font px-6 py-3 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-colors"
          >
            OPEN CLAIM SITE
          </button>
          {renderContractCard()}
        </div>
      </div>
    );

  const renderLockedForMaintenance = () =>
    renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-xl w-full text-center space-y-4 scanline bg-black/45 border border-white/10 rounded-3xl px-6 py-8">
          <h1 className="pixel-font text-2xl text-red-400">PORTAL OFFLINE</h1>
          <p className="text-sm opacity-80">
            This mini app is restricted to the cabal operator while maintenance is underway.
          </p>
          <p className="text-xs opacity-60">Please check back later.</p>
        </div>
      </div>
    );

  const renderClaimedSoldPortal = () =>
    renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-2xl w-full text-center space-y-6 scanline bg-black/55 border border-red-600 rounded-3xl px-8 py-12">
          <div className="flex justify-center">
            <NeonHaloLogo size={140} />
          </div>
          <h1 className="pixel-font text-3xl text-red-500">REST IN PISS</h1>
          <p className="text-sm opacity-80">
            You dumped your m00nad the second you could. This chamber stays locked until you prove
            otherwise.
          </p>
          <div className="text-xs opacity-60">
            Tip: whisper to the cabal, or buy back if you want another shot.
          </div>
        </div>
      </div>
    );

  const renderClaimedHeldPortal = () =>
    renderShell(
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

  const renderClaimedBoughtMorePortal = () =>
    renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-3xl w-full space-y-6 text-center scanline bg-black/45 border border-white/20 rounded-3xl px-8 py-10">
          <div className="flex justify-center">
            <div className="w-48 h-48 rounded-full bg-gradient-to-br from-purple-200 via-pink-200 to-white blur-2xl opacity-70" />
          </div>
          <h1 className="pixel-font text-3xl text-white">HEAVENLY ACCUMULATION</h1>
          <p className="text-sm opacity-80">
            You not only claimed—you kept buying. Enjoy the faux-angelic view while the cabal
            decides your next ceremony.
          </p>
          <div className="text-xs opacity-60">
            Solitaire mini-game arriving soon. Until then, bask in the neon ether.
          </div>
        </div>
      </div>
    );

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

  if (userData) {
    if (!isAdmin) {
      return renderLockedForMaintenance();
    }
    if (adminPortalView === 'default') {
      return renderAdminClaimPanel();
    }
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
        if (isLpLoungeOpen && lpGateState.lpStatus === 'HAS_LP') {
          return renderLpLoungePanel();
        }
        return renderLpGatePanel();
      default:
        break;
    }
  }

  if (airdropData?.eligible) {
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-3xl w-full space-y-8 scanline p-10 bg-black/50 rounded-lg border-2 border-[var(--monad-purple)]">
          <div className="flex justify-center mb-2">
            <NeonHaloLogo size={150} />
          </div>

          <h1 className="pixel-font text-2xl text-center glow-purple">WELCOME TO THE CABAL</h1>

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

          <div className="mb-2">{renderSessionCard(userData.fid, primaryAddress)}</div>
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
  }

  if (userPersona === 'lp_gate') {
    if (isLpLoungeOpen && lpGateState.lpStatus === 'HAS_LP') {
      return renderLpLoungePanel();
    }
    return renderLpGatePanel();
  }

  return renderShell(
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
      <div className="max-w-2xl w-full text-center space-y-6 scanline shake">
        <div className="flex justify-center">
          <NeonHaloLogo size={160} />
        </div>

        <h1 className="pixel-font text-2xl text-red-400">ACCESS DENIED</h1>

        <p className="text-lg opacity-70">
          You don&apos;t have to go home, but you can&apos;t stay here.
        </p>

        <div className="text-sm text-left bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-6 space-y-3">
          <p className="uppercase text-[var(--moss-green)] text-xs tracking-widest">Session</p>
          <p>FID: {userData.fid}</p>
          <div className="flex items-center gap-3 font-mono text-base">
            <span>
              Wallet:{' '}
              {primaryAddress ? `${primaryAddress.slice(0, 6)}…${primaryAddress.slice(-4)}` : '—'}
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
}
