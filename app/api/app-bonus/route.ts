import { NextRequest, NextResponse } from 'next/server';
import {
  getAppAddedStatus,
  recordAppAdded,
  getTotalAppAddedCount,
  APP_ADDED_MULTIPLIER
} from '@/app/lib/appBonus';

// GET: Check if user has added the app
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fid = searchParams.get('fid');
    const action = searchParams.get('action');

    // Get total count
    if (action === 'total') {
      const count = await getTotalAppAddedCount();
      return NextResponse.json({ totalAdded: count });
    }

    // Get status for specific FID
    if (fid) {
      const status = await getAppAddedStatus(Number(fid));
      return NextResponse.json({
        fid: Number(fid),
        ...status,
        multiplierValue: APP_ADDED_MULTIPLIER
      });
    }

    return NextResponse.json({ error: 'missing_fid' }, { status: 400 });
  } catch (error) {
    console.error('[app-bonus] GET error:', error);
    return NextResponse.json({ error: 'app_bonus_fetch_failed' }, { status: 500 });
  }
}

// POST: Record that user added the app
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fid = body.fid as number;
    const username = body.username as string;
    const address = body.address as string | undefined;

    if (!fid || !username) {
      return NextResponse.json({ error: 'missing_fid_or_username' }, { status: 400 });
    }

    const record = await recordAppAdded(fid, username, address);

    return NextResponse.json({
      success: true,
      added: true,
      addedAt: record.addedAt,
      multiplier: APP_ADDED_MULTIPLIER,
      message: '🎉 App added! You now have a permanent 1.1x bonus.'
    });
  } catch (error) {
    console.error('[app-bonus] POST error:', error);
    return NextResponse.json({ error: 'app_bonus_save_failed' }, { status: 500 });
  }
}
