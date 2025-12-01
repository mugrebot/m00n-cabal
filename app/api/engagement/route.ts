import { NextRequest, NextResponse } from 'next/server';

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY || '';
const NEYNAR_API_BASE = 'https://api.neynar.com';
const M00NPAPI_USERNAME = 'm00npapi';
const FALLBACK_M00NPAPI_FID =
  Number(
    process.env.M00NPAPI_FID ??
      process.env.NEXT_PUBLIC_M00NPAPI_FID ??
      process.env.NEYNAR_M00NPAPI_FID ??
      0
  ) || null;
const CACHE_DURATION = 60 * 5; // 5 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface NeynarUser {
  fid: number;
  username?: string;
}

interface NeynarUserResponse {
  user: NeynarUser;
}

interface NeynarPagination {
  cursor?: string;
}

interface CastsResponse {
  casts?: unknown[];
  next?: NeynarPagination;
}

interface FollowingResponse {
  users?: NeynarUser[];
  next?: NeynarPagination;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_DURATION * 1000) {
    return entry.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

async function getM00npapiInfo() {
  const cacheKey = 'moonpapi-info';
  const cached = getCached<NeynarUser>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(
      `${NEYNAR_API_BASE}/v2/farcaster/user/by_username?username=${M00NPAPI_USERNAME}`,
      {
        headers: {
          api_key: NEYNAR_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch m00npapi info');
    }

    const data = (await response.json()) as NeynarUserResponse;
    const info: NeynarUser = {
      fid: data.user.fid,
      username: data.user.username
    };
    setCache(cacheKey, info);
    return info;
  } catch (error) {
    console.error('Error fetching m00npapi info:', error);
    return null;
  }
}

async function countReplies(viewerFid: number, parentFid: number): Promise<number> {
  const cacheKey = `replies-${viewerFid}-${parentFid}`;
  const cached = getCached<number>(cacheKey);
  if (cached !== null) return cached;

  let totalCount = 0;
  let cursor: string | null = null;
  const maxPages = 5; // Limit to ~150 replies (30 per page)

  try {
    for (let i = 0; i < maxPages; i++) {
      const url = new URL(`${NEYNAR_API_BASE}/v2/farcaster/casts`);
      url.searchParams.append('fid', viewerFid.toString());
      url.searchParams.append('parent_fid', parentFid.toString());
      url.searchParams.append('limit', '30');
      if (cursor) {
        url.searchParams.append('cursor', cursor);
      }

      const response = await fetch(url.toString(), {
        headers: {
          api_key: NEYNAR_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.error('Failed to fetch replies:', response.status);
        break;
      }

      const data = (await response.json()) as CastsResponse;
      totalCount += data.casts?.length ?? 0;

      if (!data.next?.cursor) {
        break;
      }
      cursor = data.next.cursor;
    }

    setCache(cacheKey, totalCount);
    return totalCount;
  } catch (error) {
    console.error('Error counting replies:', error);
    return 0;
  }
}

async function checkIfFollowing(moonpapiFid: number, viewerFid: number): Promise<boolean> {
  const cacheKey = `following-${moonpapiFid}-${viewerFid}`;
  const cached = getCached<boolean>(cacheKey);
  if (cached !== null) return cached;

  try {
    let cursor: string | null = null;
    const maxPages = 10;

    for (let i = 0; i < maxPages; i++) {
      const url = new URL(`${NEYNAR_API_BASE}/v2/farcaster/following`);
      url.searchParams.append('fid', moonpapiFid.toString());
      url.searchParams.append('limit', '100');
      if (cursor) {
        url.searchParams.append('cursor', cursor);
      }

      const response = await fetch(url.toString(), {
        headers: {
          api_key: NEYNAR_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.error('Failed to fetch following:', response.status);
        break;
      }

      const data = (await response.json()) as FollowingResponse;

      const isFollowing = data.users?.some((user) => user.fid === viewerFid) ?? false;
      if (isFollowing) {
        setCache(cacheKey, true);
        return true;
      }

      if (!data.next?.cursor) {
        break;
      }
      cursor = data.next.cursor;
    }

    setCache(cacheKey, false);
    return false;
  } catch (error) {
    console.error('Error checking following:', error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const fid = searchParams.get('fid');

  if (!fid) {
    return NextResponse.json({ error: 'FID parameter is required' }, { status: 400 });
  }

  if (!NEYNAR_API_KEY) {
    console.error('NEYNAR_API_KEY not configured');
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }

  try {
    const viewerFid = parseInt(fid);

    const fallbackInfo =
      FALLBACK_M00NPAPI_FID && FALLBACK_M00NPAPI_FID > 0
        ? { fid: FALLBACK_M00NPAPI_FID, username: M00NPAPI_USERNAME }
        : null;
    let moonpapiInfo = await getM00npapiInfo();
    let usedFallback = false;
    if (!moonpapiInfo && fallbackInfo) {
      console.warn('[engagement] Using fallback moonpapi fid');
      moonpapiInfo = fallbackInfo;
      usedFallback = true;
    }
    if (!moonpapiInfo) {
      console.warn('[engagement] Unable to resolve moonpapi fid; sending fallback response');
      return NextResponse.json({
        replyCount: 0,
        isFollowing: false,
        moonpapiFid: null,
        fallback: true
      });
    }

    const [replyCount, isFollowing] = await Promise.all([
      countReplies(viewerFid, moonpapiInfo.fid),
      checkIfFollowing(moonpapiInfo.fid, viewerFid)
    ]);

    return NextResponse.json({
      replyCount,
      isFollowing,
      moonpapiFid: moonpapiInfo.fid,
      fallback: usedFallback
    });
  } catch (error) {
    console.error('Error in engagement API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
