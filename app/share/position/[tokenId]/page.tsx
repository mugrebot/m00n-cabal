import { Metadata } from 'next';
import ShareRedirect from './ShareRedirect';

type Props = {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { tokenId } = await params;
  const sp = await searchParams;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://m00nad.vercel.app';

  // Build OG image URL with all the position data
  const ogParams = new URLSearchParams({
    tokenId,
    bandType: (sp.bandType as string) || 'custom',
    rangeStatus: (sp.rangeStatus as string) || 'unknown',
    rangeLower: (sp.rangeLower as string) || '0',
    rangeUpper: (sp.rangeUpper as string) || '0',
    username: (sp.username as string) || 'anon'
  });

  const ogImageUrl = `${baseUrl}/api/og/position?${ogParams.toString()}`;

  const bandType = (sp.bandType as string) || 'custom';
  const rangeStatus = (sp.rangeStatus as string) || 'unknown';
  const isInRange = rangeStatus === 'in-range';

  const bandLabel =
    bandType === 'crash_band'
      ? '🔻 Crash Band'
      : bandType === 'upside_band'
        ? '🚀 Sky Band'
        : '🎯 Custom';

  const title = `m00n LP #${tokenId} | ${bandLabel}`;
  const description = isInRange
    ? `This position is currently in range and earning fees! 🌙`
    : `Watching the market from the m00n cabal 🌙`;

  // Farcaster Mini App Embed JSON (per spec: https://miniapps.farcaster.xyz/docs)
  const miniAppEmbed = {
    version: '1',
    imageUrl: ogImageUrl,
    button: {
      title: 'View Position 🌙',
      action: {
        type: 'launch_frame',
        name: 'm00n cabal',
        url: `${baseUrl}/miniapp?position=${tokenId}`,
        splashImageUrl: `${baseUrl}/brand/splash.svg`,
        splashBackgroundColor: '#0a0612'
      }
    }
  };

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 800,
          alt: `m00n LP Position #${tokenId}`
        }
      ],
      type: 'website',
      siteName: 'm00n cabal'
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl]
    },
    // Farcaster Mini App embed meta tag
    other: {
      'fc:miniapp': JSON.stringify(miniAppEmbed),
      // Legacy frame support
      'fc:frame': JSON.stringify(miniAppEmbed)
    }
  };
}

export default async function SharePositionPage({ params }: Props) {
  const { tokenId } = await params;

  return <ShareRedirect tokenId={tokenId} />;
}
