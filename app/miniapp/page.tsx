'use client';

import { useEffect, useMemo, useState } from 'react';
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

export default function MiniAppPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [airdropData, setAirdropData] = useState<AirdropData | null>(null);
  const [engagementData, setEngagementData] = useState<EngagementData | null>(null);
  const [showLootReveal, setShowLootReveal] = useState(false);
  const [showLorePanel, setShowLorePanel] = useState(false);
  const [glyphIndex, setGlyphIndex] = useState(0);
  const [torchIntensity, setTorchIntensity] = useState(40);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bootstrapSdk = async () => {
      try {
        await sdk.actions.ready();
        setIsSdkReady(true);
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

      const addressesResponse = await fetch(`/api/addresses?fid=${user.fid}`);
      if (!addressesResponse.ok) {
        setError('Unable to sync verified addresses. Please try again.');
        return;
      }

      const addressData = (await addressesResponse.json()) as { addresses: string[] };
      const addresses = addressData.addresses ?? [];
      const primaryAddress = addresses[0];

      if (!primaryAddress) {
        setError('No verified address available. Add a wallet in Warpcast and retry.');
        return;
      }

      setUserData({
        fid: user.fid,
        username: user.username,
        displayName: user.displayName,
        verifiedAddresses: addresses
      });

      const airdropResponse = await fetch(`/api/airdrop?address=${primaryAddress}`);
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

  const handleTorchChange = (value: number) => {
    setTorchIntensity(value);
  };

  if (!userData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
        <div className="max-w-2xl w-full text-center space-y-8 scanline">
          <Image
            src="/brand/banner.png"
            alt="m00n Cabal"
            width={600}
            height={200}
            className="mx-auto"
            priority
          />

          <h1 className="pixel-font text-2xl md:text-3xl glow-purple">m00n Cabal Check</h1>

          <div className="space-y-4">
            <p className="text-lg opacity-90">Check your $m00n eligibility.</p>

            <div className="bg-black/40 border border-[var(--monad-purple)] rounded-lg p-4 space-y-2">
              <p className="text-sm uppercase tracking-wide text-[var(--moss-green)]">
                Status console
              </p>
              <p className="text-base">{ritualGlyphs[glyphIndex]}</p>
              <button
                onClick={handleGlyphCycle}
                className="pixel-font text-xs px-4 py-2 bg-[var(--moss-green)] text-black rounded hover:bg-opacity-80 transition-all"
              >
                Cycle diagnostic
              </button>
            </div>

            <button
              onClick={handleSignIn}
              className="pixel-font px-8 py-4 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-all transform hover:scale-105 glow-purple disabled:opacity-40"
              disabled={isLoading || !isSdkReady}
            >
              {!isSdkReady ? 'SYNCING SDK...' : isLoading ? 'LOADING...' : 'SCAN WALLET'}
            </button>
          </div>

          {error && <p className="text-red-400 mt-4">{error}</p>}

          <div className="mt-8 opacity-60">
            <div className="text-sm animate-pulse">++ MONAD PURPLE PROTOCOL ++ SIGNAL FID ++</div>
          </div>

          <div className="mt-6 space-y-2">
            <label htmlFor="torch-range" className="text-xs uppercase opacity-70 block">
              Torch glow
            </label>
            <input
              id="torch-range"
              type="range"
              min="10"
              max="90"
              value={torchIntensity}
              onChange={(event) => handleTorchChange(Number(event.target.value))}
              className="w-full accent-[var(--monad-purple)]"
            />
            <p className="text-xs opacity-70">Intensity: {torchIntensity}%</p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
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

  if (airdropData?.eligible) {
    return (
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
    );
  }

  return (
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

        <div className="space-y-2">
          <label htmlFor="torch-control" className="text-xs uppercase opacity-60 block">
            Torch intensity
          </label>
          <input
            id="torch-control"
            type="range"
            min="10"
            max="90"
            value={torchIntensity}
            onChange={(event) => handleTorchChange(Number(event.target.value))}
            className="w-full accent-[var(--monad-purple)]"
          />
          <p className="text-xs opacity-70">Glow level: {torchIntensity}%</p>
        </div>

        <div className="flex justify-center space-x-4 opacity-30">
          <span style={{ filter: `brightness(${torchIntensity / 50})` }}>🔥</span>
          <span style={{ filter: `brightness(${torchIntensity / 50})` }}>🔥</span>
          <span style={{ filter: `brightness(${torchIntensity / 50})` }}>🔥</span>
        </div>
      </div>
    </div>
  );
}
