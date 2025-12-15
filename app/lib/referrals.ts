/**
 * Referral System for m00n
 *
 * Simple referral tracking:
 * - Share your link: /miniapp?ref={FID}
 * - When someone joins via your link, you get 5% of their points
 * - Second-degree: 2% of their referrals' points
 */

import { kv } from '@vercel/kv';

// KV keys
const REFERRAL_DATA_KEY = 'm00n:referrals:data';
const REFERRAL_STATS_KEY = (fid: number) => `m00n:referrals:stats:${fid}`;

// Check if KV is configured
const isKvConfigured =
  Boolean(process.env.KV_URL) ||
  (Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN));

// Referral bonus percentages
export const DIRECT_REFERRAL_BONUS = 0.05; // 5% of referee's points
export const SECOND_DEGREE_BONUS = 0.02; // 2% of second-degree referrals

// Types
export interface ReferralRecord {
  referrerFid: number;
  refereeFid: number;
  refereeUsername?: string;
  refereeAddress: string;
  createdAt: number;
  firstLpAt?: number; // When they first created an LP
}

export interface ReferralStats {
  fid: number;
  referralCode: string;
  referralLink: string;

  // Who referred you
  referredBy?: number;

  // Your referrals
  directReferrals: number;
  secondDegreeReferrals: number;

  // Points earned from referrals
  pointsFromDirect: number;
  pointsFromSecondDegree: number;
  totalReferralPoints: number;

  // Timestamps
  lastReferralAt?: number;
}

// Get user's referral stats
export async function getReferralStats(fid: number): Promise<ReferralStats> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://m00nad.vercel.app';
  const referralCode = fid.toString();
  const referralLink = `${baseUrl}/miniapp?ref=${referralCode}`;

  const defaultStats: ReferralStats = {
    fid,
    referralCode,
    referralLink,
    directReferrals: 0,
    secondDegreeReferrals: 0,
    pointsFromDirect: 0,
    pointsFromSecondDegree: 0,
    totalReferralPoints: 0
  };

  if (!isKvConfigured) return defaultStats;

  try {
    const stats = await kv.get<ReferralStats>(REFERRAL_STATS_KEY(fid));
    if (!stats) return defaultStats;

    return {
      ...stats,
      referralCode,
      referralLink
    };
  } catch {
    return defaultStats;
  }
}

// Record a referral (when someone joins via a referral link)
export async function recordReferral(
  referrerFid: number,
  refereeFid: number,
  refereeUsername: string,
  refereeAddress: string
): Promise<{ success: boolean; message: string }> {
  if (referrerFid === refereeFid) {
    return { success: false, message: 'Cannot refer yourself' };
  }

  if (!isKvConfigured) {
    return { success: true, message: 'Referral recorded (KV not configured)' };
  }

  const now = Date.now();

  try {
    // Check if already referred
    const existingRefereeStats = await kv.get<ReferralStats>(REFERRAL_STATS_KEY(refereeFid));
    if (existingRefereeStats?.referredBy) {
      return { success: false, message: 'Already referred by someone else' };
    }

    // Create referral record
    const referralKey = `${REFERRAL_DATA_KEY}:${referrerFid}:${refereeFid}`;
    const record: ReferralRecord = {
      referrerFid,
      refereeFid,
      refereeUsername,
      refereeAddress,
      createdAt: now
    };
    await kv.set(referralKey, record);

    // Update referrer stats
    const referrerStats = await getReferralStats(referrerFid);
    referrerStats.directReferrals = (referrerStats.directReferrals ?? 0) + 1;
    referrerStats.lastReferralAt = now;
    await kv.set(REFERRAL_STATS_KEY(referrerFid), referrerStats);

    // Update referee stats (mark who referred them)
    const refereeStats = await getReferralStats(refereeFid);
    refereeStats.referredBy = referrerFid;
    await kv.set(REFERRAL_STATS_KEY(refereeFid), refereeStats);

    // Check for second-degree referral
    if (referrerStats.referredBy) {
      const grandReferrerStats = await getReferralStats(referrerStats.referredBy);
      grandReferrerStats.secondDegreeReferrals =
        (grandReferrerStats.secondDegreeReferrals ?? 0) + 1;
      await kv.set(REFERRAL_STATS_KEY(referrerStats.referredBy), grandReferrerStats);
    }

    return { success: true, message: 'Referral recorded!' };
  } catch (err) {
    console.error('[referrals] Failed to record referral:', err);
    return { success: false, message: 'Failed to record referral' };
  }
}

// Add points to referrer when referee earns points
export async function creditReferralPoints(
  refereeFid: number,
  pointsEarned: number
): Promise<void> {
  if (!isKvConfigured || pointsEarned <= 0) return;

  try {
    const refereeStats = await getReferralStats(refereeFid);
    if (!refereeStats.referredBy) return;

    // Credit direct referrer (5%)
    const directBonus = Math.floor(pointsEarned * DIRECT_REFERRAL_BONUS);
    if (directBonus > 0) {
      const referrerStats = await getReferralStats(refereeStats.referredBy);
      referrerStats.pointsFromDirect = (referrerStats.pointsFromDirect ?? 0) + directBonus;
      referrerStats.totalReferralPoints =
        (referrerStats.pointsFromDirect ?? 0) + (referrerStats.pointsFromSecondDegree ?? 0);
      await kv.set(REFERRAL_STATS_KEY(refereeStats.referredBy), referrerStats);

      // Credit second-degree referrer (2%)
      if (referrerStats.referredBy) {
        const secondDegreeBonus = Math.floor(pointsEarned * SECOND_DEGREE_BONUS);
        if (secondDegreeBonus > 0) {
          const grandReferrerStats = await getReferralStats(referrerStats.referredBy);
          grandReferrerStats.pointsFromSecondDegree =
            (grandReferrerStats.pointsFromSecondDegree ?? 0) + secondDegreeBonus;
          grandReferrerStats.totalReferralPoints =
            (grandReferrerStats.pointsFromDirect ?? 0) +
            (grandReferrerStats.pointsFromSecondDegree ?? 0);
          await kv.set(REFERRAL_STATS_KEY(referrerStats.referredBy), grandReferrerStats);
        }
      }
    }
  } catch (err) {
    console.error('[referrals] Failed to credit referral points:', err);
  }
}

// Get referral leaderboard
export async function getReferralLeaderboard(): Promise<
  {
    fid: number;
    directReferrals: number;
    totalReferralPoints: number;
  }[]
> {
  // For a full implementation, you'd scan all referral stats
  // For now, return empty - can be built out later
  return [];
}

// Format points for display
export function formatReferralPoints(points: number): string {
  if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`;
  if (points >= 1_000) return `${(points / 1_000).toFixed(1)}K`;
  return points.toLocaleString();
}
