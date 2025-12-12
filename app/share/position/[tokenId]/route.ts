import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  const { tokenId } = await params;
  const { searchParams } = new URL(request.url);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://m00nad.vercel.app';

  // Build OG image URL with all the position data
  const ogParams = new URLSearchParams({
    tokenId,
    bandType: searchParams.get('bandType') || 'custom',
    rangeStatus: searchParams.get('rangeStatus') || 'unknown',
    rangeLower: searchParams.get('rangeLower') || '0',
    rangeUpper: searchParams.get('rangeUpper') || '0',
    username: searchParams.get('username') || 'anon'
  });

  const ogImageUrl = `${baseUrl}/api/og/position?${ogParams.toString()}`;

  const bandType = searchParams.get('bandType') || 'custom';
  const rangeStatus = searchParams.get('rangeStatus') || 'unknown';
  const isInRange = rangeStatus === 'in-range';

  const bandLabel =
    bandType === 'crash_band'
      ? '🔻 Crash Band'
      : bandType === 'upside_band'
        ? '🚀 Sky Band'
        : '🎯 Custom';

  const title =
    tokenId === 'new'
      ? `$m00n position | ${bandLabel}`
      : `$m00n position #${tokenId} | ${bandLabel}`;
  const description = isInRange
    ? `This position is currently in range and earning fees! 🌙`
    : `Watching the market from the m00n cabal 🌙`;

  // Farcaster Mini App Embed JSON
  const miniAppEmbed = JSON.stringify({
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
  });

  // Return static HTML with meta tags in <head>
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  
  <!-- Farcaster Mini App Embed - MUST be in head -->
  <meta name="fc:miniapp" content='${miniAppEmbed.replace(/'/g, '&#39;')}' />
  <meta name="fc:frame" content='${miniAppEmbed.replace(/'/g, '&#39;')}' />
  
  <!-- Open Graph -->
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${ogImageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="800" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="m00n cabal" />
  
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${ogImageUrl}" />
  
  <style>
    body {
      margin: 0;
      background: #0a0612;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, sans-serif;
    }
    .container {
      text-align: center;
      color: white;
    }
    .moon {
      font-size: 4rem;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .text {
      color: rgba(255,255,255,0.7);
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      margin-top: 1rem;
    }
    .link {
      color: #6ce5b1;
      font-size: 0.75rem;
      margin-top: 1.5rem;
      display: block;
    }
  </style>
  
  <!-- Auto-redirect after meta tags are read -->
  <meta http-equiv="refresh" content="0;url=${baseUrl}/miniapp?position=${tokenId}" />
</head>
<body>
  <div class="container">
    <div class="moon">🌙</div>
    <p class="text">Loading position #${tokenId}...</p>
    <a href="${baseUrl}/miniapp?position=${tokenId}" class="link">
      Click here if not redirected
    </a>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate'
    }
  });
}
