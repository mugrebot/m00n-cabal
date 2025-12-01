import { NextResponse } from 'next/server';
import { buildLeaderboardSnapshot } from '@/app/lib/lpTelemetry';
import { readLeaderboardSnapshot, writeLeaderboardSnapshot } from '@/app/lib/lpTelemetryStore';

const FALLBACK_REBUILD_ENABLED = process.env.NODE_ENV !== 'production';

export async function GET() {
  try {
    let payload = await readLeaderboardSnapshot();

    if (!payload && FALLBACK_REBUILD_ENABLED) {
      payload = await buildLeaderboardSnapshot();
      await writeLeaderboardSnapshot(payload);
    }

    if (!payload) {
      return NextResponse.json({ error: 'leaderboard_unavailable' }, { status: 503 });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Leaderboard lookup failed', error);
    return NextResponse.json({ error: 'leaderboard_failed' }, { status: 500 });
  }
}
