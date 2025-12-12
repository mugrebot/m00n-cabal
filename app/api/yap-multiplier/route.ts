import { NextRequest, NextResponse } from 'next/server';
import {
  getYapStats,
  updateYapStats,
  getYapLeaderboard,
  buildYapLeaderboard
} from '@/app/lib/yapMultiplier';

// GET: Get yap stats for a user or the leaderboard
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fid = searchParams.get('fid');
    const action = searchParams.get('action');

    // Get leaderboard
    if (action === 'leaderboard') {
      const leaderboard = await getYapLeaderboard();
      if (!leaderboard) {
        return NextResponse.json({ topYappers: [], totalQualifiedYappers: 0 });
      }
      return NextResponse.json(leaderboard);
    }

    // Get stats for specific FID
    if (fid) {
      const stats = await getYapStats(Number(fid));
      if (!stats) {
        return NextResponse.json({
          fid: Number(fid),
          multiplier: 1,
          multiplierTier: '—',
          castCount: 0,
          message: 'No yap data yet. Yap about $m00n to boost your score!'
        });
      }
      return NextResponse.json(stats);
    }

    return NextResponse.json({ error: 'missing_fid_or_action' }, { status: 400 });
  } catch (error) {
    console.error('[yap-multiplier] GET error:', error);
    return NextResponse.json({ error: 'yap_fetch_failed' }, { status: 500 });
  }
}

// POST: Update yap stats for a user or rebuild leaderboard
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    // Rebuild leaderboard (admin/cron)
    if (action === 'rebuild_leaderboard') {
      const leaderboard = await buildYapLeaderboard();
      return NextResponse.json({
        success: true,
        totalQualifiedYappers: leaderboard.totalQualifiedYappers
      });
    }

    // Update stats for a user
    if (action === 'update_stats') {
      const fid = body.fid as number;
      const username = body.username as string;
      const address = body.address as string | undefined;

      if (!fid || !username) {
        return NextResponse.json({ error: 'missing_fid_or_username' }, { status: 400 });
      }

      const stats = await updateYapStats(fid, username, address);
      if (!stats) {
        return NextResponse.json({ error: 'yap_update_failed' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        multiplier: stats.multiplier,
        multiplierTier: stats.multiplierTier,
        castCount: stats.castCount,
        totalLikes: stats.totalLikes,
        totalRecasts: stats.totalRecasts
      });
    }

    return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  } catch (error) {
    console.error('[yap-multiplier] POST error:', error);
    return NextResponse.json({ error: 'yap_update_failed' }, { status: 500 });
  }
}
