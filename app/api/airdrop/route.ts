import { NextRequest, NextResponse } from 'next/server';
import airdropData from '@/public/data/m00nad_airdrop.json';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json({ error: 'Address parameter is required' }, { status: 400 });
  }

  const normalizedAddress = address.toLowerCase();
  const allocation = airdropData[normalizedAddress as keyof typeof airdropData];

  if (allocation) {
    return NextResponse.json({
      eligible: true,
      amount: allocation.amount
    });
  }

  return NextResponse.json({
    eligible: false
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const address = body.address;

    if (!address) {
      return NextResponse.json({ error: 'Address is required in request body' }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();
    const allocation = airdropData[normalizedAddress as keyof typeof airdropData];

    if (allocation) {
      return NextResponse.json({
        eligible: true,
        amount: allocation.amount
      });
    }

    return NextResponse.json({
      eligible: false
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
