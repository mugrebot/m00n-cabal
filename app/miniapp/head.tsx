export default function MiniAppHead() {
  const miniAppUrl = 'https://m00nad.vercel.app/miniapp';
  const bannerUrl = 'https://m00nad.vercel.app/brand/banner.png';

  return (
    <>
      <title>m00n Cabal Check</title>
      <meta
        name="description"
        content="Scan your Farcaster FID to see if you made the m00n cabal."
      />
      <meta property="og:title" content="m00n Cabal Check" />
      <meta
        property="og:description"
        content="Scan your Farcaster FID to see if you made the m00n cabal."
      />
      <meta property="og:image" content={bannerUrl} />
      <meta property="og:url" content={miniAppUrl} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="m00n Cabal Check" />
      <meta
        name="twitter:description"
        content="Scan your Farcaster FID to see if you made the m00n cabal."
      />
      <meta name="twitter:image" content={bannerUrl} />
      <meta name="fc:frame" content="vNext" />
      <meta name="fc:frame:image" content={bannerUrl} />
      <meta name="fc:frame:button:1" content="Open Mini App" />
      <meta name="fc:frame:post_url" content={miniAppUrl} />
    </>
  );
}
