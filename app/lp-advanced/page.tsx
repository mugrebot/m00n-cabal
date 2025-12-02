import Link from 'next/link';

export default function LpAdvancedPage() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8">
      <div className="max-w-3xl w-full space-y-4 text-center">
        <p className="pixel-font text-xs tracking-[0.4em] text-[var(--moss-green)] uppercase">
          LP Lab
        </p>
        <h1 className="text-3xl font-semibold">Advanced Single-Sided Deployment</h1>
        <p className="text-sm text-white/80">
          This page is under construction — soon you&apos;ll be able to connect any wallet
          (including MetaMask) and deploy custom m00n/W-MON positions with human-friendly controls.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/miniapp"
            className="pixel-font px-6 py-3 border border-white/20 rounded-lg hover:bg-white/10 transition-colors"
          >
            Back to Cabal Check
          </Link>
          <a
            href="https://warpcast.com/~/add-mini-app?domain=m00nad.vercel.app"
            className="pixel-font px-6 py-3 border border-[var(--monad-purple)] text-[var(--monad-purple)] rounded-lg hover:bg-[var(--monad-purple)] hover:text-black transition-colors"
          >
            Install Mini App
          </a>
        </div>
        <div className="text-xs text-white/60">
          Need a bespoke LP right now? Ping @m00npapi.eth and we&apos;ll wire it manually.
        </div>
      </div>
    </main>
  );
}
