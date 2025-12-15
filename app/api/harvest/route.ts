/**
 * Harvest Tracking API
 *
 * GET: Get user's harvest stats
 * POST: Record a harvest
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getUserHarvestStats,
  recordHarvest,
  getWeeklySummary,
  getGlobalHarvestTotals,
  getWeekId,
  formatPoints
} from '@/app/lib/harvestTracking';
import { creditReferralPoints } from '@/app/lib/referrals';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fid = searchParams.get('fid');
    const action = searchParams.get('action');

    // Get weekly summary
    if (action === 'weekly') {
      const weekId = searchParams.get('weekId') ?? getWeekId();
      const summary = await getWeeklySummary(weekId);
      return NextResponse.json(summary ?? { weekId, totalHarvests: 0, totalPoints: 0 });
    }

    // Get global totals
    if (action === 'totals') {
      const totals = await getGlobalHarvestTotals();
      return NextResponse.json(totals ?? { harvests: 0, valueUsd: 0, points: 0 });
    }

    // Get user's harvest stats
    if (fid) {
      const stats = await getUserHarvestStats(Number(fid));

      if (!stats) {
        return NextResponse.json({
          fid: Number(fid),
          totalHarvests: 0,
          totalValueUsd: 0,
          totalPoints: 0,
          currentWeekId: getWeekId(),
          currentWeekHarvests: 0,
          currentWeekValueUsd: 0,
          currentWeekPoints: 0
        });
      }

      return NextResponse.json({
        ...stats,
        totalPointsFormatted: formatPoints(stats.totalPoints),
        currentWeekPointsFormatted: formatPoints(stats.currentWeekPoints)
      });
    }

    return NextResponse.json({ error: 'missing_fid_or_action' }, { status: 400 });
  } catch (error) {
    console.error('[harvest] GET error:', error);
    return NextResponse.json({ error: 'harvest_fetch_failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      fid,
      username,
      address,
      tokenId,
      wmonAmountWei,
      moonAmountWei,
      wmonPriceUsd,
      moonPriceUsd,
      txHash
    } = body;

    if (!fid || !address || !tokenId) {
      return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 });
    }

    // Record the harvest
    const result = await recordHarvest({
      fid: Number(fid),
      username: username ?? `fid:${fid}`,
      address,
      tokenId,
      wmonAmountWei: wmonAmountWei ?? '0',
      moonAmountWei: moonAmountWei ?? '0',
      wmonPriceUsd: Number(wmonPriceUsd) || 0,
      moonPriceUsd: Number(moonPriceUsd) || 0,
      txHash
    });

    // Credit referral points if user was referred
    if (result.success) {
      await creditReferralPoints(Number(fid), result.harvest.totalPoints);
    }

    return NextResponse.json({
      success: result.success,
      message: result.message,
      harvest: {
        id: result.harvest.id,
        totalValueUsd: result.harvest.totalValueUsd,
        basePoints: result.harvest.basePoints,
        bonusPoints: result.harvest.bonusPoints,
        totalPoints: result.harvest.totalPoints,
        tierMultiplier: result.harvest.tierMultiplier
      }
    });
  } catch (error) {
    console.error('[harvest] POST error:', error);
    return NextResponse.json({ error: 'harvest_record_failed' }, { status: 500 });
  }
}
