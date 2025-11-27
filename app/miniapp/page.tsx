'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import sdk from '@farcaster/miniapp-sdk';
import { toPng } from 'html-to-image';
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

export default function MiniAppPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [isMiniApp, setIsMiniApp] = useState<boolean | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [airdropData, setAirdropData] = useState<AirdropData | null>(null);
  const [engagementData, setEngagementData] = useState<EngagementData | null>(null);
  const [showLootReveal, setShowLootReveal] = useState(false);
  const [showLorePanel, setShowLorePanel] = useState(false);
  const [glyphIndex, setGlyphIndex] = useState(0);
  const [primaryAddress, setPrimaryAddress] = useState<string | null>(null);
  const [viewerContext, setViewerContext] = useState<ViewerContext | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [isSoundtrackPlaying, setIsSoundtrackPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  const ritualGlyphs = useMemo(
    () => [
      'relay tuned • awaiting wallet signal',
      'airdrop ledger • checksum verified',
      'engagement scanner • syncing replies',
      'loot framework • particles stabilized'
    ],
    []
  );

  useEffect(() => {
    if (isMiniApp === false) return;
    const interval = setInterval(() => {
      setGlyphIndex((prev) => (prev + 1) % ritualGlyphs.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [isMiniApp, ritualGlyphs.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handlePlay = () => setIsSoundtrackPlaying(true);
    const handleStop = () => setIsSoundtrackPlaying(false);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handleStop);
    audio.addEventListener('ended', handleStop);
    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handleStop);
      audio.removeEventListener('ended', handleStop);
      audio.pause();
    };
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

  const handleSignIn = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const nonce =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`;
      await sdk.actions.signIn({ nonce });

      const context = await sdk.context;
      const user = context.user;

      if (!user) {
        setError('No Farcaster user detected. Please try again.');
        return;
      }

      setViewerContext({
        fid: user.fid,
        username: user.username,
        displayName: user.displayName
      });

      const fetchedAddresses = addresses.length > 0 ? addresses : await syncAddresses(user.fid);
      const derivedPrimaryAddress = fetchedAddresses[0];

      if (!derivedPrimaryAddress) {
        setError('No verified address available. Add a wallet in Warpcast and retry.');
        return;
      }

      setPrimaryAddress(derivedPrimaryAddress);

      setUserData({
        fid: user.fid,
        username: user.username,
        displayName: user.displayName,
        verifiedAddresses: fetchedAddresses
      });

      const airdropResponse = await fetch(`/api/airdrop?address=${derivedPrimaryAddress}`);
      const airdropResult = await airdropResponse.json();
      setAirdropData(airdropResult);

      const engagementResponse = await fetch(`/api/engagement?fid=${user.fid}`);
      if (engagementResponse.ok) {
        const engagementResult = await engagementResponse.json();
        setEngagementData(engagementResult);

        if (
          airdropResult.eligible &&
          engagementResult.isFollowing &&
          engagementResult.replyCount > 0
        ) {
          setShowLootReveal(true);
        }
      }
    } catch (err) {
      console.error('Sign in error:', err);
      setError('Failed to authenticate. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const formatAmount = (amount: string) => {
    return parseInt(amount).toLocaleString();
  };

  const handleShare = async () => {
    if (!airdropData?.eligible || !airdropData.amount) return;

    const text = `I'm part of the m00n cabal! Receiving ${formatAmount(airdropData.amount)} $m00n tokens 🌙✨`;
    await sdk.actions.openUrl(`https://warpcast.com/~/compose?text=${encodeURIComponent(text)}`);
  };

  const handleDownloadReceipt = async () => {
    const element = document.getElementById('receipt-content');
    if (!element) return;

    try {
      const dataUrl = await toPng(element);
      const link = document.createElement('a');
      link.download = 'm00n-cabal-receipt.png';
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to generate receipt:', err);
    }
  };

  const tier = engagementData ? getTierByReplyCount(engagementData.replyCount) : null;

  const handleGlyphCycle = () => {
    setGlyphIndex((prev) => (prev + 1) % ritualGlyphs.length);
  };

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

  const handleSoundtrackToggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  };

  const SoundtrackControl = () => (
    <div className="bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-4 space-y-3 backdrop-blur">
      <p className="text-sm uppercase tracking-wide text-[var(--moss-green)]">Soundtrack</p>
      <p className="text-xs opacity-70">Blue • m00n cabal mix</p>
      <button
        onClick={handleSoundtrackToggle}
        className="pixel-font text-xs px-4 py-2 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-all"
      >
        {isSoundtrackPlaying ? 'PAUSE SOUNDTRACK' : 'PLAY SOUNDTRACK'}
      </button>
    </div>
  );

  const soundtrackElement = (
    <audio ref={audioRef} src="/audio/blue.mp3" loop preload="auto" className="hidden" />
  );

  const statusProgress = ((glyphIndex + 1) / ritualGlyphs.length) * 100;

  if (!userData) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        {soundtrackElement}
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
              <div className="bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-4 space-y-3 backdrop-blur">
                <div className="flex items-center justify-between text-xs uppercase tracking-widest text-[var(--moss-green)]">
                  <span>Signal feed</span>
                  <span>
                    {glyphIndex + 1}/{ritualGlyphs.length}
                  </span>
                </div>
                <p className="text-base">{ritualGlyphs[glyphIndex]}</p>
                <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full status-progress" style={{ width: `${statusProgress}%` }} />
                </div>
                <button
                  onClick={handleGlyphCycle}
                  className="pixel-font text-xs px-4 py-2 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-all"
                >
                  Cycle diagnostic
                </button>
              </div>
            )}

            {isMiniApp !== false && <SoundtrackControl />}

            <button
              onClick={handleSignIn}
              className="pixel-font px-8 py-4 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-all transform hover:scale-105 glow-purple disabled:opacity-40"
              disabled={isLoading || !isSdkReady || isMiniApp === false}
            >
              {!isSdkReady ? 'SYNCING SDK...' : isLoading ? 'CONNECTING...' : 'SCAN FID'}
            </button>

            {error && <p className="text-red-400 mt-4">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        {soundtrackElement}
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
        {soundtrackElement}
        <BackgroundOrbs />
        <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
          <div
            id="receipt-content"
            className="max-w-3xl w-full space-y-6 scanline p-8 bg-black/50 rounded-lg border-2 border-[var(--monad-purple)]"
          >
            <Image src="/brand/logo.png" alt="m00n" width={100} height={100} className="mx-auto" />

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
                  <li>Primary wallet: {userData.verifiedAddresses[0]}</li>
                  <li>Receipt hash ready for download</li>
                  <li>Engagement tier weight boosts your loot narrative</li>
                </ul>
              </div>
            )}

            {isMiniApp !== false && <SoundtrackControl />}

            <div className="flex gap-4 justify-center mt-8">
              <button
                onClick={handleShare}
                className="pixel-font px-6 py-3 bg-[var(--monad-purple)] text-white rounded hover:bg-opacity-90 transition-all"
              >
                SHARE CAST
              </button>
              <button
                onClick={handleDownloadReceipt}
                className="pixel-font px-6 py-3 bg-[var(--moss-green)] text-black rounded hover:bg-opacity-90 transition-all"
              >
                DOWNLOAD RECEIPT
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      {soundtrackElement}
      <BackgroundOrbs />
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
        <div className="max-w-2xl w-full text-center space-y-6 scanline shake">
          <Image
            src="/brand/logo.png"
            alt="m00n"
            width={150}
            height={150}
            className="mx-auto opacity-50"
          />

          <h1 className="pixel-font text-2xl text-red-400">ACCESS DENIED</h1>

          <p className="text-lg opacity-70">you are not part of the cabal maybe next time</p>
          <div className="text-sm text-left bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-4 space-y-2">
            <p className="uppercase text-[var(--moss-green)] text-xs tracking-widest">Session</p>
            <p>FID: {userData.fid}</p>
            <p>
              Wallet:{' '}
              {primaryAddress ? `${primaryAddress.slice(0, 6)}…${primaryAddress.slice(-4)}` : '—'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
