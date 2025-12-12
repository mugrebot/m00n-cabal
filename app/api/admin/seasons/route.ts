import { NextRequest, NextResponse } from 'next/server';
import {
  getSeasons,
  getCurrentSeason,
  updateSeason,
  startNextSeason,
  formatTokenAmount,
  type Season
} from '@/app/lib/tokenomics';
import { resetStreaksForNewSeason, buildStreakLeaderboard } from '@/app/lib/streakTracker';

const ADMIN_SECRET = process.env.LP_TELEMETRY_SECRET ?? '';

function checkAuth(request: NextRequest): boolean {
  const secret = request.headers.get('x-admin-secret');
  return ADMIN_SECRET !== '' && secret === ADMIN_SECRET;
}

// GET: List all seasons
export async function GET(request: NextRequest) {
  try {
    const seasons = await getSeasons();
    const currentSeason = await getCurrentSeason();

    return NextResponse.json({
      seasons: seasons.map((s) => ({
        ...s,
        formattedLpMiningPool: formatTokenAmount(s.lpMiningPool),
        formattedStreakRewardsPool: formatTokenAmount(s.streakRewardsPool),
        isCurrent: s.id === currentSeason?.id
      })),
      currentSeasonId: currentSeason?.id ?? null
    });
  } catch (error) {
    console.error('Failed to get seasons', error);
    return NextResponse.json({ error: 'seasons_failed' }, { status: 500 });
  }
}

// POST: Manage seasons (start next, update, etc.)
export async function POST(request: NextRequest) {
  try {
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case 'start_next_season': {
        // End current season and start the next one
        const newSeason = await startNextSeason();

        if (!newSeason) {
          return NextResponse.json(
            { error: 'no_upcoming_seasons', message: 'All seasons have been completed' },
            { status: 400 }
          );
        }

        // Reset points for new season (keeps streak tracking)
        const resetResult = await resetStreaksForNewSeason(newSeason.id);

        // Rebuild leaderboard
        await buildStreakLeaderboard();

        return NextResponse.json({
          success: true,
          message: `Started ${newSeason.name} (Season ${newSeason.number})`,
          newSeason: {
            ...newSeason,
            formattedLpMiningPool: formatTokenAmount(newSeason.lpMiningPool),
            formattedStreakRewardsPool: formatTokenAmount(newSeason.streakRewardsPool)
          },
          positionsReset: resetResult.positionsReset
        });
      }

      case 'update_season': {
        // Update a specific season's details
        const seasonData = body.season as Partial<Season>;

        if (!seasonData.id) {
          return NextResponse.json({ error: 'missing_season_id' }, { status: 400 });
        }

        const seasons = await getSeasons();
        const existing = seasons.find((s) => s.id === seasonData.id);

        if (!existing) {
          return NextResponse.json({ error: 'season_not_found' }, { status: 404 });
        }

        const updated: Season = {
          ...existing,
          ...seasonData,
          id: existing.id, // Can't change ID
          number: existing.number // Can't change number
        };

        await updateSeason(updated);

        return NextResponse.json({
          success: true,
          message: `Updated season ${updated.name}`,
          season: updated
        });
      }

      case 'end_current_season': {
        // End the current season without starting a new one
        const currentSeason = await getCurrentSeason();

        if (!currentSeason) {
          return NextResponse.json({ error: 'no_active_season' }, { status: 400 });
        }

        const updated: Season = {
          ...currentSeason,
          status: 'ended',
          endDate: new Date().toISOString()
        };

        await updateSeason(updated);

        return NextResponse.json({
          success: true,
          message: `Ended season ${currentSeason.name}`,
          season: updated
        });
      }

      case 'mark_distributing': {
        // Mark current season as distributing rewards
        const currentSeason = await getCurrentSeason();

        if (!currentSeason) {
          return NextResponse.json({ error: 'no_active_season' }, { status: 400 });
        }

        const updated: Season = {
          ...currentSeason,
          status: 'distributing'
        };

        await updateSeason(updated);

        return NextResponse.json({
          success: true,
          message: `Season ${currentSeason.name} is now in distribution phase`,
          season: updated
        });
      }

      case 'mark_completed': {
        // Mark a season as fully completed
        const seasonId = body.seasonId as string;

        if (!seasonId) {
          return NextResponse.json({ error: 'missing_season_id' }, { status: 400 });
        }

        const seasons = await getSeasons();
        const season = seasons.find((s) => s.id === seasonId);

        if (!season) {
          return NextResponse.json({ error: 'season_not_found' }, { status: 404 });
        }

        const updated: Season = {
          ...season,
          status: 'completed'
        };

        await updateSeason(updated);

        return NextResponse.json({
          success: true,
          message: `Season ${season.name} marked as completed`,
          season: updated
        });
      }

      default:
        return NextResponse.json(
          {
            error: 'invalid_action',
            validActions: [
              'start_next_season',
              'update_season',
              'end_current_season',
              'mark_distributing',
              'mark_completed'
            ]
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Season action failed', error);
    return NextResponse.json({ error: 'season_action_failed' }, { status: 500 });
  }
}
