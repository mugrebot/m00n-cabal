import { NextResponse } from 'next/server';
import { buildLeaderboardSnapshot, type LeaderboardSnapshot } from '@/app/lib/lpTelemetry';

const LEADERBOARD_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

let cachedLeaderboard: LeaderboardSnapshot | null = null;
let leaderboardExpiresAt = 0;
let leaderboardInFlight: Promise<LeaderboardSnapshot> | null = null;

async function computeLeaderboard(): Promise<LeaderboardSnapshot> {
  return buildLeaderboardSnapshot();
}

export async function GET() {
  try {
    const now = Date.now();
    if (cachedLeaderboard && now < leaderboardExpiresAt) {
      return NextResponse.json(cachedLeaderboard);
    }

    if (!leaderboardInFlight) {
      leaderboardInFlight = computeLeaderboard()
        .then((payload) => {
          cachedLeaderboard = payload;
          leaderboardExpiresAt = Date.now() + LEADERBOARD_CACHE_TTL_MS;
          leaderboardInFlight = null;
          return payload;
        })
        .catch((error) => {
          leaderboardInFlight = null;
          throw error;
        });
    }

    const payload = await leaderboardInFlight;
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Leaderboard lookup failed', error);
    if (cachedLeaderboard) {
      return NextResponse.json({ ...cachedLeaderboard, stale: true });
    }
    return NextResponse.json({ error: 'leaderboard_failed' }, { status: 500 });
  }
}
