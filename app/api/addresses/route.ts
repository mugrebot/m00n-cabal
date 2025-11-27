import { NextRequest, NextResponse } from 'next/server';

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY || '';
const NEYNAR_API_BASE = 'https://api.neynar.com';

interface NeynarUser {
  verified_addresses?: {
    eth_addresses?: string[];
  };
}

interface NeynarUserResponse {
  users?: NeynarUser[];
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const fid = searchParams.get('fid');

  if (!fid) {
    return NextResponse.json({ error: 'fid is required' }, { status: 400 });
  }

  if (!NEYNAR_API_KEY) {
    console.error('NEYNAR_API_KEY not configured');
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }

  try {
    const url = new URL(`${NEYNAR_API_BASE}/v2/farcaster/user/bulk`);
    url.searchParams.append('fids', fid);

    const response = await fetch(url.toString(), {
      headers: {
        api_key: NEYNAR_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Failed to fetch verified addresses:', response.status);
      return NextResponse.json({ error: 'Unable to fetch verified addresses' }, { status: 502 });
    }

    const data = (await response.json()) as NeynarUserResponse;
    const addresses = data.users?.[0]?.verified_addresses?.eth_addresses ?? [];

    return NextResponse.json({ addresses });
  } catch (error) {
    console.error('Error in addresses API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
