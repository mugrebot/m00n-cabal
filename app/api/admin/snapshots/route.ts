import { NextRequest, NextResponse } from 'next/server';
import {
  getFullMoonSnapshots,
  saveFullMoonSnapshot,
  getSnapshotByFullMoon,
  getCurrentSeason,
  getNextFullMoon,
  getPreviousFullMoon,
  ALL_FULL_MOONS,
  QUALIFICATION_REQUIREMENTS,
  STREAK_REWARDS_PER_FULL_MOON,
  calculateSeasonAllocation,
  getStreakTier,
  formatTokenAmount,
  exportSnapshotToCSV,
  validateDistribution,
  addDistribution,
  type FullMoonSnapshot,
  type QualifiedHolder,
  type QualificationStatus,
  type RewardsDistribution
} from '@/app/lib/tokenomics';
import { getStreakData, getOwnerStats } from '@/app/lib/streakTracker';
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

// Simulated m00n balance check (in production, query on-chain)
async function getMoonBalance(address: string): Promise<number> {
  // TODO: Replace with actual on-chain balance check
  // For now, return a simulated balance based on notional value
  // In production: use viem to query the m00n token contract
  console.log(`[snapshots] Would check m00n balance for ${address}`);
  return 0; // Return 0 for now - will need on-chain integration
}

// GET: List snapshots and full moon schedule
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get('action');

    if (action === 'schedule') {
      // Return full moon schedule
      const nextMoon = getNextFullMoon();
      const prevMoon = getPreviousFullMoon();

      return NextResponse.json({
        fullMoons: ALL_FULL_MOONS,
        nextFullMoon: nextMoon,
        previousFullMoon: prevMoon,
        qualificationRequirements: QUALIFICATION_REQUIREMENTS,
        rewardsPerFullMoon: STREAK_REWARDS_PER_FULL_MOON,
        formattedRewardsPerFullMoon: formatTokenAmount(STREAK_REWARDS_PER_FULL_MOON)
      });
    }

    if (action === 'check') {
      // Check qualification for a specific address
      const address = searchParams.get('address')?.toLowerCase();
      if (!address) {
        return NextResponse.json({ error: 'address_required' }, { status: 400 });
      }

      const ownerStats = await getOwnerStats(address);
      const moonBalance = await getMoonBalance(address);

      if (!ownerStats) {
        return NextResponse.json({
          qualified: false,
          address,
          message: 'No LP positions found',
          checks: {
            hasMinMoonHolding: false,
            moonBalance: 0,
            requiredMoonBalance: QUALIFICATION_REQUIREMENTS.minMoonHolding,
            hasMinPositionAge: false,
            oldestPositionDays: 0,
            requiredPositionAgeDays: QUALIFICATION_REQUIREMENTS.minPositionAgeDays,
            hasMinStreak: false,
            currentStreakDays: 0,
            requiredStreakDays: QUALIFICATION_REQUIREMENTS.minStreakDays,
            isInRange: false
          },
          disqualificationReasons: ['No LP positions found']
        });
      }

      // Build qualification status
      const streakData = await getStreakData();
      const ownerPositions = Object.values(streakData).filter(
        (s) => s.owner.toLowerCase() === address
      );

      const bestPosition = ownerPositions.reduce(
        (best, pos) => (pos.points > (best?.points ?? 0) ? pos : best),
        ownerPositions[0]
      );

      const isInRange = ownerPositions.some((p) => p.isCurrentlyInRange);
      const hasMinStreak = ownerStats.bestStreakDays >= QUALIFICATION_REQUIREMENTS.minStreakDays;
      const hasMinMoonHolding = moonBalance >= QUALIFICATION_REQUIREMENTS.minMoonHolding;

      // Estimate position age from first check timestamp
      const oldestCheck = Math.min(
        ...ownerPositions.map((p) => p.lastCheckedAt - p.checkCount * 600000)
      );
      const positionAgeDays = Math.floor((Date.now() - oldestCheck) / (1000 * 60 * 60 * 24));
      const hasMinPositionAge = positionAgeDays >= QUALIFICATION_REQUIREMENTS.minPositionAgeDays;

      const disqualificationReasons: string[] = [];
      if (!hasMinMoonHolding)
        disqualificationReasons.push(
          `Need ${QUALIFICATION_REQUIREMENTS.minMoonHolding.toLocaleString()}+ m00n`
        );
      if (!hasMinPositionAge)
        disqualificationReasons.push(
          `Position must be ${QUALIFICATION_REQUIREMENTS.minPositionAgeDays}+ days old`
        );
      if (!hasMinStreak)
        disqualificationReasons.push(
          `Need ${QUALIFICATION_REQUIREMENTS.minStreakDays}+ day streak`
        );
      if (!isInRange) disqualificationReasons.push('Must be in range at snapshot');

      const qualified = hasMinMoonHolding && hasMinPositionAge && hasMinStreak && isInRange;

      return NextResponse.json({
        qualified,
        address,
        checks: {
          hasMinMoonHolding,
          moonBalance,
          requiredMoonBalance: QUALIFICATION_REQUIREMENTS.minMoonHolding,
          hasMinPositionAge,
          oldestPositionDays: positionAgeDays,
          requiredPositionAgeDays: QUALIFICATION_REQUIREMENTS.minPositionAgeDays,
          hasMinStreak,
          currentStreakDays: ownerStats.bestStreakDays,
          requiredStreakDays: QUALIFICATION_REQUIREMENTS.minStreakDays,
          isInRange
        },
        disqualificationReasons,
        points: ownerStats.totalPoints,
        tier: ownerStats.tier,
        nextFullMoon: getNextFullMoon()
      });
    }

    // Default: list all snapshots
    const snapshots = await getFullMoonSnapshots();

    return NextResponse.json({
      snapshots: snapshots.map((s) => ({
        ...s,
        formattedTokenPool: formatTokenAmount(s.tokenPool),
        qualifiedCount: s.qualifiedHolders.length
      })),
      nextFullMoon: getNextFullMoon(),
      qualificationRequirements: QUALIFICATION_REQUIREMENTS
    });
  } catch (error) {
    console.error('Snapshots lookup failed', error);
    return NextResponse.json({ error: 'snapshots_failed' }, { status: 500 });
  }
}

// POST: Create or manage snapshots
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimitCheck(request, 'admin-snapshots');
    if (rateLimited) return rateLimited;

    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case 'create_snapshot': {
        // Create a new full moon snapshot
        const fullMoonDate = body.fullMoonDate as string;
        const type = (body.type as 'streak_rewards' | 'lp_mining') ?? 'streak_rewards';

        if (!fullMoonDate) {
          return NextResponse.json({ error: 'full_moon_date_required' }, { status: 400 });
        }

        // Find the full moon info
        const moonInfo = ALL_FULL_MOONS.find((m) => m.date === fullMoonDate);
        if (!moonInfo) {
          return NextResponse.json({ error: 'invalid_full_moon_date' }, { status: 400 });
        }

        // Check if snapshot already exists
        const existing = await getSnapshotByFullMoon(fullMoonDate, type);
        if (existing && existing.status !== 'pending') {
          return NextResponse.json(
            { error: 'snapshot_already_finalized', existingSnapshot: existing },
            { status: 400 }
          );
        }

        const currentSeason = await getCurrentSeason();
        const streakData = await getStreakData();

        // Pool for this snapshot
        const tokenPool =
          type === 'streak_rewards'
            ? STREAK_REWARDS_PER_FULL_MOON
            : (currentSeason?.lpMiningPool ?? 0);

        // Aggregate by owner
        const ownerAggregates: Record<
          string,
          {
            points: number;
            notionalUsd: number;
            bestStreakDays: number;
            isInRange: boolean;
            positions: string[];
          }
        > = {};

        for (const streak of Object.values(streakData)) {
          const owner = streak.owner.toLowerCase();
          if (!ownerAggregates[owner]) {
            ownerAggregates[owner] = {
              points: 0,
              notionalUsd: 0,
              bestStreakDays: 0,
              isInRange: false,
              positions: []
            };
          }
          const agg = ownerAggregates[owner];
          agg.points += streak.points;
          agg.notionalUsd += streak.valueUsd ?? 0;
          agg.bestStreakDays = Math.max(agg.bestStreakDays, streak.currentStreakDuration / 86400);
          agg.isInRange = agg.isInRange || streak.isCurrentlyInRange;
          agg.positions.push(streak.tokenId);
        }

        // Calculate total qualified points for allocation
        const qualifiedHolders: QualifiedHolder[] = [];
        const disqualificationBreakdown = {
          insufficientMoonBalance: 0,
          positionTooNew: 0,
          streakTooShort: 0,
          outOfRange: 0
        };

        for (const [address, agg] of Object.entries(ownerAggregates)) {
          const moonBalance = await getMoonBalance(address);

          // Estimate position age
          const positionAgeDays = 30; // TODO: Calculate from actual data

          // Check qualifications
          const hasMinMoonHolding = moonBalance >= QUALIFICATION_REQUIREMENTS.minMoonHolding;
          const hasMinPositionAge =
            positionAgeDays >= QUALIFICATION_REQUIREMENTS.minPositionAgeDays;
          const hasMinStreak = agg.bestStreakDays >= QUALIFICATION_REQUIREMENTS.minStreakDays;
          const isInRange = agg.isInRange;

          const disqualificationReasons: string[] = [];
          if (!hasMinMoonHolding) {
            disqualificationBreakdown.insufficientMoonBalance++;
            disqualificationReasons.push('Insufficient m00n balance');
          }
          if (!hasMinPositionAge) {
            disqualificationBreakdown.positionTooNew++;
            disqualificationReasons.push('Position too new');
          }
          if (!hasMinStreak) {
            disqualificationBreakdown.streakTooShort++;
            disqualificationReasons.push('Streak too short');
          }
          if (!isInRange) {
            disqualificationBreakdown.outOfRange++;
            disqualificationReasons.push('Out of range');
          }

          const qualified = hasMinMoonHolding && hasMinPositionAge && hasMinStreak && isInRange;

          if (qualified) {
            const tier = getStreakTier(agg.bestStreakDays);
            qualifiedHolders.push({
              address,
              points: agg.points,
              allocation: 0, // Will be calculated after we know total qualified points
              tier,
              streakDays: Math.floor(agg.bestStreakDays),
              notionalUsd: agg.notionalUsd,
              moonBalance,
              positionAgeDays,
              qualificationStatus: {
                qualified: true,
                address,
                checks: {
                  hasMinMoonHolding,
                  moonBalance,
                  requiredMoonBalance: QUALIFICATION_REQUIREMENTS.minMoonHolding,
                  hasMinPositionAge,
                  oldestPositionDays: positionAgeDays,
                  requiredPositionAgeDays: QUALIFICATION_REQUIREMENTS.minPositionAgeDays,
                  hasMinStreak,
                  currentStreakDays: agg.bestStreakDays,
                  requiredStreakDays: QUALIFICATION_REQUIREMENTS.minStreakDays,
                  isInRange
                },
                disqualificationReasons: [],
                points: agg.points,
                estimatedAllocation: 0
              }
            });
          }
        }

        // Calculate allocations for qualified holders
        const totalQualifiedPoints = qualifiedHolders.reduce((sum, h) => sum + h.points, 0);
        for (const holder of qualifiedHolders) {
          holder.allocation = calculateSeasonAllocation(
            holder.points,
            totalQualifiedPoints,
            tokenPool
          );
          holder.qualificationStatus.estimatedAllocation = holder.allocation;
        }

        // Sort by allocation
        qualifiedHolders.sort((a, b) => b.allocation - a.allocation);

        const snapshot: FullMoonSnapshot = {
          id: randomUUID(),
          seasonId: currentSeason?.id ?? 'season-1',
          fullMoonDate,
          fullMoonName: moonInfo.name,
          takenAt: new Date().toISOString(),
          type,
          tokenPool,
          totalParticipants: Object.keys(ownerAggregates).length,
          totalQualified: qualifiedHolders.length,
          totalDisqualified: Object.keys(ownerAggregates).length - qualifiedHolders.length,
          totalPointsInPool: totalQualifiedPoints,
          qualifiedHolders,
          disqualificationBreakdown,
          status: 'pending'
        };

        await saveFullMoonSnapshot(snapshot);

        return NextResponse.json({
          success: true,
          message: `Created ${moonInfo.name} snapshot with ${qualifiedHolders.length} qualified holders`,
          snapshot: {
            ...snapshot,
            formattedTokenPool: formatTokenAmount(tokenPool),
            topRecipients: qualifiedHolders.slice(0, 10).map((h) => ({
              address: `${h.address.slice(0, 6)}...${h.address.slice(-4)}`,
              points: h.points,
              allocation: h.allocation,
              formattedAllocation: formatTokenAmount(h.allocation),
              tier: h.tier
            }))
          }
        });
      }

      case 'finalize_snapshot': {
        // Finalize a snapshot (lock it for distribution)
        const snapshotId = body.snapshotId as string;
        const fullMoonDate = body.fullMoonDate as string;
        const type = (body.type as 'streak_rewards' | 'lp_mining') ?? 'streak_rewards';

        const snapshot = await getSnapshotByFullMoon(fullMoonDate, type);
        if (!snapshot) {
          return NextResponse.json({ error: 'snapshot_not_found' }, { status: 404 });
        }

        if (snapshot.status !== 'pending') {
          return NextResponse.json({ error: 'snapshot_already_finalized' }, { status: 400 });
        }

        // Update status
        snapshot.status = 'finalized';
        await saveFullMoonSnapshot(snapshot);

        return NextResponse.json({
          success: true,
          message: `Finalized ${snapshot.fullMoonName} snapshot`,
          snapshot
        });
      }

      case 'create_distribution_from_snapshot': {
        // Create a distribution from a finalized snapshot
        const fullMoonDate = body.fullMoonDate as string;
        const type = (body.type as 'streak_rewards' | 'lp_mining') ?? 'streak_rewards';

        const snapshot = await getSnapshotByFullMoon(fullMoonDate, type);
        if (!snapshot) {
          return NextResponse.json({ error: 'snapshot_not_found' }, { status: 404 });
        }

        if (snapshot.status === 'distributed') {
          return NextResponse.json(
            { error: 'snapshot_already_distributed', distributionId: snapshot.distributionId },
            { status: 400 }
          );
        }

        // Create distribution
        const distribution: RewardsDistribution = {
          id: randomUUID(),
          type: snapshot.type,
          seasonId: snapshot.seasonId,
          distributedAt: new Date().toISOString(),
          totalTokens: snapshot.qualifiedHolders.reduce((sum, h) => sum + h.allocation, 0),
          recipients: snapshot.qualifiedHolders.map((h, index) => ({
            address: h.address,
            tokens: h.allocation,
            points: h.points,
            rank: index + 1,
            reason: `${snapshot.fullMoonName} ${snapshot.type === 'streak_rewards' ? 'Streak Rewards' : 'LP Mining'}`
          })),
          status: 'pending',
          notes: `${snapshot.fullMoonName} (${snapshot.fullMoonDate}) - ${snapshot.qualifiedHolders.length} recipients`
        };

        // Validate
        const validation = validateDistribution(distribution);
        if (!validation.valid) {
          return NextResponse.json(
            { error: 'distribution_validation_failed', errors: validation.errors },
            { status: 400 }
          );
        }

        // Save distribution
        await addDistribution(distribution);

        // Update snapshot status
        snapshot.status = 'distributed';
        snapshot.distributionId = distribution.id;
        await saveFullMoonSnapshot(snapshot);

        return NextResponse.json({
          success: true,
          message: `Created distribution from ${snapshot.fullMoonName} snapshot`,
          distribution: {
            ...distribution,
            formattedTotalTokens: formatTokenAmount(distribution.totalTokens)
          },
          validation
        });
      }

      case 'export_csv': {
        // Export snapshot as CSV for manual distribution
        const fullMoonDate = body.fullMoonDate as string;
        const type = (body.type as 'streak_rewards' | 'lp_mining') ?? 'streak_rewards';

        const snapshot = await getSnapshotByFullMoon(fullMoonDate, type);
        if (!snapshot) {
          return NextResponse.json({ error: 'snapshot_not_found' }, { status: 404 });
        }

        const csv = exportSnapshotToCSV(snapshot);

        return new NextResponse(csv, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="${snapshot.fullMoonName.replace(' ', '_')}_${type}_${fullMoonDate}.csv"`
          }
        });
      }

      default:
        return NextResponse.json(
          {
            error: 'invalid_action',
            validActions: [
              'create_snapshot',
              'finalize_snapshot',
              'create_distribution_from_snapshot',
              'export_csv'
            ]
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Snapshot action failed', error);
    return NextResponse.json({ error: 'snapshot_action_failed' }, { status: 500 });
  }
}
