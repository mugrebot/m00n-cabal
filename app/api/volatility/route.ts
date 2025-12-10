import { NextRequest, NextResponse } from 'next/server';
import { GraphQLClient, gql } from 'graphql-request';

// Uniswap V4 subgraph on Monad
const UNISWAP_V4_SUBGRAPH_ID = '3kaAG19ytkGfu8xD7YAAZ3qAQ3UDJRkmKH2kHUuyGHah';
const THE_GRAPH_API_KEY = process.env.THE_GRAPH_API_KEY || process.env.THEGRAPH_API_KEY || '';
const UNISWAP_V4_SUBGRAPH_URL =
  process.env.UNISWAP_V4_SUBGRAPH_URL?.trim() ||
  `https://gateway.thegraph.com/api/${THE_GRAPH_API_KEY}/subgraphs/id/${UNISWAP_V4_SUBGRAPH_ID}`;

const graphClient = new GraphQLClient(UNISWAP_V4_SUBGRAPH_URL);

// In-memory cache to prevent hammering the subgraph API
// Cache for 5 minutes (volatility doesn't change rapidly)
const CACHE_TTL_MS = 5 * 60 * 1000;
let volatilityCache: {
  data: Record<string, unknown> | null;
  timestamp: number;
  days: number;
} = { data: null, timestamp: 0, days: 0 };

// m00n/WMON pool on Monad
const TOKEN_MOON_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
const TOKEN_WMON_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';

// Query for recent swaps to get tick history
// Note: The exact schema depends on the subgraph version. Adjust field names if needed.
const GET_RECENT_SWAPS = gql`
  query GetRecentSwaps($pool: String!, $first: Int!, $orderBy: String!, $orderDirection: String!) {
    swaps(
      where: { pool: $pool }
      first: $first
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      id
      timestamp
      tick
      sqrtPriceX96
      amount0
      amount1
    }
  }
`;

// Alternative: Pool hourly data if swaps aren't available
const GET_POOL_HOUR_DATA = gql`
  query GetPoolHourData($pool: String!, $first: Int!) {
    poolHourDatas(
      where: { pool: $pool }
      first: $first
      orderBy: periodStartUnix
      orderDirection: desc
    ) {
      periodStartUnix
      tick
      sqrtPrice
      liquidity
      volumeToken0
      volumeToken1
    }
  }
`;

// Alternative: Pool day data
const GET_POOL_DAY_DATA = gql`
  query GetPoolDayData($pool: String!, $first: Int!) {
    poolDayDatas(where: { pool: $pool }, first: $first, orderBy: date, orderDirection: desc) {
      date
      tick
      sqrtPrice
      liquidity
      volumeToken0
      volumeToken1
    }
  }
`;

interface TickSnapshot {
  timestamp: number;
  tick: number;
}

function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

/**
 * Calculate realized volatility from tick snapshots.
 * Uses log returns and annualizes based on the time period.
 */
function calculateRealizedVol(snapshots: TickSnapshot[]): {
  dailyVol: number;
  annualizedVol: number;
  sampleCount: number;
  periodDays: number;
} | null {
  if (snapshots.length < 2) return null;

  // Sort by timestamp ascending
  const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);

  // Calculate log returns
  const logReturns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const priceNow = tickToPrice(sorted[i].tick);
    const pricePrev = tickToPrice(sorted[i - 1].tick);
    if (pricePrev > 0 && priceNow > 0) {
      logReturns.push(Math.log(priceNow / pricePrev));
    }
  }

  if (logReturns.length < 2) return null;

  // Calculate standard deviation of log returns
  const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;
  const variance =
    logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);
  const stdDev = Math.sqrt(variance);

  // Determine time period
  const periodSeconds = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
  const periodDays = periodSeconds / 86400;

  // Average time between observations
  const avgIntervalDays = periodDays / logReturns.length;

  // Daily vol (scale by sqrt of time interval)
  // If observations are hourly, daily vol = stdDev * sqrt(24)
  // If observations are daily, daily vol = stdDev
  const dailyVol =
    avgIntervalDays >= 0.5
      ? stdDev // Already ~daily
      : stdDev * Math.sqrt(1 / avgIntervalDays); // Scale up from sub-daily

  // Annualize: daily_vol * sqrt(365)
  const annualizedVol = dailyVol * Math.sqrt(365);

  return {
    dailyVol,
    annualizedVol,
    sampleCount: logReturns.length + 1,
    periodDays
  };
}

export async function GET(request: NextRequest) {
  const daysParam = request.nextUrl.searchParams.get('days') ?? '30';
  const days = Math.min(90, Math.max(1, Number(daysParam) || 30));

  // Check cache first - same days param and not stale
  const now = Date.now();
  if (
    volatilityCache.data &&
    volatilityCache.days === days &&
    now - volatilityCache.timestamp < CACHE_TTL_MS
  ) {
    console.log('VOLATILITY: serving cached response');
    return NextResponse.json(volatilityCache.data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Cache': 'HIT'
      }
    });
  }

  // Build pool ID (lowercase, format depends on subgraph schema)
  // This is typically: keccak256(abi.encode(token0, token1, fee, tickSpacing, hooks))
  // For now, we'll try to find the pool by token addresses
  const poolId = `${TOKEN_MOON_ADDRESS.toLowerCase()}-${TOKEN_WMON_ADDRESS.toLowerCase()}`;

  const snapshots: TickSnapshot[] = [];
  let source = 'none';

  try {
    // Try swaps first (most granular)
    try {
      const swapsData = (await graphClient.request(GET_RECENT_SWAPS, {
        pool: poolId,
        first: Math.min(1000, days * 24), // Rough estimate for hourly swaps
        orderBy: 'timestamp',
        orderDirection: 'desc'
      })) as { swaps?: Array<{ timestamp: string; tick: string }> };

      if (swapsData.swaps && swapsData.swaps.length >= 10) {
        source = 'swaps';
        for (const swap of swapsData.swaps) {
          snapshots.push({
            timestamp: Number(swap.timestamp),
            tick: Number(swap.tick)
          });
        }
      }
    } catch (e) {
      console.warn('VOLATILITY: swaps query failed, trying poolHourDatas', e);
    }

    // Fallback to hourly data
    if (snapshots.length < 10) {
      try {
        const hourlyData = (await graphClient.request(GET_POOL_HOUR_DATA, {
          pool: poolId,
          first: days * 24
        })) as { poolHourDatas?: Array<{ periodStartUnix: string; tick: string }> };

        if (hourlyData.poolHourDatas && hourlyData.poolHourDatas.length >= 5) {
          source = 'poolHourDatas';
          snapshots.length = 0; // Clear any partial swaps
          for (const hour of hourlyData.poolHourDatas) {
            snapshots.push({
              timestamp: Number(hour.periodStartUnix),
              tick: Number(hour.tick)
            });
          }
        }
      } catch (e) {
        console.warn('VOLATILITY: poolHourDatas query failed, trying poolDayDatas', e);
      }
    }

    // Fallback to daily data
    if (snapshots.length < 5) {
      try {
        const dailyData = (await graphClient.request(GET_POOL_DAY_DATA, {
          pool: poolId,
          first: days
        })) as { poolDayDatas?: Array<{ date: string; tick: string }> };

        if (dailyData.poolDayDatas && dailyData.poolDayDatas.length >= 2) {
          source = 'poolDayDatas';
          snapshots.length = 0;
          for (const day of dailyData.poolDayDatas) {
            snapshots.push({
              timestamp: Number(day.date) * 86400, // date is typically day number
              tick: Number(day.tick)
            });
          }
        }
      } catch (e) {
        console.warn('VOLATILITY: poolDayDatas query failed', e);
      }
    }

    if (snapshots.length < 2) {
      return NextResponse.json({
        success: false,
        error: 'insufficient_data',
        message: 'Not enough historical data to calculate volatility. Use manual input.',
        source: 'none',
        sampleCount: snapshots.length
      });
    }

    const vol = calculateRealizedVol(snapshots);

    if (!vol) {
      return NextResponse.json({
        success: false,
        error: 'calculation_failed',
        message: 'Could not calculate volatility from available data.',
        source,
        sampleCount: snapshots.length
      });
    }

    // Build response
    const responseData = {
      success: true,
      source,
      sampleCount: vol.sampleCount,
      periodDays: vol.periodDays,
      dailyVol: vol.dailyVol,
      annualizedVol: vol.annualizedVol,
      annualizedVolPercent: vol.annualizedVol * 100,
      // Suggested values
      suggestedSigmaStay: Math.round(vol.annualizedVol * 100), // realized
      suggestedSigmaFwd: Math.round(vol.annualizedVol * 120), // +20% premium for forward
      lastUpdated: new Date().toISOString()
    };

    // Cache successful response
    volatilityCache = {
      data: responseData,
      timestamp: Date.now(),
      days
    };

    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Cache': 'MISS'
      }
    });
  } catch (error) {
    console.error('VOLATILITY_ROUTE:failed', error);
    return NextResponse.json(
      {
        success: false,
        error: 'fetch_failed',
        message: 'Failed to fetch historical data. Use manual input.',
        details: String(error)
      },
      { status: 500 }
    );
  }
}
