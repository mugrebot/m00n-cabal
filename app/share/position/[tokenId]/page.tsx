import { Metadata } from 'next';
import { redirect } from 'next/navigation';

type Props = {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { tokenId } = await params;
  const sp = await searchParams;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://m00ncabal.xyz';

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

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: ogImageUrl,
          width: 800,
          height: 500,
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
    // Farcaster Frame meta tags for frame v1 compatibility
    other: {
      'fc:frame': 'vNext',
      'fc:frame:image': ogImageUrl,
      'fc:frame:image:aspect_ratio': '1.91:1',
      'fc:frame:button:1': 'Open m00n cabal 🌙',
      'fc:frame:button:1:action': 'link',
      'fc:frame:button:1:target': `${baseUrl}/miniapp?position=${tokenId}`
    }
  };
}

export default async function SharePositionPage({ params, searchParams }: Props) {
  const { tokenId } = await params;

  // Server-side redirect after a brief delay isn't possible in RSC
  // So we redirect immediately but the metadata is already set for crawlers
  redirect(`/miniapp?position=${tokenId}`);
}
