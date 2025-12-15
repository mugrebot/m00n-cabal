/**
 * Referrals API
 *
 * GET: Get user's referral stats
 * POST: Record a referral
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getReferralStats,
  recordReferral,
  formatReferralPoints,
  DIRECT_REFERRAL_BONUS,
  SECOND_DEGREE_BONUS
} from '@/app/lib/referrals';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fid = searchParams.get('fid');

    if (!fid) {
      return NextResponse.json({ error: 'missing_fid' }, { status: 400 });
    }

    const stats = await getReferralStats(Number(fid));

    return NextResponse.json({
      ...stats,
      totalReferralPointsFormatted: formatReferralPoints(stats.totalReferralPoints),
      bonusRates: {
        direct: `${DIRECT_REFERRAL_BONUS * 100}%`,
        secondDegree: `${SECOND_DEGREE_BONUS * 100}%`
      }
    });
  } catch (error) {
    console.error('[referrals] GET error:', error);
    return NextResponse.json({ error: 'referrals_fetch_failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { referrerFid, refereeFid, refereeUsername, refereeAddress } = body;

    if (!referrerFid || !refereeFid || !refereeAddress) {
      return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 });
    }

    const result = await recordReferral(
      Number(referrerFid),
      Number(refereeFid),
      refereeUsername ?? `fid:${refereeFid}`,
      refereeAddress
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[referrals] POST error:', error);
    return NextResponse.json({ error: 'referral_failed' }, { status: 500 });
  }
}
