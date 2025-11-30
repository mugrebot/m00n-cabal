import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

export interface NautyCsvRow {
  fid: number;
  username?: string | null;
  replyCount?: number | null;
  hasClaimed?: boolean;
  totalEstimatedBalance?: number | null;
  totalPurchased?: number | null;
  totalSold?: number | null;
  totalReceivedAllWallets?: number | null;
  totalSentAllWallets?: number | null;
  totalTransactions?: number | null;
  userCategory?: string | null;
  behaviorPattern?: string | null;
  earliestInteraction?: string | null;
  latestInteraction?: string | null;
}

export type CsvPersonaHint = 'claimed_sold' | 'claimed_held' | 'claimed_bought_more' | 'emoji_chat';

let cachedRows: Map<number, NautyCsvRow> | null = null;

const CSV_PATH = path.join(process.cwd(), 'apps', 'nautynice.csv');

const toNumber = (value?: string | null) => {
  if (value === undefined || value === null || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toBoolean = (value?: string | null) => {
  if (!value) return false;
  return value.trim() === '1' || value.trim().toLowerCase() === 'true';
};

const normalizeRow = (row: Record<string, string>): NautyCsvRow | null => {
  const fid = Number(row.fid);
  if (!Number.isFinite(fid)) {
    return null;
  }

  return {
    fid,
    username: row.username?.trim() || null,
    replyCount: toNumber(row.reply_count),
    hasClaimed: toBoolean(row.has_claimed),
    totalEstimatedBalance: toNumber(row.total_estimated_balance),
    totalPurchased: toNumber(row.total_purchased),
    totalSold: toNumber(row.total_sold),
    totalReceivedAllWallets: toNumber(row.total_received_all_wallets),
    totalSentAllWallets: toNumber(row.total_sent_all_wallets),
    totalTransactions: toNumber(row.total_transactions),
    userCategory: row.user_category?.trim() || null,
    behaviorPattern: row.behavior_pattern?.trim() || null,
    earliestInteraction: row.earliest_interaction?.trim() || null,
    latestInteraction: row.latest_interaction?.trim() || null
  };
};

const loadCsv = () => {
  if (cachedRows) {
    return cachedRows;
  }
  const fileContents = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(fileContents, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];

  cachedRows = new Map();
  for (const record of records) {
    const normalized = normalizeRow(record);
    if (normalized) {
      cachedRows.set(normalized.fid, normalized);
    }
  }
  return cachedRows;
};

export const getPersonaRow = (fid: number): NautyCsvRow | null => {
  const rows = loadCsv();
  return rows.get(fid) ?? null;
};

export const derivePersonaHint = (row: NautyCsvRow): CsvPersonaHint | null => {
  const category = row.userCategory?.toLowerCase();
  const behavior = row.behaviorPattern?.toLowerCase();

  if (behavior === 'mostly_sold' || category === 'claimed_and_sold') {
    return 'claimed_sold';
  }
  if (category === 'claimed_and_held') {
    return 'claimed_held';
  }
  if (category === 'claimed_and_bought_more') {
    return 'claimed_bought_more';
  }
  if (category === 'didnt_claim_but_bought') {
    return 'emoji_chat';
  }
  return null;
};
