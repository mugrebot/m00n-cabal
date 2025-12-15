/**
 * Ascension API
 *
 * GET: Get user's ascension status or leaderboard
 * POST: Record a burn
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAscensionRecord,
  recordBurn,
  getAscensionLeaderboard,
  buildAscensionLeaderboard,
  getTotalBurned,
  getUserTier,
  setCustomOrbitName,
  TIER_DEFINITIONS,
  getNextTier,
  formatMoonAmount,
  type TierDefinition
} from '@/app/lib/ascension';

// Helper to serialize tier (BigInt -> string)
function serializeTier(tier: TierDefinition) {
  return {
    name: tier.name,
    tier: tier.tier,
    burnRequired: tier.burnRequired.toString(),
    burnRequiredFormatted: tier.burnRequiredFormatted,
    emoji: tier.emoji,
    glow: tier.glow,
    harvestMultiplier: tier.harvestMultiplier,
    perks: tier.perks
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fid = searchParams.get('fid');
    const action = searchParams.get('action');

    // Get leaderboard
    if (action === 'leaderboard') {
      const leaderboard = await getAscensionLeaderboard();
      if (!leaderboard) {
        // Build fresh if not cached
        const fresh = await buildAscensionLeaderboard();
        return NextResponse.json(fresh);
      }
      return NextResponse.json(leaderboard);
    }

    // Get total burned
    if (action === 'total') {
      const total = await getTotalBurned();
      return NextResponse.json({
        totalBurnedWei: total.toString(),
        totalBurnedFormatted: formatMoonAmount(total)
      });
    }

    // Get user's ascension status
    if (fid) {
      const record = await getAscensionRecord(Number(fid));
      const tier = await getUserTier(Number(fid));
      const nextTier = getNextTier(tier.tier);

      if (!record) {
        return NextResponse.json({
          fid: Number(fid),
          tier: serializeTier(TIER_DEFINITIONS.wanderer),
          totalBurnedWei: '0',
          totalBurnedFormatted: '0',
          nextTier: nextTier
            ? {
                tier: serializeTier(nextTier.tier),
                burnNeeded: nextTier.burnNeeded.toString(),
                burnNeededFormatted: formatMoonAmount(nextTier.burnNeeded)
              }
            : null,
          burnHistory: []
        });
      }

      return NextResponse.json({
        ...record,
        tier: serializeTier(tier),
        totalBurnedFormatted: formatMoonAmount(BigInt(record.totalBurnedWei)),
        nextTier: nextTier
          ? {
              tier: serializeTier(nextTier.tier),
              burnNeeded: nextTier.burnNeeded.toString(),
              burnNeededFormatted: formatMoonAmount(nextTier.burnNeeded)
            }
          : null
      });
    }

    return NextResponse.json({ error: 'missing_fid_or_action' }, { status: 400 });
  } catch (error) {
    console.error('[ascension] GET error:', error);
    return NextResponse.json({ error: 'ascension_fetch_failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    // Record a burn
    if (action === 'burn') {
      const { fid, username, address, txHash, amountWei } = body;

      if (!fid || !username || !address || !txHash || !amountWei) {
        return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 });
      }

      const result = await recordBurn(Number(fid), username, address, txHash, BigInt(amountWei));

      // Always include the current tier definition (not just when tier changes)
      const currentTier = TIER_DEFINITIONS[result.record.tier];
      const nextTierInfo = getNextTier(result.record.tier);

      return NextResponse.json({
        success: result.success,
        record: result.record,
        tierChanged: result.tierChanged,
        message: result.message,
        // Always include full tier info (serialized to avoid BigInt issues)
        currentTier: serializeTier(currentTier),
        nextTier: nextTierInfo
          ? {
              tier: serializeTier(nextTierInfo.tier),
              burnNeeded: nextTierInfo.burnNeeded.toString(),
              burnNeededFormatted: formatMoonAmount(nextTierInfo.burnNeeded)
            }
          : null
      });
    }

    // Set custom orbit name (Guardian+)
    if (action === 'set_orbit_name') {
      const { fid, orbitName } = body;

      if (!fid || !orbitName) {
        return NextResponse.json({ error: 'missing_fid_or_orbit_name' }, { status: 400 });
      }

      const result = await setCustomOrbitName(Number(fid), orbitName);
      return NextResponse.json(result);
    }

    // Rebuild leaderboard (admin)
    if (action === 'rebuild_leaderboard') {
      const leaderboard = await buildAscensionLeaderboard();
      return NextResponse.json({
        success: true,
        totalBurners: leaderboard.totalBurners
      });
    }

    return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  } catch (error) {
    console.error('[ascension] POST error:', error);
    return NextResponse.json({ error: 'ascension_failed' }, { status: 500 });
  }
}
