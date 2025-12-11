'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ShareRedirect({ tokenId }: { tokenId: string }) {
  const router = useRouter();

  useEffect(() => {
    // Redirect after a short delay to ensure meta tags are processed
    const timer = setTimeout(() => {
      router.replace(`/miniapp?position=${tokenId}`);
    }, 100);

    return () => clearTimeout(timer);
  }, [router, tokenId]);

  return (
    <div className="min-h-screen bg-[#0a0612] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="text-6xl animate-pulse">🌙</div>
        <p className="text-white/70 text-sm tracking-widest uppercase">
          Loading position #{tokenId}...
        </p>
        <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-[#6ce5b1] to-transparent mx-auto animate-pulse" />
        <a
          href={`/miniapp?position=${tokenId}`}
          className="text-[#6ce5b1] text-xs hover:underline block mt-4"
        >
          Click here if not redirected
        </a>
      </div>
    </div>
  );
}
