'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

interface ScanStep {
  key: ScanPhase;
  label: string;
  description: string;
}

const TOKEN_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
const CLAIM_URL = 'https://clanker.world/clanker/0x22Cd99EC337a2811F594340a4A6E41e4A3022b07';

export default function MiniAppPage() {
  const MINIAPP_URL = process.env.NEXT_PUBLIC_MINIAPP_URL ?? 'https://m00nad.vercel.app/miniapp';

  const [isLoading, setIsLoading] = useState(true);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [isMiniApp, setIsMiniApp] = useState<boolean | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [airdropData, setAirdropData] = useState<AirdropData | null>(null);
  const [engagementData, setEngagementData] = useState<EngagementData | null>(null);
  const [showLootReveal, setShowLootReveal] = useState(false);
  const [showLorePanel, setShowLorePanel] = useState(false);
  const [primaryAddress, setPrimaryAddress] = useState<string | null>(null);
  const [dropAddress, setDropAddress] = useState<string | null>(null);
  const [viewerContext, setViewerContext] = useState<ViewerContext | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [copiedContract, setCopiedContract] = useState(false);

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

  const scanSteps = useMemo<ScanStep[]>(
    () => [
      {
        key: 'idle',
        label: 'Awaiting scan',
        description: 'Tap SCAN FID to begin the ritual.'
      },
      {
        key: 'authenticating',
        label: 'Authenticating',
        description: 'Awaiting Farcaster approval.'
      },
      {
        key: 'addresses',
        label: 'Syncing wallets',
        description: 'Pulling every verified address tied to your FID.'
      },
      {
        key: 'fetching',
        label: 'Consulting ledger',
        description: 'Checking the $m00n drop allocations.'
      },
      {
        key: 'ready',
        label: 'Drop synced',
        description: 'Scroll down to view your fate.'
      },
      {
        key: 'error',
        label: 'Link disrupted',
        description: 'Something went wrong. Tap RETRY SCAN.'
      }
    ],
    []
  );
  const resolvedPhase = scanPhase;
  const activeStepIndex = Math.max(
    0,
    scanSteps.findIndex((step) => step.key === resolvedPhase)
  );
  const currentStep = scanSteps[activeStepIndex] ?? scanSteps[0];
  const currentDescription = scanPhase === 'error' && error ? error : currentStep.description;
  const scanProgress = ((activeStepIndex + 1) / scanSteps.length) * 100;

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

  const formatAmount = (amount: string) => {
    return parseInt(amount).toLocaleString();
  };

  const handleCopyContract = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_ADDRESS);
      setCopiedContract(true);
      setTimeout(() => setCopiedContract(false), 2500);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleOpenClaimSite = async () => {
    try {
      await sdk.actions.openUrl(CLAIM_URL);
    } catch (err) {
      console.warn('sdk.actions.openUrl failed, falling back to browser open', err);
      if (typeof window !== 'undefined') {
        window.open(CLAIM_URL, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const handleShare = async () => {
    if (!airdropData?.eligible || !airdropData.amount) return;

    const baseText = `I'm part of the m00n cabal! Receiving ${formatAmount(
      airdropData.amount
    )} $m00n tokens 🌙✨`;
    const finalText = MINIAPP_URL
      ? `${baseText}\n\n${MINIAPP_URL}`
      : 'Signal lost. The cabal portal is sealed for now.';

    await sdk.actions.openUrl(
      `https://warpcast.com/~/compose?text=${encodeURIComponent(finalText)}`
    );
  };

  const tier = engagementData ? getTierByReplyCount(engagementData.replyCount) : null;

  const renderSessionCard = (fid?: number, wallet?: string | null) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-4 text-sm text-left backdrop-blur-lg">
      <div>
        <p className="uppercase text-[var(--moss-green)] text-xs tracking-widest">Connected FID</p>
        <p className="font-mono text-base">{fid ?? '—'}</p>
      </div>
      <div>
        <p className="uppercase text-[var(--moss-green)] text-xs tracking-widest">Wallet</p>
        <p className="font-mono text-base">
          {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '—'}
        </p>
      </div>
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
    <div className="bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-4 space-y-4 text-left backdrop-blur">
      <div>
        <p className="uppercase text-[var(--moss-green)] text-xs tracking-widest">m00n contract</p>
        <p className="font-mono text-sm break-all">{TOKEN_ADDRESS}</p>
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
      <p className="text-xs opacity-75">
        Unlocks route to claim: <span className="font-mono">{CLAIM_URL}</span>
      </p>
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
    return (
      <div className="relative min-h-screen overflow-hidden">
        <BackgroundOrbs />
        <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
          <div className="max-w-2xl w-full text-center space-y-8 scanline">
            <div className="relative mx-auto w-full overflow-hidden rounded-3xl border border-[var(--monad-purple)] bg-black/30 shadow-[0_0_40px_rgba(140,84,255,0.35)]">
              <Image
                src="/brand/banner.png"
                alt="m00n Cabal"
                width={1200}
                height={600}
                className="w-full h-[240px] md:h-[340px] object-cover opacity-95"
                priority
              />
              <span className="scanner-bar" />
            </div>

            <div className="space-y-2">
              <h1 className="pixel-font text-2xl md:text-3xl glow-purple">m00n Cabal Check</h1>
              <p className="text-lg opacity-90">Check your $m00n eligibility.</p>
            </div>

            {renderSessionCard(viewerContext?.fid, primaryAddress)}

            {isMiniApp === false ? (
              <div className="bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-4 space-y-4 backdrop-blur">
                <p className="text-base">
                  This portal must run inside Warpcast. Tap below to open it with your Farcaster
                  session.
                </p>
                <a
                  href="https://warpcast.com/~/add-mini-app?domain=m00nad.vercel.app"
                  className="pixel-font inline-block px-6 py-3 bg-[var(--monad-purple)] text-white rounded hover:bg-opacity-90 transition-all"
                >
                  OPEN IN WARPCAST
                </a>
              </div>
            ) : (
              <div className="bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-4 space-y-4 backdrop-blur">
                <div className="flex items-center justify-between text-xs uppercase tracking-widest text-[var(--moss-green)]">
                  <span>Scan status</span>
                  <span>
                    {activeStepIndex + 1}/{scanSteps.length}
                  </span>
                </div>
                <p className="text-base">{currentDescription}</p>
                <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full status-progress" style={{ width: `${scanProgress}%` }} />
                </div>
                <div className="space-y-1 text-left text-xs uppercase tracking-wider">
                  {scanSteps.map((step, idx) => (
                    <div
                      key={step.key}
                      className={`flex items-center justify-between ${
                        idx <= activeStepIndex ? 'text-[var(--moss-green)]' : 'opacity-40'
                      }`}
                    >
                      <span>{step.label}</span>
                      <span>
                        {idx < activeStepIndex ? '✓' : idx === activeStepIndex ? '↺' : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleSignIn}
              className="pixel-font px-8 py-4 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-all transform hover:scale-105 glow-purple disabled:opacity-40"
              disabled={!statusState.actionable}
            >
              {statusState.label}
            </button>

            <p className="text-xs opacity-70">{statusState.detail}</p>

            {error && <p className="text-red-400 mt-4">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <BackgroundOrbs />
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
      </div>
    );
  }

  if (airdropData?.eligible) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <BackgroundOrbs />
        <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
          <div className="max-w-3xl w-full space-y-6 scanline p-8 bg-black/50 rounded-lg border-2 border-[var(--monad-purple)]">
            <div className="flex justify-center">
              <Image
                src="/brand/logo.png"
                alt="m00n"
                width={120}
                height={120}
                className="block rounded-full border border-[var(--monad-purple)] bg-black/40 p-2"
              />
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

            {renderSessionCard(userData.fid, primaryAddress)}
            {dropAddress && dropAddress !== primaryAddress && (
              <p className="text-xs opacity-70">
                Allocation detected on{' '}
                <span className="font-mono">{`${dropAddress.slice(0, 6)}…${dropAddress.slice(-4)}`}</span>
                .
              </p>
            )}

            {tier && engagementData?.isFollowing && (
              <div
                className={`mt-6 p-6 bg-purple-900/30 rounded-lg border border-[var(--moss-green)] ${showLootReveal ? 'crt-flicker' : ''}`}
              >
                <h3 className="pixel-font text-lg mb-3 text-[var(--moss-green)]">
                  {tier.icon} {tier.title}
                </h3>
                <p className="text-sm mb-4 italic">{tier.flavorText}</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Tier: {tier.name}</span>
                    <span>Replies: {engagementData.replyCount}</span>
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

            <div className="text-center">
              <button
                onClick={() => setShowLorePanel((prev) => !prev)}
                className="pixel-font text-xs px-4 py-2 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-colors"
              >
                {showLorePanel ? 'Hide detail scan' : 'Reveal detail scan'}
              </button>
            </div>

            {showLorePanel && (
              <div className="p-4 border border-[var(--monad-purple)] rounded-lg bg-black/40 space-y-2 text-left">
                <p className="text-sm uppercase tracking-wide text-[var(--moss-green)]">
                  Allocation telemetry
                </p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>
                    Claim wallet:{' '}
                    {dropAddress
                      ? `${dropAddress.slice(0, 6)}…${dropAddress.slice(-4)}`
                      : primaryAddress
                        ? `${primaryAddress.slice(0, 6)}…${primaryAddress.slice(-4)}`
                        : '—'}
                  </li>
                </ul>
              </div>
            )}

            <div className="flex justify-center mt-8">
              <button
                onClick={handleShare}
                className="pixel-font px-6 py-3 bg-[var(--monad-purple)] text-white rounded hover:bg-opacity-90 transition-all"
              >
                SHARE CAST
              </button>
            </div>

            {renderContractCard()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <BackgroundOrbs />
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
        <div className="max-w-2xl w-full text-center space-y-6 scanline shake">
          <div className="flex justify-center">
            <Image
              src="/brand/logo.png"
              alt="m00n"
              width={150}
              height={150}
              className="block opacity-60 rounded-full border border-[var(--monad-purple)] bg-black/50 p-3"
            />
          </div>

          <h1 className="pixel-font text-2xl text-red-400">ACCESS DENIED</h1>

          <p className="text-lg opacity-70">
            You don&apos;t have to go home, but you can&apos;t stay here.
          </p>

          <div className="text-sm text-left bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-4 space-y-2">
            <p className="uppercase text-[var(--moss-green)] text-xs tracking-widest">Session</p>
            <p>FID: {userData.fid}</p>
            <p>
              Wallet:{' '}
              {primaryAddress ? `${primaryAddress.slice(0, 6)}…${primaryAddress.slice(-4)}` : '—'}
            </p>
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
    </div>
  );
}
