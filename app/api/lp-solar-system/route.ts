import { NextRequest, NextResponse } from 'next/server';
import { buildSolarSystemPayload, type SolarSystemPayload } from '@/app/lib/lpTelemetry';
import { readSolarSystemSnapshot, writeSolarSystemSnapshot } from '@/app/lib/lpTelemetryStore';

const FALLBACK_REBUILD_ENABLED = process.env.NODE_ENV !== 'production';
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 12;

const formatResponse = (payload: SolarSystemPayload, limit: number) => ({
  updatedAt: payload.updatedAt,
  positions: payload.positions.slice(0, limit)
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get('limit') ?? `${DEFAULT_LIMIT}`);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(1, limitParam), MAX_LIMIT)
    : DEFAULT_LIMIT;

  try {
    let payload = await readSolarSystemSnapshot();

    if (!payload && FALLBACK_REBUILD_ENABLED) {
      payload = await buildSolarSystemPayload(MAX_LIMIT);
      await writeSolarSystemSnapshot(payload);
    }

    if (!payload) {
      return NextResponse.json({ error: 'lp_solar_system_unavailable' }, { status: 503 });
    }

    return NextResponse.json(formatResponse(payload, limit));
  } catch (error) {
    console.error('[lp-solar-system] failed to serve snapshot', error);
    return NextResponse.json({ error: 'lp_solar_system_failed' }, { status: 500 });
  }
}
