export default function MiniAppHead() {
  const miniAppUrl = 'https://m00nad.vercel.app/miniapp/';
  const bannerUrl = 'https://m00nad.vercel.app/brand/banner.png';
  const splashUrl = 'https://m00nad.vercel.app/brand/splash.svg';
  const embedMeta = JSON.stringify({
    version: '1',
    imageUrl: bannerUrl,
    button: {
      title: 'm00n cabal check',
      action: {
        type: 'launch_frame',
        name: 'm00n Cabal Check',
        url: miniAppUrl,
        splashImageUrl: splashUrl,
        splashBackgroundColor: '#130B25'
      }
    }
  });

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
      <meta name="fc:frame" content={embedMeta} />
      <meta name="fc:miniapp" content={embedMeta} />
    </>
  );
}
