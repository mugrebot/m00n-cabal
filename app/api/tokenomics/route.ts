import { NextRequest, NextResponse } from 'next/server';
import {
  getTokenomicsSummary,
  calculateSeasonAllocation,
  ALLOCATIONS,
  POINTS_WEIGHTS,
  formatTokenAmount,
  getSeasons
} from '@/app/lib/tokenomics';
import { getStreakData, getStreakLeaderboard, getOwnerStats } from '@/app/lib/streakTracker';

// GET: Fetch tokenomics summary + user allocation
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const address = searchParams.get('address')?.toLowerCase();

    // Get base tokenomics summary
    const summary = await getTokenomicsSummary();

    // Get streak leaderboard for total points calculation
    const leaderboard = await getStreakLeaderboard();
    const streakData = await getStreakData();

    // Calculate total system points
    const totalSystemPoints = Object.values(streakData).reduce(
      (sum, streak) => sum + streak.points,
      0
    );

    // Get all seasons
    const seasons = await getSeasons();

    // Base response
    const response: Record<string, unknown> = {
      ...summary,
      totalSystemPoints,
      totalParticipants: Object.keys(streakData).length,
      pointsWeights: POINTS_WEIGHTS,
      formattedAllocations: Object.entries(ALLOCATIONS).map(([key, alloc]) => ({
        key,
        ...alloc,
        formattedTokens: formatTokenAmount(alloc.tokens)
      })),
      seasons: seasons.map((s) => ({
        ...s,
        formattedLpMiningPool: formatTokenAmount(s.lpMiningPool),
        formattedStreakRewardsPool: formatTokenAmount(s.streakRewardsPool)
      }))
    };

    // If address provided, calculate user-specific allocation
    if (address) {
      const ownerStats = await getOwnerStats(address);

      if (ownerStats) {
        const currentSeason = summary.currentSeason;
        const seasonPool = currentSeason?.lpMiningPool ?? 0;

        // Calculate estimated LP mining allocation
        const estimatedLpMining = calculateSeasonAllocation(
          ownerStats.totalPoints,
          totalSystemPoints,
          seasonPool
        );

        // Find rank in leaderboard
        const allPointsSorted = Object.values(streakData)
          .reduce((acc: { owner: string; points: number }[], s) => {
            const existing = acc.find((e) => e.owner.toLowerCase() === s.owner.toLowerCase());
            if (existing) {
              existing.points += s.points;
            } else {
              acc.push({ owner: s.owner.toLowerCase(), points: s.points });
            }
            return acc;
          }, [])
          .sort((a, b) => b.points - a.points);

        const rank = allPointsSorted.findIndex((s) => s.owner.toLowerCase() === address) + 1;

        const percentile =
          allPointsSorted.length > 0
            ? ((allPointsSorted.length - rank) / allPointsSorted.length) * 100
            : 0;

        response.userAllocation = {
          address,
          positionCount: ownerStats.positionCount,
          totalPoints: ownerStats.totalPoints,
          formattedPoints: ownerStats.totalPoints.toLocaleString(),
          pointsBreakdown: ownerStats.breakdown,
          formattedPointsBreakdown: {
            notional: `${ownerStats.breakdown.notionalPoints.toLocaleString()} (50% weight)`,
            streak: `${ownerStats.breakdown.streakPoints.toLocaleString()} (30% weight)`,
            time: `${ownerStats.breakdown.timePoints.toLocaleString()} (20% weight)`
          },
          totalNotionalUsd: ownerStats.totalNotionalUsd,
          formattedNotionalUsd: `$${ownerStats.totalNotionalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
          bestStreakDays: ownerStats.bestStreakDays,
          totalHoursInRange: ownerStats.totalHoursInRange,
          tier: ownerStats.tier,
          estimatedLpMining,
          formattedEstimatedLpMining: formatTokenAmount(estimatedLpMining),
          shareOfPool:
            totalSystemPoints > 0
              ? ((ownerStats.totalPoints / totalSystemPoints) * 100).toFixed(4)
              : '0',
          rank: rank > 0 ? rank : null,
          totalRanked: allPointsSorted.length,
          percentile: Math.max(0, percentile).toFixed(1),
          seasonId: currentSeason?.id ?? 'season-1'
        };
      } else {
        response.userAllocation = {
          address,
          positionCount: 0,
          totalPoints: 0,
          message: 'No LP positions found. Deploy LP to start earning points!'
        };
      }
    }

    // Add top earners preview
    if (leaderboard?.topPoints) {
      const currentSeason = summary.currentSeason;
      const seasonPool = currentSeason?.lpMiningPool ?? 0;

      response.topEarners = leaderboard.topPoints.slice(0, 5).map((entry, index) => ({
        rank: index + 1,
        label: entry.label ?? `${entry.owner.slice(0, 6)}...${entry.owner.slice(-4)}`,
        points: entry.points,
        formattedPoints: entry.points.toLocaleString(),
        tier: entry.tier,
        pointsBreakdown: entry.pointsBreakdown,
        estimatedAllocation: formatTokenAmount(
          calculateSeasonAllocation(entry.points, totalSystemPoints, seasonPool)
        ),
        valueUsd: entry.valueUsd,
        formattedValueUsd: entry.valueUsd
          ? `$${entry.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          : null
      }));
    }

    // Add top whales preview
    if (leaderboard?.topNotional) {
      response.topWhales = leaderboard.topNotional.slice(0, 5).map((entry, index) => ({
        rank: index + 1,
        label: entry.label ?? `${entry.owner.slice(0, 6)}...${entry.owner.slice(-4)}`,
        valueUsd: entry.valueUsd,
        formattedValueUsd: entry.valueUsd
          ? `$${entry.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          : null,
        points: entry.points,
        tier: entry.tier
      }));
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Tokenomics lookup failed', error);
    return NextResponse.json({ error: 'tokenomics_failed' }, { status: 500 });
  }
}
