if (typeof process !== 'undefined' && process.env.NEXT_RUNTIME) {
  import('server-only');
}

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

export const getAddressLabel = (address: string): string | null => {
  if (!address) return null;
  const labels = loadAddressLabelMap();
  const record = labels.get(address.toLowerCase());
  if (!record) return null;
  if (record.username) return record.username;
  if (record.fid) return `FID ${record.fid}`;
  return null;
};

// Cache for Neynar lookups (in-memory, clears on restart)
const neynarCache = new Map<string, string | null>();

/**
 * Async version that queries Neynar API for addresses not found in CSV
 */
export const getAddressLabelAsync = async (address: string): Promise<string | null> => {
  if (!address) return null;

  // First check CSV
  const csvLabel = getAddressLabel(address);
  if (csvLabel) return csvLabel;

  // Check cache
  const cached = neynarCache.get(address.toLowerCase());
  if (cached !== undefined) return cached;

  // Query Neynar API
  const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
  if (!NEYNAR_API_KEY) {
    neynarCache.set(address.toLowerCase(), null);
    return null;
  }

  try {
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${address}`,
      {
        headers: {
          accept: 'application/json',
          api_key: NEYNAR_API_KEY
        },
        next: { revalidate: 3600 } // Cache for 1 hour
      }
    );

    if (!response.ok) {
      neynarCache.set(address.toLowerCase(), null);
      return null;
    }

    const data = await response.json();
    const users = data[address.toLowerCase()];

    if (users && users.length > 0) {
      const username = users[0].username;
      neynarCache.set(address.toLowerCase(), username);

      // Also add to the main cache for future sync lookups
      const labels = loadAddressLabelMap();
      labels.set(address.toLowerCase(), { username, fid: users[0].fid });

      return username;
    }

    neynarCache.set(address.toLowerCase(), null);
    return null;
  } catch (error) {
    console.error('[addressLabels] Neynar lookup failed:', error);
    neynarCache.set(address.toLowerCase(), null);
    return null;
  }
};

/**
 * Batch resolve multiple addresses at once (more efficient)
 */
export const batchResolveLabels = async (
  addresses: string[]
): Promise<Map<string, string | null>> => {
  const results = new Map<string, string | null>();
  const toQuery: string[] = [];

  // First pass: check CSV and cache
  for (const addr of addresses) {
    const csvLabel = getAddressLabel(addr);
    if (csvLabel) {
      results.set(addr.toLowerCase(), csvLabel);
    } else {
      const cached = neynarCache.get(addr.toLowerCase());
      if (cached !== undefined) {
        results.set(addr.toLowerCase(), cached);
      } else {
        toQuery.push(addr);
      }
    }
  }

  // Query Neynar for remaining addresses (up to 350 at a time per API limit)
  const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
  if (!NEYNAR_API_KEY || toQuery.length === 0) {
    for (const addr of toQuery) {
      results.set(addr.toLowerCase(), null);
    }
    return results;
  }

  try {
    // Neynar allows up to 350 addresses per request
    const chunks = [];
    for (let i = 0; i < toQuery.length; i += 350) {
      chunks.push(toQuery.slice(i, i + 350));
    }

    for (const chunk of chunks) {
      const response = await fetch(
        `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${chunk.join(',')}`,
        {
          headers: {
            accept: 'application/json',
            api_key: NEYNAR_API_KEY
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        for (const addr of chunk) {
          const users = data[addr.toLowerCase()];
          if (users && users.length > 0) {
            const username = users[0].username;
            results.set(addr.toLowerCase(), username);
            neynarCache.set(addr.toLowerCase(), username);

            // Also update main cache
            const labels = loadAddressLabelMap();
            labels.set(addr.toLowerCase(), { username, fid: users[0].fid });
          } else {
            results.set(addr.toLowerCase(), null);
            neynarCache.set(addr.toLowerCase(), null);
          }
        }
      } else {
        for (const addr of chunk) {
          results.set(addr.toLowerCase(), null);
        }
      }
    }
  } catch (error) {
    console.error('[addressLabels] Batch Neynar lookup failed:', error);
    for (const addr of toQuery) {
      results.set(addr.toLowerCase(), null);
    }
  }

  return results;
};
