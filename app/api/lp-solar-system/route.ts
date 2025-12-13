import { NextRequest, NextResponse } from 'next/server';
import { buildSolarSystemPayload, type SolarSystemPayload } from '@/app/lib/lpTelemetry';
import { getAddressLabel } from '@/app/lib/addressLabels';
import { readSolarSystemSnapshot, writeSolarSystemSnapshot } from '@/app/lib/lpTelemetryStore';

const FALLBACK_REBUILD_ENABLED = process.env.LP_SOLAR_SYSTEM_ON_DEMAND === '1';
const SOLAR_DEFAULT_LIMIT = Number(process.env.M00N_SOLAR_POSITION_LIMIT ?? 16);
const SOLAR_MAX_LIMIT = Number(process.env.M00N_SOLAR_POSITION_MAX ?? 24);
const ADMIN_SECRET = process.env.LP_TELEMETRY_SECRET ?? process.env.ADMIN_SECRET ?? '';

const withLabels = (payload: SolarSystemPayload): SolarSystemPayload => ({
  ...payload,
  positions: payload.positions.map((position) => ({
    ...position,
    label: position.label ?? getAddressLabel(position.owner)
  }))
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get('limit') ?? `${SOLAR_DEFAULT_LIMIT}`);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(1, limitParam), SOLAR_MAX_LIMIT)
    : SOLAR_DEFAULT_LIMIT;

  try {
    let payload = await readSolarSystemSnapshot();

    if (!payload) {
      if (FALLBACK_REBUILD_ENABLED) {
        try {
          payload = await buildSolarSystemPayload(SOLAR_MAX_LIMIT);
          payload = withLabels(payload);
          await writeSolarSystemSnapshot(payload);
        } catch (error) {
          console.error('[lp-solar-system] on-demand rebuild failed', error);
        }
      }

      if (!payload) {
        return NextResponse.json({ error: 'lp_solar_system_unavailable' }, { status: 503 });
      }
    }

    const enrichedPayload = withLabels(payload);

    return NextResponse.json(
      {
        updatedAt: enrichedPayload.updatedAt,
        positions: enrichedPayload.positions,
        limit
      },
      {
        headers: {
          'Cache-Control': 's-maxage=60, stale-while-revalidate=300'
        }
      }
    );
  } catch (error) {
    console.error('[lp-solar-system] failed to serve snapshot', error);
    return NextResponse.json({ error: 'lp_solar_system_failed' }, { status: 500 });
  }
}

// POST: Force rebuild the solar system snapshot
export async function POST(request: NextRequest) {
  const adminSecret = request.headers.get('x-admin-secret');
  if (!ADMIN_SECRET || adminSecret !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    console.log('[lp-solar-system] Force rebuilding snapshot...');
    const payload = await buildSolarSystemPayload(SOLAR_MAX_LIMIT);
    const enrichedPayload = withLabels(payload);
    await writeSolarSystemSnapshot(enrichedPayload);

    return NextResponse.json({
      success: true,
      positionsCount: enrichedPayload.positions.length,
      updatedAt: enrichedPayload.updatedAt
    });
  } catch (error) {
    console.error('[lp-solar-system] Force rebuild failed', error);
    return NextResponse.json({ error: 'rebuild_failed' }, { status: 500 });
  }
}
