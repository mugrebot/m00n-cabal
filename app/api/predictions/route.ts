/**
 * Prediction Market API
 *
 * GET: Fetch active markets and user stats
 * POST: Join a prediction market
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  type PredictionMarket,
  type UserPredictionStats,
  type JoinPredictionRequest,
  createSampleMarkets,
  PREDICTION_KV_KEYS,
  PREDICTION_CONSTANTS,
  generatePredictionId
} from '@/app/lib/predictionMarket';

// ============ GET: Fetch Markets ============

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fid = searchParams.get('fid');

    // Get active markets
    let markets = await kv.get<PredictionMarket[]>(PREDICTION_KV_KEYS.activeMarkets);

    // If no markets exist, create sample markets
    if (!markets || markets.length === 0) {
      // Fetch current m00n price
      let moonPriceUsd = 0.0000004; // Default fallback

      try {
        const priceRes = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL || 'https://m00nad.vercel.app'}/api/lp-funding?wallet=0x0000000000000000000000000000000000000000`
        );
        if (priceRes.ok) {
          const priceData = await priceRes.json();
          if (priceData.poolWmonUsdPrice && priceData.poolCurrentTick) {
            const moonPriceInWmon = Math.pow(1.0001, priceData.poolCurrentTick);
            moonPriceUsd = moonPriceInWmon * priceData.poolWmonUsdPrice;
          }
        }
      } catch {
        console.log('[PREDICTIONS] Using default m00n price');
      }

      markets = createSampleMarkets(moonPriceUsd);
      await kv.set(PREDICTION_KV_KEYS.activeMarkets, markets);
    }

    // Get user stats if FID provided
    let userStats: UserPredictionStats | null = null;
    if (fid) {
      userStats = await kv.get<UserPredictionStats>(PREDICTION_KV_KEYS.userStats(Number(fid)));
    }

    return NextResponse.json({
      markets: markets.filter((m) => m.status === 'active'),
      userStats,
      generated: !markets || markets.length === 0
    });
  } catch (error) {
    console.error('[PREDICTIONS] Error fetching markets:', error);
    return NextResponse.json({ error: 'Failed to fetch markets' }, { status: 500 });
  }
}

// ============ POST: Join Market ============

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as JoinPredictionRequest;

    // Validate request
    if (!body.marketId || !body.fid || !body.lpTokenId || !body.prediction) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (body.stakeNotionalUsd < PREDICTION_CONSTANTS.MIN_STAKE_USD) {
      return NextResponse.json(
        { error: `Minimum stake is $${PREDICTION_CONSTANTS.MIN_STAKE_USD}` },
        { status: 400 }
      );
    }

    // Get current markets
    const markets = await kv.get<PredictionMarket[]>(PREDICTION_KV_KEYS.activeMarkets);
    if (!markets) {
      return NextResponse.json({ error: 'No markets found' }, { status: 404 });
    }

    // Find the market
    const marketIndex = markets.findIndex((m) => m.id === body.marketId);
    if (marketIndex === -1) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }

    const market = markets[marketIndex];

    // Check if market is still active
    if (market.status !== 'active') {
      return NextResponse.json({ error: 'Market is no longer active' }, { status: 400 });
    }

    // Check if expired
    if (market.expiresAt < Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ error: 'Market has expired' }, { status: 400 });
    }

    // Check if user already participated with this LP
    const existingParticipant = market.participants.find(
      (p) => p.fid === body.fid && p.lpTokenId === body.lpTokenId
    );
    if (existingParticipant) {
      return NextResponse.json(
        { error: 'You have already joined with this LP position' },
        { status: 400 }
      );
    }

    // Add participant
    market.participants.push({
      fid: body.fid,
      username: body.username || `fid:${body.fid}`,
      address: body.address,
      lpTokenId: body.lpTokenId,
      stakeNotionalUsd: body.stakeNotionalUsd,
      prediction: body.prediction
    });

    // Update totals
    if (body.prediction === 'yes') {
      market.totalStakedYes += body.stakeNotionalUsd;
    } else {
      market.totalStakedNo += body.stakeNotionalUsd;
    }

    // Save updated markets
    markets[marketIndex] = market;
    await kv.set(PREDICTION_KV_KEYS.activeMarkets, markets);

    // Update user stats
    const userStatsKey = PREDICTION_KV_KEYS.userStats(body.fid);
    let userStats = await kv.get<UserPredictionStats>(userStatsKey);
    if (!userStats) {
      userStats = {
        fid: body.fid,
        totalPredictions: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        totalEarned: 0,
        totalLost: 0,
        currentStreak: 0,
        longestStreak: 0
      };
    }
    userStats.totalPredictions += 1;
    await kv.set(userStatsKey, userStats);

    return NextResponse.json({
      success: true,
      message: `Joined prediction with ${body.prediction.toUpperCase()}`,
      market
    });
  } catch (error) {
    console.error('[PREDICTIONS] Error joining market:', error);
    return NextResponse.json({ error: 'Failed to join market' }, { status: 500 });
  }
}
