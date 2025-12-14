import { NextRequest, NextResponse } from 'next/server';
import {
  getCheckInStats,
  performCheckIn,
  getCheckInLeaderboard,
  buildCheckInLeaderboard,
  canCheckIn
} from '@/app/lib/dailyCheckIn';

// GET: Get check-in stats for a user or the leaderboard
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fid = searchParams.get('fid');
    const action = searchParams.get('action');

    // Get leaderboard
    if (action === 'leaderboard') {
      const leaderboard = await getCheckInLeaderboard();
      if (!leaderboard) {
        return NextResponse.json({ topStreakers: [], totalActiveUsers: 0 });
      }
      return NextResponse.json(leaderboard);
    }

    // Get stats for specific FID
    if (fid) {
      const stats = await getCheckInStats(Number(fid));
      if (!stats) {
        return NextResponse.json({
          fid: Number(fid),
          currentStreak: 0,
          totalCheckIns: 0,
          multiplier: 1,
          multiplierTier: '—',
          canCheckIn: true,
          message: 'No check-ins yet. Start your daily rhythm! 🌙'
        });
      }

      // Add canCheckIn status
      const {
        canCheckIn: canDo,
        nextAvailableAt,
        hoursUntilAvailable
      } = canCheckIn(stats.lastCheckInAt);

      return NextResponse.json({
        ...stats,
        canCheckIn: canDo,
        nextAvailableAt,
        hoursUntilAvailable
      });
    }

    return NextResponse.json({ error: 'missing_fid_or_action' }, { status: 400 });
  } catch (error) {
    console.error('[daily-checkin] GET error:', error);
    return NextResponse.json({ error: 'checkin_fetch_failed' }, { status: 500 });
  }
}

// POST: Perform a check-in or rebuild leaderboard
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    // Rebuild leaderboard (admin/cron)
    if (action === 'rebuild_leaderboard') {
      const leaderboard = await buildCheckInLeaderboard();
      return NextResponse.json({
        success: true,
        totalActiveUsers: leaderboard.totalActiveUsers
      });
    }

    // Perform check-in
    if (action === 'checkin') {
      const fid = body.fid as number;
      const username = body.username as string;
      const address = body.address as string | undefined;

      if (!fid || !username) {
        return NextResponse.json({ error: 'missing_fid_or_username' }, { status: 400 });
      }

      const result = await performCheckIn(fid, username, address);

      return NextResponse.json({
        success: result.success,
        message: result.message,
        currentStreak: result.stats.currentStreak,
        longestStreak: result.stats.longestStreak,
        totalCheckIns: result.stats.totalCheckIns,
        multiplier: result.stats.multiplier,
        multiplierTier: result.stats.multiplierTier,
        nextAvailableAt: result.stats.nextCheckInAvailableAt,
        streakExpiresAt: result.stats.streakExpiresAt,
        isNewStreak: result.isNewStreak,
        streakBroken: result.streakBroken,
        reward: result.reward
      });
    }

    return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  } catch (error) {
    console.error('[daily-checkin] POST error:', error);
    return NextResponse.json({ error: 'checkin_failed' }, { status: 500 });
  }
}
