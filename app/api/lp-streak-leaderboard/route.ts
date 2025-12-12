import { NextRequest, NextResponse } from 'next/server';
import {
  getStreakLeaderboard,
  buildStreakLeaderboard,
  updateStreaks
} from '@/app/lib/streakTracker';

const FALLBACK_REBUILD_ENABLED = process.env.NODE_ENV !== 'production';

// GET: Fetch the streak leaderboard (also handles Vercel cron)
export async function GET(request: NextRequest) {
  try {
    // Check if this is a Vercel cron job
    const isCronJob = request.headers.get('x-vercel-cron') === '1';

    if (isCronJob) {
      console.log('[streak-leaderboard] Cron job triggered, updating streaks...');
      const result = await updateStreaks();
      console.log('[streak-leaderboard] Cron update complete:', result);

      const leaderboard = await buildStreakLeaderboard();
      console.log(
        '[streak-leaderboard] Leaderboard rebuilt with',
        leaderboard.totalPositionsTracked,
        'positions'
      );

      return NextResponse.json({
        success: true,
        cronTriggered: true,
        ...result,
        totalPositionsTracked: leaderboard.totalPositionsTracked
      });
    }

    // Regular GET - just fetch the leaderboard
    let leaderboard = await getStreakLeaderboard();

    // In dev mode, rebuild if not available
    if (!leaderboard && FALLBACK_REBUILD_ENABLED) {
      console.log('[streak-leaderboard] No leaderboard found, rebuilding...');
      await updateStreaks();
      leaderboard = await buildStreakLeaderboard();
    }

    if (!leaderboard) {
      return NextResponse.json({ error: 'streak_leaderboard_unavailable' }, { status: 503 });
    }

    return NextResponse.json(leaderboard);
  } catch (error) {
    console.error('Streak leaderboard lookup failed', error);
    return NextResponse.json({ error: 'streak_leaderboard_failed' }, { status: 500 });
  }
}

// POST: Trigger a streak update (for cron jobs or admin)
export async function POST(request: Request) {
  try {
    // Optional: Check for admin secret
    const secret = request.headers.get('x-admin-secret');
    const expectedSecret = process.env.LP_TELEMETRY_SECRET;

    if (expectedSecret && secret !== expectedSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    console.log('[streak-leaderboard] Updating streaks...');
    const result = await updateStreaks();
    console.log('[streak-leaderboard] Update complete:', result);

    console.log('[streak-leaderboard] Building leaderboard...');
    const leaderboard = await buildStreakLeaderboard();
    console.log(
      '[streak-leaderboard] Leaderboard built with',
      leaderboard.totalPositionsTracked,
      'positions'
    );

    return NextResponse.json({
      success: true,
      ...result,
      totalPositionsTracked: leaderboard.totalPositionsTracked,
      topStreaksCount: leaderboard.topStreaks.length
    });
  } catch (error) {
    console.error('Streak update failed', error);
    return NextResponse.json({ error: 'streak_update_failed' }, { status: 500 });
  }
}
