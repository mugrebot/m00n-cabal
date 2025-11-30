import { NextRequest, NextResponse } from 'next/server';
import {
  derivePersonaHint,
  getPersonaRow,
  type CsvPersonaHint,
  type NautyCsvRow
} from '@/app/lib/nautynice';

interface PersonaResponse {
  found: boolean;
  personaHint?: CsvPersonaHint | null;
  record?: NautyCsvRow | null;
}

const serializeRow = (row: NautyCsvRow) => ({
  fid: row.fid,
  username: row.username ?? null,
  replyCount: row.replyCount ?? null,
  hasClaimed: row.hasClaimed ?? false,
  totalEstimatedBalance: row.totalEstimatedBalance ?? null,
  totalPurchased: row.totalPurchased ?? null,
  totalSold: row.totalSold ?? null,
  totalReceivedAllWallets: row.totalReceivedAllWallets ?? null,
  totalSentAllWallets: row.totalSentAllWallets ?? null,
  totalTransactions: row.totalTransactions ?? null,
  userCategory: row.userCategory ?? null,
  behaviorPattern: row.behaviorPattern ?? null,
  earliestInteraction: row.earliestInteraction ?? null,
  latestInteraction: row.latestInteraction ?? null
});

export async function GET(request: NextRequest) {
  const fidParam = request.nextUrl.searchParams.get('fid');
  const fid = fidParam ? Number(fidParam) : NaN;

  if (!fidParam || !Number.isFinite(fid)) {
    return NextResponse.json({ error: 'invalid_fid' }, { status: 400 });
  }

  const row = getPersonaRow(fid);
  if (!row) {
    const payload: PersonaResponse = { found: false };
    return NextResponse.json(payload);
  }

  const personaHint = derivePersonaHint(row);
  const payload: PersonaResponse = {
    found: true,
    personaHint,
    record: serializeRow(row)
  };

  return NextResponse.json(payload);
}
