import { NextRequest, NextResponse } from 'next/server';
import { getTopM00nLpPositions } from '@/app/lib/m00nSolarSystem';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get('limit') ?? '8');
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 12) : 8;

  try {
    const positions = await getTopM00nLpPositions(limit);
    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      positions
    });
  } catch (error) {
    console.error('[lp-solar-system] lookup failed', error);
    return NextResponse.json({ error: 'lp_solar_system_failed' }, { status: 500 });
  }
}
