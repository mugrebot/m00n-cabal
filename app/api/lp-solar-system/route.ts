import { NextRequest, NextResponse } from 'next/server';
import { buildSolarSystemPayload, type SolarSystemPayload } from '@/app/lib/lpTelemetry';

const SOLAR_CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const SOLAR_BASE_LIMIT = 12;

let cachedSolar: SolarSystemPayload | null = null;
let cacheExpiresAt = 0;
let inFlight: Promise<SolarSystemPayload> | null = null;

const formatResponse = (payload: SolarSystemPayload, limit: number) => ({
  updatedAt: payload.updatedAt,
  positions: payload.positions.slice(0, limit)
});

async function computeSolarSystem(): Promise<SolarSystemPayload> {
  return buildSolarSystemPayload(SOLAR_BASE_LIMIT);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get('limit') ?? '8');
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 12) : 8;

  try {
    const now = Date.now();
    if (cachedSolar && now < cacheExpiresAt) {
      return NextResponse.json(formatResponse(cachedSolar, limit));
    }

    if (!inFlight) {
      inFlight = computeSolarSystem()
        .then((payload) => {
          cachedSolar = payload;
          cacheExpiresAt = Date.now() + SOLAR_CACHE_TTL_MS;
          inFlight = null;
          return payload;
        })
        .catch((error) => {
          inFlight = null;
          throw error;
        });
    }

    const payload = await inFlight;
    return NextResponse.json(formatResponse(payload, limit));
  } catch (error) {
    console.error('[lp-solar-system] failed to compute', error);
    if (cachedSolar) {
      return NextResponse.json(
        { ...formatResponse(cachedSolar, limit), stale: true },
        { status: 200 }
      );
    }
    return NextResponse.json({ error: 'lp_solar_system_failed' }, { status: 500 });
  }
}
