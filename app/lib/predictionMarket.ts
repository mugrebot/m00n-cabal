/**
 * Prediction Market for m00n LP Positions
 *
 * DESIGN:
 * - Users stake their LP NFT to make predictions
 * - Predictions are about m00n price at a future date
 * - Winners receive a share of the loser's 30-day fee equivalent
 * - Fully off-chain tracking, on-chain settlement later
 *
 * GAME MODES:
 * 1. Price Target - Will m00n hit $X by date Y?
 * 2. Range Bound - Will m00n stay between $X and $Y for 7 days?
 * 3. LP Challenge - Whose LP will earn more fees in 7 days?
 */

// ============ Types ============

export type PredictionType = 'price_target' | 'range_bound' | 'lp_challenge';
export type PredictionStatus = 'pending' | 'active' | 'resolved' | 'cancelled';
export type PredictionOutcome = 'yes' | 'no' | 'draw' | null;

export interface PredictionMarket {
  id: string;
  type: PredictionType;
  status: PredictionStatus;

  // Market details
  title: string;
  description: string;

  // Timing
  createdAt: number; // Unix timestamp
  expiresAt: number; // When prediction resolves
  resolvedAt?: number;

  // Price target specifics
  targetPrice?: number; // USD
  priceDirection?: 'above' | 'below';

  // Range bound specifics
  rangeLower?: number;
  rangeUpper?: number;

  // LP Challenge specifics
  challenger1?: string; // Token ID
  challenger2?: string; // Token ID

  // Stakes
  totalStakedYes: number; // Total notional USD on "yes"
  totalStakedNo: number; // Total notional USD on "no"
  participants: PredictionParticipant[];

  // Resolution
  outcome?: PredictionOutcome;
  resolutionPrice?: number;
  resolutionNote?: string;
}

export interface PredictionParticipant {
  fid: number;
  username: string;
  address: string;

  // Stake
  lpTokenId: string;
  stakeNotionalUsd: number;
  prediction: 'yes' | 'no';

  // Result
  won?: boolean;
  payout?: number; // Equivalent fee days won
}

export interface UserPredictionStats {
  fid: number;
  totalPredictions: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  totalEarned: number; // Fee days equivalent
  totalLost: number;
  currentStreak: number;
  longestStreak: number;
}

// ============ Constants ============

export const PREDICTION_CONSTANTS = {
  MIN_STAKE_USD: 5, // Minimum LP value to stake
  MAX_DURATION_DAYS: 30,
  MIN_DURATION_DAYS: 1,
  FEE_DAYS_PAYOUT: 30, // Winners get equivalent of 30 days of loser's fees
  DRAW_THRESHOLD: 0.01 // 1% tolerance for draw
};

// ============ Helper Functions ============

/**
 * Generate unique prediction ID
 */
export function generatePredictionId(): string {
  return `pred_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Calculate payout for winners
 * Winners split the loser pool proportionally to their stake
 */
export function calculatePayouts(market: PredictionMarket): Map<string, number> {
  const payouts = new Map<string, number>();

  if (market.outcome === 'draw') {
    // Everyone gets their stake back (no payout)
    return payouts;
  }

  const winningPrediction = market.outcome === 'yes' ? 'yes' : 'no';
  const winners = market.participants.filter((p) => p.prediction === winningPrediction);
  const losers = market.participants.filter((p) => p.prediction !== winningPrediction);

  if (winners.length === 0 || losers.length === 0) {
    return payouts;
  }

  // Calculate total loser pool (fee days equivalent)
  const loserPool = losers.reduce((sum, p) => {
    // Estimate 30 days of fees based on their position value
    // Assume ~0.1% daily fee rate
    const estimatedDailyFees = p.stakeNotionalUsd * 0.001;
    return sum + estimatedDailyFees * PREDICTION_CONSTANTS.FEE_DAYS_PAYOUT;
  }, 0);

  // Distribute to winners proportionally
  const totalWinnerStake = winners.reduce((sum, p) => sum + p.stakeNotionalUsd, 0);

  winners.forEach((winner) => {
    const share = winner.stakeNotionalUsd / totalWinnerStake;
    payouts.set(winner.lpTokenId, loserPool * share);
  });

  return payouts;
}

/**
 * Check if price target was hit
 */
export function checkPriceTarget(
  targetPrice: number,
  direction: 'above' | 'below',
  currentPrice: number
): PredictionOutcome {
  if (direction === 'above') {
    if (currentPrice >= targetPrice) return 'yes';
    return 'no';
  } else {
    if (currentPrice <= targetPrice) return 'yes';
    return 'no';
  }
}

/**
 * Check if price stayed in range
 */
export function checkRangeBound(
  rangeLower: number,
  rangeUpper: number,
  priceHistory: number[]
): PredictionOutcome {
  const stayedInRange = priceHistory.every((p) => p >= rangeLower && p <= rangeUpper);
  return stayedInRange ? 'yes' : 'no';
}

/**
 * Format prediction for display
 */
export function formatPrediction(market: PredictionMarket): {
  title: string;
  subtitle: string;
  odds: string;
  expiresIn: string;
} {
  const now = Date.now();
  const expiresInMs = market.expiresAt * 1000 - now;
  const expiresInDays = Math.ceil(expiresInMs / (1000 * 60 * 60 * 24));

  const totalStaked = market.totalStakedYes + market.totalStakedNo;
  const yesOdds = totalStaked > 0 ? ((market.totalStakedYes / totalStaked) * 100).toFixed(0) : '50';
  const noOdds = totalStaked > 0 ? ((market.totalStakedNo / totalStaked) * 100).toFixed(0) : '50';

  let subtitle = '';
  if (market.type === 'price_target') {
    subtitle = `Will m00n be ${market.priceDirection} $${market.targetPrice?.toExponential(2)}?`;
  } else if (market.type === 'range_bound') {
    subtitle = `Will m00n stay between $${market.rangeLower?.toExponential(2)} and $${market.rangeUpper?.toExponential(2)}?`;
  } else if (market.type === 'lp_challenge') {
    subtitle = `LP #${market.challenger1} vs LP #${market.challenger2}`;
  }

  return {
    title: market.title,
    subtitle,
    odds: `${yesOdds}% YES / ${noOdds}% NO`,
    expiresIn: expiresInDays > 0 ? `${expiresInDays}d left` : 'Expired'
  };
}

// ============ Sample Markets ============

export function createSampleMarkets(currentMoonPriceUsd: number): PredictionMarket[] {
  const now = Math.floor(Date.now() / 1000);
  const oneWeek = 7 * 24 * 60 * 60;

  return [
    {
      id: generatePredictionId(),
      type: 'price_target',
      status: 'active',
      title: '🚀 Moon Shot',
      description: 'Will m00n 2x from current price?',
      createdAt: now,
      expiresAt: now + oneWeek,
      targetPrice: currentMoonPriceUsd * 2,
      priceDirection: 'above',
      totalStakedYes: 0,
      totalStakedNo: 0,
      participants: []
    },
    {
      id: generatePredictionId(),
      type: 'price_target',
      status: 'active',
      title: '📉 Crash Protection',
      description: 'Will m00n stay above half of current price?',
      createdAt: now,
      expiresAt: now + oneWeek,
      targetPrice: currentMoonPriceUsd * 0.5,
      priceDirection: 'above',
      totalStakedYes: 0,
      totalStakedNo: 0,
      participants: []
    },
    {
      id: generatePredictionId(),
      type: 'range_bound',
      status: 'active',
      title: '🎯 Steady State',
      description: 'Will m00n stay within ±50% range?',
      createdAt: now,
      expiresAt: now + oneWeek,
      rangeLower: currentMoonPriceUsd * 0.5,
      rangeUpper: currentMoonPriceUsd * 1.5,
      totalStakedYes: 0,
      totalStakedNo: 0,
      participants: []
    }
  ];
}

// ============ KV Storage Keys ============

export const PREDICTION_KV_KEYS = {
  allMarkets: 'prediction:markets:all',
  activeMarkets: 'prediction:markets:active',
  marketById: (id: string) => `prediction:market:${id}`,
  userStats: (fid: number) => `prediction:user:${fid}:stats`,
  userHistory: (fid: number) => `prediction:user:${fid}:history`
};

// ============ API Response Types ============

export interface PredictionMarketsResponse {
  markets: PredictionMarket[];
  userStats?: UserPredictionStats;
}

export interface JoinPredictionRequest {
  marketId: string;
  fid: number;
  username: string;
  address: string;
  lpTokenId: string;
  stakeNotionalUsd: number;
  prediction: 'yes' | 'no';
}

export interface JoinPredictionResponse {
  success: boolean;
  message: string;
  market?: PredictionMarket;
}
