import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

export interface AddressLabelRecord {
  fid?: number | null;
  username?: string | null;
}

const CSV_CANDIDATES = [
  path.join(process.cwd(), 'data', 'm00n - m00n.csv.csv'),
  path.join(process.cwd(), 'data', 'm00nad.csv'),
  path.join(process.cwd(), 'data', 'nautynice.csv')
];

const resolveDefaultCsvPath = () => {
  for (const candidate of CSV_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

const ADDRESS_CSV_PATH =
  process.env.LEADERBOARD_ADDRESS_CSV && process.env.LEADERBOARD_ADDRESS_CSV.trim().length
    ? process.env.LEADERBOARD_ADDRESS_CSV.trim()
    : resolveDefaultCsvPath();

let cache: Map<string, AddressLabelRecord> | null = null;

export const loadAddressLabelMap = (): Map<string, AddressLabelRecord> => {
  if (cache) {
    return cache;
  }

  const resolvedPath = ADDRESS_CSV_PATH;

  if (!resolvedPath) {
    console.warn('[addressLabels] No CSV path available.');
    cache = new Map();
    return cache;
  }

  try {
    const file = fs.readFileSync(resolvedPath, 'utf8');
    const rows = parse(file, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Record<string, string>[];

    cache = new Map();
    for (const row of rows) {
      const addressKey = Object.keys(row).find((key) => key.toLowerCase() === 'address');
      const address = addressKey ? row[addressKey]?.toLowerCase() : row.address?.toLowerCase();
      if (!address) continue;
      const fid = Number(row.fid);
      cache.set(address, {
        fid: Number.isFinite(fid) ? fid : null,
        username: row.username?.trim() || null
      });
    }
  } catch (error) {
    console.warn('[addressLabels] Unable to load CSV', error);
    cache = new Map();
  }

  return cache!;
};
