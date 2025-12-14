/**
 * App Added Bonus System
 *
 * Users who add the m00n mini app to their Farcaster client
 * get a permanent 1.1x multiplier on their points.
 *
 * This represents "staking your attention" on the project.
 */

import { kv } from '@vercel/kv';

const APP_ADDED_KEY = 'm00n:app-added';

const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

export interface AppAddedRecord {
  fid: number;
  username: string;
  addedAt: number;
  address?: string;
}

export const APP_ADDED_MULTIPLIER = 1.1;

// Get all users who have added the app
export async function getAppAddedData(): Promise<Record<string, AppAddedRecord>> {
  if (!isKvConfigured) return {};
  try {
    const data = await kv.get<Record<string, AppAddedRecord>>(APP_ADDED_KEY);
    return data ?? {};
  } catch {
    return {};
  }
}

// Check if a user has added the app
export async function hasUserAddedApp(fid: number): Promise<boolean> {
  const data = await getAppAddedData();
  return !!data[fid.toString()];
}

// Record that a user added the app
export async function recordAppAdded(
  fid: number,
  username: string,
  address?: string
): Promise<AppAddedRecord> {
  const now = Date.now();
  const record: AppAddedRecord = {
    fid,
    username,
    addedAt: now,
    address
  };

  if (isKvConfigured) {
    try {
      const data = await getAppAddedData();
      data[fid.toString()] = record;
      await kv.set(APP_ADDED_KEY, data);
    } catch (err) {
      console.error('[appBonus] Failed to save app added:', err);
    }
  }

  return record;
}

// Get app added status for a user
export async function getAppAddedStatus(fid: number): Promise<{
  added: boolean;
  addedAt?: number;
  multiplier: number;
}> {
  const data = await getAppAddedData();
  const record = data[fid.toString()];

  if (record) {
    return {
      added: true,
      addedAt: record.addedAt,
      multiplier: APP_ADDED_MULTIPLIER
    };
  }

  return {
    added: false,
    multiplier: 1
  };
}

// Get total users who added the app
export async function getTotalAppAddedCount(): Promise<number> {
  const data = await getAppAddedData();
  return Object.keys(data).length;
}
