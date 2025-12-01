import { NextRequest, NextResponse } from 'next/server';
import {
  buildLeaderboardSnapshot,
  buildSolarSystemPayload,
  type LeaderboardSnapshot,
  type SolarSystemPayload
} from '@/app/lib/lpTelemetry';
import {
  LP_TELEMETRY_ADMIN_SECRET,
  writeLeaderboardSnapshot,
  writeSolarSystemSnapshot
} from '@/app/lib/lpTelemetryStore';

type Scope = 'solar' | 'leaderboard';

interface RequestBody {
  scope?: Scope[];
}

const DEFAULT_SCOPES: Scope[] = ['solar', 'leaderboard'];

const isAuthorized = (request: NextRequest) => {
  if (!LP_TELEMETRY_ADMIN_SECRET) return true;
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.toLowerCase().startsWith('bearer ')) {
    return false;
  }
  const token = authHeader.slice(7).trim();
  return token === LP_TELEMETRY_ADMIN_SECRET;
};

const normalizeScopes = (value?: Scope[]): Scope[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_SCOPES;
  }
  const seen = new Set<Scope>();
  for (const entry of value) {
    if (entry === 'solar' || entry === 'leaderboard') {
      seen.add(entry);
    }
  }
  return seen.size ? Array.from(seen) : DEFAULT_SCOPES;
};

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: RequestBody | null = null;
  try {
    if (request.headers.get('content-length') !== '0') {
      body = (await request.json()) as RequestBody;
    }
  } catch {
    body = null;
  }

  const scopes = normalizeScopes(body?.scope);
  const response: {
    solar?: SolarSystemPayload;
    leaderboard?: LeaderboardSnapshot;
  } = {};

  try {
    if (scopes.includes('solar')) {
      const solarPayload = await buildSolarSystemPayload();
      await writeSolarSystemSnapshot(solarPayload);
      response.solar = solarPayload;
    }

    if (scopes.includes('leaderboard')) {
      const leaderboardPayload = await buildLeaderboardSnapshot();
      await writeLeaderboardSnapshot(leaderboardPayload);
      response.leaderboard = leaderboardPayload;
    }

    if (!response.solar && !response.leaderboard) {
      return NextResponse.json(
        { error: 'nothing_to_rebuild', detail: 'No valid scopes provided' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ...response,
      scopes,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[admin/rebuild-lp-telemetry] failed', error);
    return NextResponse.json({ error: 'rebuild_failed' }, { status: 500 });
  }
}
