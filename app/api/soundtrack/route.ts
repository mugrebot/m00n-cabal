import { NextResponse } from 'next/server';

const DEFAULT_SOURCE_URL =
  'https://raw.githubusercontent.com/mugrebot/m00n-cabal/main/apps/m00n-cabal/public/audio/blue.mp3';

export async function GET() {
  const sourceUrl = process.env.SOUNDTRACK_SOURCE_URL ?? DEFAULT_SOURCE_URL;

  try {
    const response = await fetch(sourceUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Soundtrack fetch failed with status ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
      }
    });
  } catch (error) {
    console.error('Soundtrack proxy error', error);
    return NextResponse.json({ error: 'Soundtrack unavailable right now.' }, { status: 500 });
  }
}
