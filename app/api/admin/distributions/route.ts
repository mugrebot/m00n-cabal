import { NextRequest, NextResponse } from 'next/server';
import {
  getDistributions,
  getDistributionsBySeason,
  addDistribution,
  updateDistribution,
  getCurrentSeason,
  calculateSeasonAllocation,
  formatTokenAmount,
  type RewardsDistribution
} from '@/app/lib/tokenomics';
import { getStreakData, getStreakLeaderboard } from '@/app/lib/streakTracker';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/app/lib/rateLimit';
import { randomUUID } from 'crypto';

const ADMIN_SECRET = process.env.LP_TELEMETRY_SECRET ?? '';

function checkAuth(request: NextRequest): boolean {
  const secret = request.headers.get('x-admin-secret');
  return ADMIN_SECRET !== '' && secret === ADMIN_SECRET;
}

async function rateLimitCheck(
  request: NextRequest,
  endpoint: string
): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit({
    ...RATE_LIMITS.admin,
    identifier: `${endpoint}:${ip}`
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded', resetAt: rateLimit.resetAt },
      { status: 429 }
    );
  }
  return null;
}

// GET: List distributions
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const seasonId = searchParams.get('seasonId');

    let distributions: RewardsDistribution[];
    if (seasonId) {
      distributions = await getDistributionsBySeason(seasonId);
    } else {
      distributions = await getDistributions();
    }

    // Calculate totals
    const totalDistributed = distributions
      .filter((d) => d.status === 'completed')
      .reduce((sum, d) => sum + d.totalTokens, 0);

    return NextResponse.json({
      distributions: distributions.map((d) => ({
        ...d,
        formattedTotalTokens: formatTokenAmount(d.totalTokens),
        recipientCount: d.recipients.length
      })),
      summary: {
        total: distributions.length,
        pending: distributions.filter((d) => d.status === 'pending').length,
        completed: distributions.filter((d) => d.status === 'completed').length,
        failed: distributions.filter((d) => d.status === 'failed').length,
        totalDistributed,
        formattedTotalDistributed: formatTokenAmount(totalDistributed)
      }
    });
  } catch (error) {
    console.error('Failed to get distributions', error);
    return NextResponse.json({ error: 'distributions_failed' }, { status: 500 });
  }
}

// POST: Create or manage distributions
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimitCheck(request, 'admin-distributions');
    if (rateLimited) return rateLimited;

    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case 'create_lp_mining_distribution': {
        // Create a distribution for LP mining rewards based on current leaderboard
        const currentSeason = await getCurrentSeason();
        if (!currentSeason) {
          return NextResponse.json({ error: 'no_active_season' }, { status: 400 });
        }

        const leaderboard = await getStreakLeaderboard();
        const streakData = await getStreakData();

        if (!leaderboard || Object.keys(streakData).length === 0) {
          return NextResponse.json({ error: 'no_leaderboard_data' }, { status: 400 });
        }

        const totalSystemPoints = Object.values(streakData).reduce((sum, s) => sum + s.points, 0);

        const poolToDistribute = body.tokenAmount
          ? Number(body.tokenAmount)
          : currentSeason.lpMiningPool;

        // Aggregate points by owner
        const ownerPoints: Record<string, { points: number; positions: string[] }> = {};
        for (const streak of Object.values(streakData)) {
          const owner = streak.owner.toLowerCase();
          if (!ownerPoints[owner]) {
            ownerPoints[owner] = { points: 0, positions: [] };
          }
          ownerPoints[owner].points += streak.points;
          ownerPoints[owner].positions.push(streak.tokenId);
        }

        // Calculate allocations
        const recipients = Object.entries(ownerPoints)
          .filter(([, data]) => data.points > 0)
          .map(([address, data]) => ({
            address,
            tokens: calculateSeasonAllocation(data.points, totalSystemPoints, poolToDistribute),
            points: data.points,
            reason: `LP Mining - ${data.positions.length} position(s)`
          }))
          .filter((r) => r.tokens > 0)
          .sort((a, b) => b.tokens - a.tokens);

        const distribution: RewardsDistribution = {
          id: randomUUID(),
          type: 'lp_mining',
          seasonId: currentSeason.id,
          distributedAt: new Date().toISOString(),
          totalTokens: recipients.reduce((sum, r) => sum + r.tokens, 0),
          recipients,
          status: 'pending',
          notes: `LP Mining distribution for ${currentSeason.name}. Total pool: ${formatTokenAmount(poolToDistribute)}`
        };

        await addDistribution(distribution);

        return NextResponse.json({
          success: true,
          message: `Created LP mining distribution with ${recipients.length} recipients`,
          distribution: {
            ...distribution,
            formattedTotalTokens: formatTokenAmount(distribution.totalTokens)
          },
          topRecipients: recipients.slice(0, 10).map((r) => ({
            ...r,
            formattedTokens: formatTokenAmount(r.tokens)
          }))
        });
      }

      case 'create_streak_rewards_distribution': {
        // Create a distribution for top streak holders
        const currentSeason = await getCurrentSeason();
        if (!currentSeason) {
          return NextResponse.json({ error: 'no_active_season' }, { status: 400 });
        }

        const leaderboard = await getStreakLeaderboard();
        if (!leaderboard || leaderboard.topStreaks.length === 0) {
          return NextResponse.json({ error: 'no_streak_data' }, { status: 400 });
        }

        const poolToDistribute = body.tokenAmount
          ? Number(body.tokenAmount)
          : currentSeason.streakRewardsPool / 12; // Monthly distribution

        // Top 10 streakers get rewards
        const topCount = body.topCount ? Number(body.topCount) : 10;
        const topStreakers = leaderboard.topStreaks.slice(0, topCount);

        // Distribution curve: 1st gets 25%, 2nd 15%, 3rd 10%, rest split evenly
        const distributionCurve = [0.25, 0.15, 0.1, 0.08, 0.07, 0.07, 0.07, 0.07, 0.07, 0.07];

        const recipients = topStreakers.map((entry, index) => ({
          address: entry.owner,
          tokens: Math.floor(poolToDistribute * (distributionCurve[index] ?? 0.05)),
          rank: index + 1,
          reason: `Streak Reward #${index + 1} - ${Math.floor(entry.currentStreakDuration / 86400)}d streak`
        }));

        const distribution: RewardsDistribution = {
          id: randomUUID(),
          type: 'streak_rewards',
          seasonId: currentSeason.id,
          distributedAt: new Date().toISOString(),
          totalTokens: recipients.reduce((sum, r) => sum + r.tokens, 0),
          recipients,
          status: 'pending',
          notes: `Top ${topCount} streak rewards for ${currentSeason.name}`
        };

        await addDistribution(distribution);

        return NextResponse.json({
          success: true,
          message: `Created streak rewards distribution for top ${topCount} LPers`,
          distribution: {
            ...distribution,
            formattedTotalTokens: formatTokenAmount(distribution.totalTokens)
          },
          recipients: recipients.map((r) => ({
            ...r,
            formattedTokens: formatTokenAmount(r.tokens)
          }))
        });
      }

      case 'create_manual_distribution': {
        // Create a manual distribution
        const currentSeason = await getCurrentSeason();
        const recipients = body.recipients as {
          address: string;
          tokens: number;
          reason?: string;
        }[];

        if (!recipients || recipients.length === 0) {
          return NextResponse.json({ error: 'no_recipients' }, { status: 400 });
        }

        const distribution: RewardsDistribution = {
          id: randomUUID(),
          type: 'manual',
          seasonId: currentSeason?.id ?? 'manual',
          distributedAt: new Date().toISOString(),
          totalTokens: recipients.reduce((sum, r) => sum + r.tokens, 0),
          recipients,
          status: 'pending',
          notes: body.notes ?? 'Manual distribution'
        };

        await addDistribution(distribution);

        return NextResponse.json({
          success: true,
          message: `Created manual distribution with ${recipients.length} recipients`,
          distribution: {
            ...distribution,
            formattedTotalTokens: formatTokenAmount(distribution.totalTokens)
          }
        });
      }

      case 'update_status': {
        // Update distribution status (after actual token transfer)
        const distributionId = body.distributionId as string;
        const newStatus = body.status as RewardsDistribution['status'];
        const txHash = body.txHash as string | undefined;

        if (!distributionId || !newStatus) {
          return NextResponse.json({ error: 'missing_distribution_id_or_status' }, { status: 400 });
        }

        const distributions = await getDistributions();
        const distribution = distributions.find((d) => d.id === distributionId);

        if (!distribution) {
          return NextResponse.json({ error: 'distribution_not_found' }, { status: 404 });
        }

        const updated: RewardsDistribution = {
          ...distribution,
          status: newStatus,
          ...(txHash && { txHash })
        };

        await updateDistribution(updated);

        return NextResponse.json({
          success: true,
          message: `Distribution ${distributionId} updated to ${newStatus}`,
          distribution: updated
        });
      }

      case 'preview_lp_mining': {
        // Preview what an LP mining distribution would look like
        const currentSeason = await getCurrentSeason();
        const streakData = await getStreakData();

        const totalSystemPoints = Object.values(streakData).reduce((sum, s) => sum + s.points, 0);

        const poolToDistribute = body.tokenAmount
          ? Number(body.tokenAmount)
          : (currentSeason?.lpMiningPool ?? 0);

        // Aggregate by owner
        const ownerPoints: Record<string, number> = {};
        for (const streak of Object.values(streakData)) {
          const owner = streak.owner.toLowerCase();
          ownerPoints[owner] = (ownerPoints[owner] ?? 0) + streak.points;
        }

        const preview = Object.entries(ownerPoints)
          .filter(([, points]) => points > 0)
          .map(([address, points]) => ({
            address,
            points,
            tokens: calculateSeasonAllocation(points, totalSystemPoints, poolToDistribute),
            sharePercent: ((points / totalSystemPoints) * 100).toFixed(4)
          }))
          .sort((a, b) => b.tokens - a.tokens)
          .slice(0, 20)
          .map((r) => ({
            ...r,
            formattedTokens: formatTokenAmount(r.tokens)
          }));

        return NextResponse.json({
          preview,
          totalSystemPoints,
          poolToDistribute,
          formattedPool: formatTokenAmount(poolToDistribute),
          qualifiedRecipients: Object.keys(ownerPoints).length
        });
      }

      default:
        return NextResponse.json(
          {
            error: 'invalid_action',
            validActions: [
              'create_lp_mining_distribution',
              'create_streak_rewards_distribution',
              'create_manual_distribution',
              'update_status',
              'preview_lp_mining'
            ]
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Distribution action failed', error);
    return NextResponse.json({ error: 'distribution_action_failed' }, { status: 500 });
  }
}
