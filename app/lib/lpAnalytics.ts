/**
 * LP Position Analytics
 * - Impermanent Loss calculation
 * - APR/APY estimates
 * - vs HODL comparison
 * - Auto-rebalance suggestions
 */

export interface PositionAnalytics {
  // Impermanent Loss
  impermanentLoss: {
    percentage: number; // e.g., -2.5 means 2.5% IL
    usdAmount: number;
    description: string;
  };

  // APR from fees
  feesApr: {
    percentage: number;
    projectedYearlyUsd: number;
    dailyUsd: number;
  };

  // vs HODL comparison
  vsHodl: {
    lpValueUsd: number;
    hodlValueUsd: number;
    differenceUsd: number;
    differencePercent: number;
    winner: 'LP' | 'HODL' | 'TIE';
  };

  // Rebalance suggestion
  rebalanceSuggestion: {
    shouldRebalance: boolean;
    reason: string;
    suggestedLower: number;
    suggestedUpper: number;
    currentDistance: number; // How far from range center
  } | null;
}

export interface PositionInput {
  // Current state
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  rangeStatus: 'below-range' | 'in-range' | 'above-range';

  // Token amounts
  token0Amount: number; // m00n
  token1Amount: number; // WMON

  // Prices
  moonPriceUsd: number;
  wmonPriceUsd: number;

  // Initial deposit (for IL calc) - estimated from position
  estimatedInitialToken0?: number;
  estimatedInitialToken1?: number;
  depositPriceRatio?: number; // m00n/WMON at deposit time

  // Fees earned
  lifetimeFeesUsd: number;
  positionAgeSeconds: number;
}

/**
 * Calculate Impermanent Loss
 * IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
 * where priceRatio = currentPrice / depositPrice
 */
export function calculateImpermanentLoss(
  depositPriceRatio: number,
  currentPriceRatio: number
): number {
  if (depositPriceRatio <= 0 || currentPriceRatio <= 0) return 0;

  const priceChange = currentPriceRatio / depositPriceRatio;
  const sqrtPriceChange = Math.sqrt(priceChange);

  // IL formula: 2 * sqrt(k) / (1 + k) - 1
  const ilFactor = (2 * sqrtPriceChange) / (1 + priceChange) - 1;

  return ilFactor * 100; // Return as percentage
}

/**
 * Calculate APR from fees
 */
export function calculateFeesApr(
  lifetimeFeesUsd: number,
  positionValueUsd: number,
  positionAgeSeconds: number
): { apr: number; dailyUsd: number; yearlyUsd: number } {
  if (positionValueUsd <= 0 || positionAgeSeconds <= 0) {
    return { apr: 0, dailyUsd: 0, yearlyUsd: 0 };
  }

  const daysActive = positionAgeSeconds / 86400;
  if (daysActive < 0.01) {
    return { apr: 0, dailyUsd: 0, yearlyUsd: 0 };
  }

  const dailyUsd = lifetimeFeesUsd / daysActive;
  const yearlyUsd = dailyUsd * 365;
  const apr = (yearlyUsd / positionValueUsd) * 100;

  return { apr, dailyUsd, yearlyUsd };
}

/**
 * Calculate vs HODL comparison
 * Compares LP value to just holding the initial tokens
 */
export function calculateVsHodl(
  currentLpValueUsd: number,
  initialToken0: number,
  initialToken1: number,
  currentToken0PriceUsd: number,
  currentToken1PriceUsd: number
): {
  lpValue: number;
  hodlValue: number;
  diff: number;
  diffPercent: number;
  winner: 'LP' | 'HODL' | 'TIE';
} {
  const hodlValue = initialToken0 * currentToken0PriceUsd + initialToken1 * currentToken1PriceUsd;

  const diff = currentLpValueUsd - hodlValue;
  const diffPercent = hodlValue > 0 ? (diff / hodlValue) * 100 : 0;

  let winner: 'LP' | 'HODL' | 'TIE' = 'TIE';
  if (diff > 0.01) winner = 'LP';
  else if (diff < -0.01) winner = 'HODL';

  return {
    lpValue: currentLpValueUsd,
    hodlValue,
    diff,
    diffPercent,
    winner
  };
}

/**
 * Generate rebalance suggestion for out-of-range positions
 */
export function generateRebalanceSuggestion(
  currentTick: number,
  tickLower: number,
  tickUpper: number,
  rangeStatus: 'below-range' | 'in-range' | 'above-range',
  volatilityPercent: number = 20 // Expected 7-day volatility
): {
  shouldRebalance: boolean;
  reason: string;
  suggestedLower: number;
  suggestedUpper: number;
  currentDistance: number;
} | null {
  if (rangeStatus === 'in-range') {
    return null; // No rebalance needed
  }

  const rangeWidth = tickUpper - tickLower;
  const rangeCenter = (tickLower + tickUpper) / 2;
  const distanceFromRange =
    rangeStatus === 'below-range' ? tickLower - currentTick : currentTick - tickUpper;

  // Suggest new range centered on current tick
  // Use same width as original, or adjust based on volatility
  const suggestedHalfWidth = Math.max(
    rangeWidth / 2,
    Math.abs(currentTick * (volatilityPercent / 100))
  );

  const suggestedLower = Math.round(currentTick - suggestedHalfWidth);
  const suggestedUpper = Math.round(currentTick + suggestedHalfWidth);

  const reason =
    rangeStatus === 'below-range'
      ? `Price dropped ${distanceFromRange} ticks below your range. Consider rebalancing.`
      : `Price rose ${distanceFromRange} ticks above your range. Consider rebalancing.`;

  return {
    shouldRebalance: distanceFromRange > rangeWidth * 0.1, // Suggest if >10% of range width away
    reason,
    suggestedLower,
    suggestedUpper,
    currentDistance: distanceFromRange
  };
}

/**
 * Full position analytics
 */
export function analyzePosition(input: PositionInput): PositionAnalytics {
  const positionValueUsd =
    input.token0Amount * input.moonPriceUsd + input.token1Amount * input.wmonPriceUsd;

  // Estimate initial deposit if not provided
  // For concentrated liquidity, we estimate based on range midpoint
  const estimatedInitialToken0 = input.estimatedInitialToken0 ?? input.token0Amount;
  const estimatedInitialToken1 = input.estimatedInitialToken1 ?? input.token1Amount;

  // Current price ratio (m00n/WMON)
  const currentPriceRatio = input.wmonPriceUsd > 0 ? input.moonPriceUsd / input.wmonPriceUsd : 0;

  // Deposit price ratio (estimate from range midpoint if not provided)
  const depositPriceRatio = input.depositPriceRatio ?? currentPriceRatio;

  // Calculate IL
  const ilPercent = calculateImpermanentLoss(depositPriceRatio, currentPriceRatio);
  const ilUsd = positionValueUsd * (Math.abs(ilPercent) / 100);

  // Calculate APR
  const { apr, dailyUsd, yearlyUsd } = calculateFeesApr(
    input.lifetimeFeesUsd,
    positionValueUsd,
    input.positionAgeSeconds
  );

  // Calculate vs HODL
  const vsHodlResult = calculateVsHodl(
    positionValueUsd + input.lifetimeFeesUsd, // Include fees in LP value
    estimatedInitialToken0,
    estimatedInitialToken1,
    input.moonPriceUsd,
    input.wmonPriceUsd
  );

  // Generate rebalance suggestion
  const rebalanceSuggestion = generateRebalanceSuggestion(
    input.currentTick,
    input.tickLower,
    input.tickUpper,
    input.rangeStatus
  );

  return {
    impermanentLoss: {
      percentage: ilPercent,
      usdAmount: ilUsd,
      description:
        ilPercent < 0 ? `${Math.abs(ilPercent).toFixed(2)}% IL (~$${ilUsd.toFixed(2)})` : 'No IL'
    },
    feesApr: {
      percentage: apr,
      projectedYearlyUsd: yearlyUsd,
      dailyUsd
    },
    vsHodl: {
      lpValueUsd: vsHodlResult.lpValue,
      hodlValueUsd: vsHodlResult.hodlValue,
      differenceUsd: vsHodlResult.diff,
      differencePercent: vsHodlResult.diffPercent,
      winner: vsHodlResult.winner
    },
    rebalanceSuggestion
  };
}

/**
 * Format tick to approximate USD price
 */
export function tickToUsdPrice(tick: number, wmonPriceUsd: number): number {
  // tick = log1.0001(price), so price = 1.0001^tick
  const priceInWmon = Math.pow(1.0001, tick);
  return priceInWmon * wmonPriceUsd;
}

/**
 * Format analytics for display
 */
export function formatAnalyticsForDisplay(analytics: PositionAnalytics): {
  ilText: string;
  aprText: string;
  vsHodlText: string;
  rebalanceText: string | null;
} {
  const ilText =
    analytics.impermanentLoss.percentage < 0
      ? `📉 ${Math.abs(analytics.impermanentLoss.percentage).toFixed(1)}% IL`
      : '✅ No IL';

  const aprText =
    analytics.feesApr.percentage > 0 ? `📈 ${analytics.feesApr.percentage.toFixed(1)}% APR` : '—';

  const vsHodlText =
    analytics.vsHodl.winner === 'LP'
      ? `✅ +$${analytics.vsHodl.differenceUsd.toFixed(2)} vs HODL`
      : analytics.vsHodl.winner === 'HODL'
        ? `📉 -$${Math.abs(analytics.vsHodl.differenceUsd).toFixed(2)} vs HODL`
        : '➖ Even with HODL';

  const rebalanceText = analytics.rebalanceSuggestion?.shouldRebalance
    ? `⚠️ Consider rebalancing to ${analytics.rebalanceSuggestion.suggestedLower} → ${analytics.rebalanceSuggestion.suggestedUpper}`
    : null;

  return { ilText, aprText, vsHodlText, rebalanceText };
}
