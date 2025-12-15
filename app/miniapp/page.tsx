'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import Image from 'next/image';
import sdk from '@farcaster/miniapp-sdk';
import { useRouter, useSearchParams } from 'next/navigation';
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiConfig, createConfig, http } from 'wagmi';
import { farcasterMiniApp as miniAppConnector } from '@farcaster/miniapp-wagmi-connector';
import { getTierByReplyCount } from '@/app/lib/tiers';
import { getPersonaCopy, type PersonaActionId, type LpStatus } from '@/app/copy/persona';
import M00nSolarSystem from '@/app/components/M00nSolarSystem';
import type { LpPosition as LeaderboardLpPosition } from '@/app/lib/m00nSolarSystem.types';
import {
  analyzePosition,
  formatAnalyticsForDisplay,
  type PositionInput
} from '@/app/lib/lpAnalytics';

interface UserData {
  fid: number;
  username?: string;
  displayName?: string;
  verifiedAddresses: string[];
}

interface AirdropData {
  eligible: boolean;
  amount?: string;
  replyCount?: number | null;
}

interface EngagementData {
  replyCount: number;
  isFollowing: boolean;
}

interface ViewerContext {
  fid: number;
  username?: string;
  displayName?: string;
}

type ScanPhase = 'idle' | 'authenticating' | 'addresses' | 'fetching' | 'ready' | 'error';

const TOKEN_ADDRESS = '0x22cd99ec337a2811f594340a4a6e41e4a3022b07';
const WMON_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const POSITION_MANAGER_ADDRESS = '0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016';
const CLAIM_URL =
  'https://clanker.onchain.cooking/?token=0x22cd99ec337a2811f594340a4a6e41e4a3022b07&risk=warn&riskTag=Warning';
const CLAIM_UNLOCK_TIMESTAMP_MS = 1764272894 * 1000;
const LP_GATE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_LP_GATE === 'true';
const LP_HELP_PATH = '/lp-advanced/help';
const ADMIN_FID = 9933;
const STICKER_EMOJIS = ['🌙', '💜', '🕸️', '🦇', '☠️', '✨', '🧬', '🛸', '🩸', '💾'];
const STICKER_COLORS = ['#6ce5b1', '#8c54ff', '#ff9b54', '#5ea3ff', '#f7e6ff'];
const HOLDER_CHAT_URL =
  process.env.NEXT_PUBLIC_HOLDER_CHAT_URL ?? 'https://warpcast.com/~/channel/m00n';
const HEAVEN_MODE_URL = process.env.NEXT_PUBLIC_HEAVEN_URL ?? 'https://warpcast.com/~/channel/m00n';
const MOONLANDER_URL = 'https://farcaster.xyz/miniapps/xXgsbdvvhOB7/m00nlander';
const CHAIN_CAIP = 'eip155:143';
const MON_NATIVE_CAIP = `${CHAIN_CAIP}/native`;
const WMON_CAIP = `${CHAIN_CAIP}/erc20:${WMON_ADDRESS.toLowerCase()}`;
const MOON_CAIP = `${CHAIN_CAIP}/erc20:${TOKEN_ADDRESS.toLowerCase()}`;
const MOON_EMOJI_THRESHOLD_WEI = parseUnits('1000000', 18);
const MANIFESTO_LINES = [
  'All that you touch',
  'And all that you see',
  'All that you taste',
  'All you feel',
  'And all that you love',
  'And all that you hate',
  'All you distrust',
  'All you save',
  'And all that you give',
  'And all that you deal',
  'And all that you buy',
  'Beg, borrow or steal',
  'And all you create',
  'And all you destroy',
  'And all that you do',
  'And all that you say',
  'And all that you eat',
  'And everyone you meet',
  'And all that you slight',
  'And everyone you fight',
  'And all that is now',
  'And all that is gone',
  "And all that's to come",
  'And everything under the sun is in tune',
  'But the sun is eclipsed by the moon'
] as const;
type MoonPhase = {
  label: string;
  emoji: string;
  threshold: number;
};
const MOON_PHASES: MoonPhase[] = [
  { label: 'New Moon', emoji: '🌑', threshold: 0 },
  { label: 'Waxing Crescent', emoji: '🌒', threshold: 0.15 },
  { label: 'First Quarter', emoji: '🌓', threshold: 0.35 },
  { label: 'Waxing Gibbous', emoji: '🌔', threshold: 0.6 },
  { label: 'Full Moon', emoji: '🌕', threshold: 0.85 }
];
const truncateAddress = (value?: string | null) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : null;

const formatAmountDisplay = (value?: string) => {
  if (!value) return '0';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  if (parsed >= 1000) {
    return parsed.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (parsed >= 1) {
    return parsed.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 6 });
};

const formatCompactNumber = (value?: number | null) => {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const fractionDigits = abs >= 1000 ? 1 : 2;
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: fractionDigits
  }).format(value);
};

const formatTokenDisplay = (token?: TokenBreakdown) => {
  if (!token) return '0';
  const amount = formatAmountDisplay(token.amountFormatted);
  const symbol = token.symbol ?? 'token';
  return `${amount} ${symbol}`;
};

const formatUsd = (value?: number | null) => {
  if (!Number.isFinite(value ?? NaN)) return '$0';
  const abs = Math.abs(value ?? 0);
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: abs >= 1000 ? 0 : 2
  });
  return formatter.format(value ?? 0);
};

// Format very small prices (like m00n) without scientific notation
// e.g. 0.0000000123 -> "0.0₈123" or "$0.00000001"
const formatSmallPrice = (value?: number | null): string => {
  if (!Number.isFinite(value ?? NaN) || value === 0) return '$0';
  const num = value ?? 0;

  // If it's a normal-sized number, use regular formatting
  if (num >= 0.01) {
    return `$${num.toFixed(4)}`;
  }

  // For very small numbers, count leading zeros after decimal
  const str = num.toFixed(20); // High precision
  const match = str.match(/^0\.(0*)(\d+)/);

  if (!match) return `$${num.toFixed(8)}`;

  const leadingZeros = match[1].length;
  const significantDigits = match[2].slice(0, 4); // Keep 4 significant digits

  // Format with subscript notation: $0.0₈123 means 0.00000000123
  if (leadingZeros >= 4) {
    // Subscript numbers: ₀₁₂₃₄₅₆₇₈₉
    const subscripts = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
    const subscriptZeros = String(leadingZeros)
      .split('')
      .map((d) => subscripts[parseInt(d)])
      .join('');
    return `$0.0${subscriptZeros}${significantDigits}`;
  }

  // For 1-3 leading zeros, just show them
  return `$0.${'0'.repeat(leadingZeros)}${significantDigits}`;
};

const LP_PRESET_CONTENT: Record<
  LpClaimPreset,
  {
    title: string;
    description: string;
    amountLabel: string;
    inputToken: 'WMON' | 'm00n';
    helper: string;
    quickAmounts: string[];
  }
> = {
  backstop: {
    title: 'Crash Backstop',
    description:
      'Deploy a WMON-only crash band that tracks current price down to roughly −10%. If price nukes, it auto-buys m00n.',
    amountLabel: 'Amount (WMON)',
    inputToken: 'WMON',
    helper: 'Approx ticks: current tick down to current tick −10%.',
    quickAmounts: ['69', '1000', '4200']
  },
  moon_upside: {
    title: 'Sky Ladder',
    description:
      'Deploy a holder-only, single-sided m00n band starting ~1.2× spot and stretching to ~5×. Pumps recycle m00n into WMON.',
    amountLabel: 'Amount (m00n)',
    inputToken: 'm00n',
    helper: 'Approx ticks: current +20% up to +400% (snapped to spacing).',
    quickAmounts: ['50000', '1000000', '500000000']
  }
};

const describeBandTypeLabel = (bandType?: LpPosition['bandType']) => {
  switch (bandType) {
    case 'crash_band':
      return 'Crash band (WMON-heavy, hedging downside)';
    case 'upside_band':
      return 'Sky band (m00n-heavy, betting on upside)';
    case 'double_sided':
      return 'Double-sided (balanced, earning fees both ways)';
    case 'in_range':
      return 'Active band (earning fees)';
    default:
      return 'Custom band';
  }
};

const abbreviateUsd = (value: number) => {
  if (!Number.isFinite(value)) return '–';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}b`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
};

const formatMarketCapRange = (
  priceLowerInToken1?: string,
  priceUpperInToken1?: string,
  supply?: number,
  wmonUsdPrice?: number | null
) => {
  if (
    !priceLowerInToken1 ||
    !priceUpperInToken1 ||
    !supply ||
    !wmonUsdPrice ||
    !Number.isFinite(supply) ||
    !Number.isFinite(wmonUsdPrice)
  ) {
    return '–';
  }
  const lowerPrice = Number(priceLowerInToken1);
  const upperPrice = Number(priceUpperInToken1);
  if (!Number.isFinite(lowerPrice) || !Number.isFinite(upperPrice)) return '–';
  const lowerUsd = lowerPrice * wmonUsdPrice * supply;
  const upperUsd = upperPrice * wmonUsdPrice * supply;
  return `${abbreviateUsd(lowerUsd)}–${abbreviateUsd(upperUsd)}`;
};
type UserPersona =
  | 'claimed_sold'
  | 'claimed_held'
  | 'claimed_bought_more'
  | 'lp_gate'
  | 'eligible_holder'
  | 'locked_out'
  | 'emoji_chat';
type AdminPortalView = 'default' | UserPersona | 'advanced_lp';

interface TokenBreakdown {
  address: string;
  symbol?: string;
  label?: string;
  decimals?: number;
  amountWei?: string;
  amountFormatted?: string;
}

interface LpPosition {
  tokenId: string;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  poolKey?: {
    currency0: string;
    currency1: string;
    fee: number;
    hooks: string;
  };
  currentTick?: number;
  sqrtPriceX96?: string;
  rangeStatus?: 'below-range' | 'in-range' | 'above-range';
  bandType?: 'crash_band' | 'upside_band' | 'double_sided' | 'in_range';
  token0?: TokenBreakdown;
  token1?: TokenBreakdown;
  priceLowerInToken1?: string;
  priceUpperInToken1?: string;
  createdAtTimestamp?: number; // Unix timestamp when position was created
  fees?: {
    token0Wei: string;
    token1Wei: string;
    token0Formatted: string;
    token1Formatted: string;
    unclaimedUsd?: number | null;
    lifetimeUsd?: number | null;
  };
  feesStatus?: 'idle' | 'loading' | 'loaded' | 'error';
  feesError?: string | null;
  collectStatus?: 'idle' | 'loading' | 'error';
  compoundStatus?: 'idle' | 'checking' | 'collecting' | 'increasing' | 'success' | 'error';
  compoundStep?: string;
  collectError?: string | null;
  removeStatus?: 'idle' | 'loading' | 'success' | 'error';
  removeError?: string | null;
}

interface LeaderboardEntry {
  tokenId: string;
  owner: string;
  valueUsd: number;
  bandType: LpPosition['bandType'];
  label?: string | null;
}

interface LeaderboardResponse {
  updatedAt: string;
  moonPriceUsd: number | null;
  wmonPriceUsd: number | null;
  crashBand: LeaderboardEntry[];
  upsideBand: LeaderboardEntry[];
  mixedBand: LeaderboardEntry[];
  overall: LeaderboardEntry[];
}

// Streak leaderboard types
interface StreakLeaderboardEntry {
  tokenId: string;
  owner: string;
  label?: string | null;
  currentStreakDuration: number;
  longestStreakDuration: number;
  isCurrentlyInRange: boolean;
  points: number;
  valueUsd?: number;
  rank?: number;
}

interface StreakLeaderboardResponse {
  updatedAt: string;
  lastCheckAt: string;
  totalPositionsTracked: number;
  entries: StreakLeaderboardEntry[]; // All entries
  topStreaks: StreakLeaderboardEntry[];
  topAllTime: StreakLeaderboardEntry[];
  topPoints: StreakLeaderboardEntry[];
}

// Tokenomics types
interface TokenomicsAllocation {
  key: string;
  name: string;
  emoji: string;
  percentOfTotal: number;
  tokens: number;
  formattedTokens: string;
  description: string;
}

interface TokenomicsUserAllocation {
  address: string;
  positionCount: number;
  totalPoints: number;
  formattedPoints: string;
  pointsBreakdown?: {
    notionalPoints: number;
    streakPoints: number;
    timePoints: number;
  };
  formattedPointsBreakdown?: {
    notional: string;
    streak: string;
    time: string;
  };
  totalNotionalUsd?: number;
  formattedNotionalUsd?: string;
  bestStreakDays?: number;
  totalHoursInRange?: number;
  tier?: {
    name: string;
    multiplier: number;
    emoji: string;
  };
  estimatedLpMining?: number;
  formattedEstimatedLpMining?: string;
  shareOfPool?: string;
  rank?: number;
  totalRanked?: number;
  percentile?: string;
  message?: string;
  seasonId?: string;
}

interface TokenomicsSeason {
  id: string;
  name: string;
  number: number;
  status: string;
  startDate: string;
  endDate: string | null;
  lpMiningPool: number;
  formattedLpMiningPool: string;
  streakRewardsPool: number;
  formattedStreakRewardsPool: string;
  isCurrent?: boolean;
}

interface TokenomicsResponse {
  totalAllocationPercent: number;
  totalAllocatedTokens: number;
  totalSystemPoints: number;
  totalParticipants: number;
  formattedAllocations: TokenomicsAllocation[];
  seasons: TokenomicsSeason[];
  currentSeason: TokenomicsSeason | null;
  pointsWeights: {
    notionalUsd: { weight: number; description: string };
    streakDays: { weight: number; description: string };
    timeInRangeHours: { weight: number; description: string };
  };
  userAllocation?: TokenomicsUserAllocation;
  topEarners?: {
    rank: number;
    label: string;
    points: number;
    formattedPoints: string;
    estimatedAllocation: string;
    tier?: { name: string; emoji: string };
  }[];
  topWhales?: {
    rank: number;
    label: string;
    valueUsd: number;
    formattedValueUsd: string;
  }[];
}

interface LpGateState {
  lpStatus: LpStatus;
  walletAddress?: string | null;
  lpPositions?: LpPosition[];
  hasLpFromOnchain?: boolean;
  hasLpFromSubgraph?: boolean;
  indexerPositionCount?: number;
  poolCurrentTick?: number;
  poolSqrtPriceX96?: string;
  poolWmonUsdPrice?: number | null;
  token0TotalSupply?: number;
  token0CirculatingSupply?: number;
}

type CsvPersonaHint = 'claimed_sold' | 'claimed_held' | 'claimed_bought_more' | 'emoji_chat';

interface CsvPersonaRecord {
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

type PersonaBadge = 'moon_boy' | 'keeper' | 'believer' | 'newcomer' | 'fader';

const PERSONA_BADGE_COPY: Record<PersonaBadge, { label: string; description: string }> = {
  moon_boy: {
    label: 'Moon Boy',
    description: 'Sky band loyalist — claimed and held their m00n allocation.'
  },
  keeper: {
    label: 'Keeper',
    description: 'Crash band sentinel — claimed and bought more to defend the floor.'
  },
  believer: {
    label: 'Believer',
    description: 'Didn’t receive a claim but bought m00n on secondary to join the cabal.'
  },
  newcomer: {
    label: 'Newcomer',
    description: 'Freshly synced wallet with the required m00n balance for deck access.'
  },
  fader: {
    label: 'Fader',
    description: 'Listed in NautyNice with 0 m00n balance remaining.'
  }
};

interface PersonaApiResponse {
  found: boolean;
  personaHint?: CsvPersonaHint | null;
  record?: CsvPersonaRecord | null;
}

type LpClaimPreset = 'backstop' | 'moon_upside';
interface ReplyGlow {
  color: string;
  shadow: string;
}

const getReplyGlowConfig = (count: number): ReplyGlow => {
  if (count > 200) {
    return { color: '#ff9b54', shadow: 'rgba(255, 155, 84, 0.55)' };
  }
  if (count > 100) {
    return { color: '#8c54ff', shadow: 'rgba(140, 84, 255, 0.55)' };
  }
  if (count > 50) {
    return { color: '#5ea3ff', shadow: 'rgba(94, 163, 255, 0.6)' };
  }
  if (count > 1) {
    return { color: '#6ce5b1', shadow: 'rgba(108, 229, 177, 0.55)' };
  }
  return { color: '#8c54ff', shadow: 'rgba(140, 84, 255, 0.25)' };
};

const SHARE_URL = 'https://m00nad.vercel.app/miniapp';

const monadChain = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? 'https://rpc.monad.xyz']
    }
  },
  blockExplorers: {
    default: {
      name: 'Monadscan',
      url: 'https://monadscan.com'
    }
  }
};

const wagmiConfig = createConfig({
  chains: [monadChain],
  connectors: [miniAppConnector()],
  transports: {
    [monadChain.id]: http(monadChain.rpcUrls.default.http[0]!)
  }
});

const queryClient = new QueryClient();

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;

const permit2Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' }
    ],
    outputs: []
  }
] as const;

function MiniAppPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [isMiniApp, setIsMiniApp] = useState<boolean | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [airdropData, setAirdropData] = useState<AirdropData | null>(null);
  const [engagementData, setEngagementData] = useState<EngagementData | null>(null);
  const [showLootReveal, setShowLootReveal] = useState(false);
  const [primaryAddress, setPrimaryAddress] = useState<string | null>(null);
  const [miniWalletAddress, setMiniWalletAddress] = useState<string | null>(null);
  const [dropAddress, setDropAddress] = useState<string | null>(null);
  const [viewerContext, setViewerContext] = useState<ViewerContext | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [copiedContract, setCopiedContract] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [lpGateState, setLpGateState] = useState<LpGateState>({ lpStatus: 'DISCONNECTED' });
  const [lpPortalMode, setLpPortalMode] = useState<'closed' | 'gate' | 'lounge'>('closed');
  const [lpRefreshNonce, setLpRefreshNonce] = useState(0);
  const [adminPortalView, setAdminPortalView] = useState<AdminPortalView>('default');
  const [hasZeroPoints, setHasZeroPoints] = useState(false);
  const [timeUntilClaimMs, setTimeUntilClaimMs] = useState(() =>
    Math.max(CLAIM_UNLOCK_TIMESTAMP_MS - Date.now(), 0)
  );
  const [isLpClaimModalOpen, setIsLpClaimModalOpen] = useState(false);
  const [isObservationDeckOpen, setIsObservationDeckOpen] = useState(false);
  const [lpClaimAmount, setLpClaimAmount] = useState('');
  const [lpClaimPreset, setLpClaimPreset] = useState<LpClaimPreset>('backstop');
  const [isSubmittingLpClaim, setIsSubmittingLpClaim] = useState(false);
  const [lpClaimError, setLpClaimError] = useState<string | null>(null);
  const [lpDebugLog, setLpDebugLog] = useState<string>('');
  const [wmonBalanceWei, setWmonBalanceWei] = useState<bigint | null>(null);
  const [wmonAllowanceWei, setWmonAllowanceWei] = useState<bigint | null>(null);
  const [moonBalanceWei, setMoonBalanceWei] = useState<bigint | null>(null);
  const [moonAllowanceWei, setMoonAllowanceWei] = useState<bigint | null>(null);
  const [fundingStatus, setFundingStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fundingRefreshNonce, setFundingRefreshNonce] = useState(0);
  const [swapInFlight, setSwapInFlight] = useState<'wmon' | 'moon' | null>(null);
  const [toast, setToast] = useState<{
    kind: 'info' | 'success' | 'error';
    message: string;
  } | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState({ wmon: 18, moon: 18 });
  const [personaRecord, setPersonaRecord] = useState<CsvPersonaRecord | null>(null);
  const [personaHint, setPersonaHint] = useState<CsvPersonaHint | null>(null);
  const [personaLookupStatus, setPersonaLookupStatus] = useState<
    'idle' | 'loading' | 'error' | 'loaded'
  >('idle');
  const [primaryAddressMoonBalanceWei, setPrimaryAddressMoonBalanceWei] = useState<bigint | null>(
    null
  );
  const [balanceProbeAddress, setBalanceProbeAddress] = useState<string | null>(null);
  const [primaryBalanceStatus, setPrimaryBalanceStatus] = useState<
    'idle' | 'loading' | 'error' | 'loaded'
  >('idle');
  const [lpParamHandled, setLpParamHandled] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardResponse | null>(null);

  // Tab navigation state
  type AppTab = 'home' | 'lp' | 'rewards' | 'advanced';
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [leaderboardStatus, setLeaderboardStatus] = useState<
    'idle' | 'loading' | 'error' | 'loaded'
  >('idle');
  const [leaderboardRefreshNonce, setLeaderboardRefreshNonce] = useState(0);
  const [streakLeaderboardData, setStreakLeaderboardData] =
    useState<StreakLeaderboardResponse | null>(null);
  const [streakLeaderboardStatus, setStreakLeaderboardStatus] = useState<
    'idle' | 'loading' | 'error' | 'loaded'
  >('idle');
  const [streakLeaderboardRefreshNonce, setStreakLeaderboardRefreshNonce] = useState(0);
  const [yapMultiplier, setYapMultiplier] = useState<{
    multiplier: number;
    tier: string;
    castCount: number;
  } | null>(null);

  // Daily Check-In bonus state
  const [checkInData, setCheckInData] = useState<{
    currentStreak: number;
    longestStreak?: number;
    totalCheckIns: number;
    multiplier: number;
    multiplierTier: string;
    canCheckIn: boolean;
    nextAvailableAt?: number;
    hoursUntilAvailable?: number;
  } | null>(null);
  const [checkInStatus, setCheckInStatus] = useState<'idle' | 'loading' | 'checking_in'>('idle');
  const [checkInMessage, setCheckInMessage] = useState<string | null>(null);

  // App Added bonus state
  const [appAddedData, setAppAddedData] = useState<{
    added: boolean;
    addedAt?: number;
    multiplier: number;
  } | null>(null);
  const [appAddedStatus, setAppAddedStatus] = useState<'idle' | 'loading' | 'adding'>('idle');

  // House (Ascension/Burn Tier) state
  const [houseTier, setHouseTier] = useState<{
    tier: string;
    name: string;
    emoji: string;
    harvestMultiplier: number;
    totalBurnedFormatted: string;
    nextTier?: {
      tier: { name: string; burnRequiredFormatted: string };
      burnNeededFormatted: string;
    };
  } | null>(null);

  // Referral state
  const [referralData, setReferralData] = useState<{
    referralCode: string;
    referralLink: string;
    directReferrals: number;
    totalReferralPoints: number;
    referredBy?: number;
  } | null>(null);

  // Harvest stats state
  const [harvestStats, setHarvestStats] = useState<{
    totalHarvests: number;
    totalPoints: number;
    currentWeekPoints: number;
  } | null>(null);

  // Burn state
  const [burnStatus, setBurnStatus] = useState<'idle' | 'approving' | 'burning' | 'recording'>(
    'idle'
  );
  const [showBurnModal, setShowBurnModal] = useState(false);
  const [burnAmount, setBurnAmount] = useState<string>('');

  const [tokenomicsData, setTokenomicsData] = useState<TokenomicsResponse | null>(null);
  const [tokenomicsStatus, setTokenomicsStatus] = useState<'idle' | 'loading' | 'error' | 'loaded'>(
    'idle'
  );
  const [solarSystemData, setSolarSystemData] = useState<{
    positions: LeaderboardLpPosition[];
    updatedAt: string;
    limit?: number;
  } | null>(null);
  const [solarSystemStatus, setSolarSystemStatus] = useState<
    'idle' | 'loading' | 'error' | 'loaded' | 'empty'
  >('idle');
  const [solarCanvasSize, setSolarCanvasSize] = useState(420);
  const [isAdminPanelCollapsed, setIsAdminPanelCollapsed] = useState(false);
  const [isSigilManagerVisible, setIsSigilManagerVisible] = useState(false);
  const [preferredBand, setPreferredBand] = useState<'crash_band' | 'upside_band' | null>(null);

  // Position alerts state - track state changes since last visit
  interface PositionAlert {
    tokenId: string;
    type: 'went_out_of_range' | 'back_in_range' | 'sky_band_complete' | 'crash_band_complete';
    message: string;
  }
  const [positionAlerts, setPositionAlerts] = useState<PositionAlert[]>([]);
  const [alertsDismissed, setAlertsDismissed] = useState(false);
  const [solarSystemRefreshNonce, setSolarSystemRefreshNonce] = useState(0);
  const [expandedLeaderboards, setExpandedLeaderboards] = useState<Record<string, boolean>>({});
  const viewerAddressLabels = useMemo(() => {
    const pool = new Set<string>();
    const candidates = [miniWalletAddress, primaryAddress, dropAddress, ...addresses];
    candidates.forEach((address) => {
      if (address) {
        pool.add(address.toLowerCase());
      }
    });
    return pool;
  }, [addresses, dropAddress, miniWalletAddress, primaryAddress]);

  const viewerLabel =
    viewerContext?.username ?? viewerContext?.displayName ?? personaRecord?.username ?? null;

  const personalizedSolarPositions = useMemo(() => {
    if (!solarSystemData?.positions) return null;
    if (!viewerLabel || viewerAddressLabels.size === 0) {
      return solarSystemData.positions;
    }
    return solarSystemData.positions.map((position) => {
      if (viewerAddressLabels.has(position.owner.toLowerCase())) {
        return {
          ...position,
          label: viewerLabel
        };
      }
      return position;
    });
  }, [solarSystemData?.positions, viewerAddressLabels, viewerLabel]);

  const activeSolarPositions = useMemo(() => {
    if (solarSystemStatus !== 'loaded') return [];
    return personalizedSolarPositions ?? solarSystemData?.positions ?? [];
  }, [personalizedSolarPositions, solarSystemData?.positions, solarSystemStatus]);

  const totalSolarNotionalUsd = useMemo(() => {
    if (!activeSolarPositions.length) return null;
    return activeSolarPositions.reduce(
      (acc, position) => acc + Math.max(position.notionalUsd ?? 0, 0),
      0
    );
  }, [activeSolarPositions]);

  const handleLpAmountChange = useCallback((rawValue: string) => {
    const stripped = rawValue.replace(/[^\d.,]/g, '');
    const normalized = stripped.replace(/,/g, '.');
    setLpClaimAmount(normalized);
  }, []);

  const hasAnyLp = useMemo(
    () => (lpGateState.lpPositions?.length ?? 0) > 0,
    [lpGateState.lpPositions]
  );
  const hasLpNft = lpGateState.lpStatus === 'HAS_LP' || hasAnyLp;
  const crashBandCount = useMemo(
    () =>
      (lpGateState.lpPositions ?? []).filter((position) => position.bandType === 'crash_band')
        .length,
    [lpGateState.lpPositions]
  );
  const skyBandCount = useMemo(
    () =>
      (lpGateState.lpPositions ?? []).filter((position) => position.bandType === 'upside_band')
        .length,
    [lpGateState.lpPositions]
  );
  const hasCrashBand = crashBandCount > 0;
  const hasSkyBand = skyBandCount > 0;
  const showToast = useCallback((kind: 'info' | 'success' | 'error', message: string) => {
    setToast({ kind, message });
  }, []);

  const refreshLeaderboard = useCallback(() => {
    setLeaderboardRefreshNonce((nonce) => nonce + 1);
  }, []);

  const refreshStreakLeaderboard = useCallback(() => {
    setStreakLeaderboardRefreshNonce((nonce) => nonce + 1);
  }, []);

  const refreshSolarTelemetry = useCallback(() => {
    setSolarSystemRefreshNonce((nonce) => nonce + 1);
  }, []);

  const refreshPersonalSigils = useCallback(() => {
    setLpRefreshNonce((nonce) => nonce + 1);
  }, []);

  const handleRefreshTelemetry = useCallback(() => {
    refreshSolarTelemetry();
    refreshLeaderboard();
  }, [refreshLeaderboard, refreshSolarTelemetry]);

  // Handle daily check-in
  const handleDailyCheckIn = useCallback(async () => {
    const fid = userData?.fid;
    const username = viewerContext?.username;
    if (!fid || !username) return;

    setCheckInStatus('checking_in');
    setCheckInMessage(null);

    try {
      const response = await fetch('/api/daily-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'checkin',
          fid,
          username,
          address: miniWalletAddress ?? undefined
        })
      });

      const data = await response.json();

      if (data.success) {
        setCheckInData({
          currentStreak: data.currentStreak,
          longestStreak: data.longestStreak,
          totalCheckIns: data.totalCheckIns,
          multiplier: data.multiplier,
          multiplierTier: data.multiplierTier,
          canCheckIn: false,
          nextAvailableAt: data.nextAvailableAt,
          hoursUntilAvailable: 24
        });
        setCheckInMessage(data.reward?.message ?? data.message);
        showToast('success', data.message);
      } else {
        setCheckInMessage(data.message);
        showToast('info', data.message);
      }
    } catch (err) {
      console.error('Check-in failed:', err);
      showToast('error', 'Check-in failed. Try again!');
    } finally {
      setCheckInStatus('idle');
    }
  }, [userData?.fid, viewerContext?.username, miniWalletAddress, showToast]);

  // Handle add app
  const handleAddApp = useCallback(async () => {
    const fid = userData?.fid;
    const username = viewerContext?.username;
    if (!fid || !username) return;

    setAppAddedStatus('adding');

    try {
      // Call the Farcaster SDK to add the mini app
      await sdk.actions.addMiniApp();

      // Record that user added the app
      const response = await fetch('/api/app-bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fid,
          username,
          address: miniWalletAddress ?? undefined
        })
      });

      const data = await response.json();

      if (data.success) {
        setAppAddedData({
          added: true,
          addedAt: data.addedAt,
          multiplier: data.multiplier
        });
        showToast('success', '🎉 App added! +10% permanent bonus unlocked.');
      }
    } catch (err) {
      console.warn('Add app failed:', err);
      // User might have cancelled or already added - check status anyway
      try {
        const response = await fetch(`/api/app-bonus?fid=${fid}`);
        const data = await response.json();
        if (data.added) {
          setAppAddedData({
            added: true,
            addedAt: data.addedAt,
            multiplier: data.multiplier
          });
        }
      } catch {
        // Ignore
      }
    } finally {
      setAppAddedStatus('idle');
    }
  }, [userData?.fid, viewerContext?.username, miniWalletAddress, showToast]);

  // Refresh check-in status
  const refreshCheckInStatus = useCallback(async () => {
    const fid = userData?.fid;
    if (!fid) return;

    try {
      const response = await fetch(`/api/daily-checkin?fid=${fid}`);
      if (!response.ok) return;
      const data = await response.json();
      setCheckInData({
        currentStreak: data.currentStreak ?? 0,
        longestStreak: data.longestStreak ?? 0,
        totalCheckIns: data.totalCheckIns ?? 0,
        multiplier: data.multiplier ?? 1,
        multiplierTier: data.multiplierTier ?? '—',
        canCheckIn: data.canCheckIn ?? true,
        nextAvailableAt: data.nextAvailableAt,
        hoursUntilAvailable: data.hoursUntilAvailable
      });
    } catch (err) {
      console.warn('Failed to refresh check-in status', err);
    }
  }, [userData?.fid]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Fetch leaderboard - only when on rewards tab (lazy load to save API calls)
  useEffect(() => {
    if (activeTab !== 'rewards') return;
    if (leaderboardStatus === 'loaded' && leaderboardRefreshNonce === 0) return; // Already loaded

    let cancelled = false;
    const loadLeaderboard = async () => {
      setLeaderboardStatus('loading');
      try {
        const response = await fetch('/api/lp-leaderboard');
        if (!response.ok) {
          throw new Error('leaderboard_failed');
        }
        const data = (await response.json()) as LeaderboardResponse;
        if (!cancelled) {
          setLeaderboardData(data);
          setLeaderboardStatus('loaded');
        }
      } catch (err) {
        console.error('Failed to load leaderboard', err);
        if (!cancelled) {
          setLeaderboardStatus('error');
        }
      }
    };
    loadLeaderboard();
    return () => {
      cancelled = true;
    };
  }, [leaderboardRefreshNonce, activeTab]);

  // Fetch streak leaderboard - only when on rewards tab
  useEffect(() => {
    if (activeTab !== 'rewards') return;
    if (streakLeaderboardStatus === 'loaded' && streakLeaderboardRefreshNonce === 0) return;

    let cancelled = false;
    const loadStreakLeaderboard = async () => {
      setStreakLeaderboardStatus('loading');
      try {
        const response = await fetch('/api/lp-streak-leaderboard');
        if (!response.ok) {
          throw new Error('streak_leaderboard_failed');
        }
        const data = (await response.json()) as StreakLeaderboardResponse;
        if (!cancelled) {
          setStreakLeaderboardData(data);
          setStreakLeaderboardStatus('loaded');
        }
      } catch (err) {
        console.error('Failed to load streak leaderboard', err);
        if (!cancelled) {
          setStreakLeaderboardStatus('error');
        }
      }
    };
    loadStreakLeaderboard();
    return () => {
      cancelled = true;
    };
  }, [streakLeaderboardRefreshNonce, activeTab]);

  // Fetch tokenomics data - only when on rewards tab or home tab
  useEffect(() => {
    const walletAddress = lpGateState.walletAddress;
    if (!walletAddress) return;
    if (activeTab !== 'rewards' && activeTab !== 'home') return;
    if (tokenomicsStatus === 'loaded') return; // Already loaded

    let cancelled = false;
    const loadTokenomics = async () => {
      setTokenomicsStatus('loading');
      try {
        const response = await fetch(`/api/tokenomics?address=${walletAddress}`);
        if (!response.ok) {
          throw new Error('tokenomics_failed');
        }
        const data = (await response.json()) as TokenomicsResponse;
        if (!cancelled) {
          setTokenomicsData(data);
          setTokenomicsStatus('loaded');
        }
      } catch (err) {
        console.error('Failed to load tokenomics', err);
        if (!cancelled) {
          setTokenomicsStatus('error');
        }
      }
    };
    loadTokenomics();
    return () => {
      cancelled = true;
    };
  }, [lpGateState.walletAddress, activeTab]);

  // Fetch yap multiplier - only when on rewards tab to save API calls
  useEffect(() => {
    const fid = userData?.fid;
    if (!fid) {
      setYapMultiplier(null);
      return;
    }
    // Only fetch when on rewards tab
    if (activeTab !== 'rewards') return;
    // Skip if already loaded
    if (yapMultiplier !== null) return;

    let cancelled = false;
    const loadYapMultiplier = async () => {
      try {
        // Just get the stats (skip update to save API calls)
        const response = await fetch(`/api/yap-multiplier?fid=${fid}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setYapMultiplier({
            multiplier: data.multiplier ?? 1,
            tier: data.multiplierTier ?? '—',
            castCount: data.castCount ?? 0
          });
        }
      } catch (err) {
        console.warn('Failed to load yap multiplier', err);
      }
    };
    loadYapMultiplier();
    return () => {
      cancelled = true;
    };
  }, [userData?.fid, activeTab]);

  // Fetch daily check-in data - only once per session
  // Use a ref to track if we've loaded for this fid to avoid race conditions
  const checkInLoadedForFid = useRef<number | null>(null);

  useEffect(() => {
    const fid = userData?.fid;
    if (!fid) {
      setCheckInData(null);
      checkInLoadedForFid.current = null;
      return;
    }
    // Fetch when on rewards tab
    if (activeTab !== 'rewards') return;
    // Skip if already loaded for this fid (prevents refetch after collect/compound)
    if (checkInLoadedForFid.current === fid) return;
    // Skip if currently loading
    if (checkInStatus === 'loading') return;

    let cancelled = false;
    const loadCheckInData = async () => {
      setCheckInStatus('loading');
      try {
        const response = await fetch(`/api/daily-checkin?fid=${fid}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setCheckInData({
            currentStreak: data.currentStreak ?? 0,
            longestStreak: data.longestStreak ?? 0,
            totalCheckIns: data.totalCheckIns ?? 0,
            multiplier: data.multiplier ?? 1,
            multiplierTier: data.multiplierTier ?? '—',
            canCheckIn: data.canCheckIn ?? true,
            nextAvailableAt: data.nextAvailableAt,
            hoursUntilAvailable: data.hoursUntilAvailable
          });
          checkInLoadedForFid.current = fid;
          setCheckInStatus('idle');
        }
      } catch (err) {
        console.warn('Failed to load check-in data', err);
        setCheckInStatus('idle');
      }
    };
    loadCheckInData();
    return () => {
      cancelled = true;
    };
  }, [userData?.fid, activeTab, checkInStatus]);

  // Fetch app added bonus data
  useEffect(() => {
    const fid = userData?.fid;
    if (!fid) {
      setAppAddedData(null);
      return;
    }
    // Fetch when on rewards tab
    if (activeTab !== 'rewards') return;
    // Skip if already loaded
    if (appAddedData !== null) return;

    let cancelled = false;
    const loadAppAddedData = async () => {
      setAppAddedStatus('loading');
      try {
        const response = await fetch(`/api/app-bonus?fid=${fid}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setAppAddedData({
            added: data.added ?? false,
            addedAt: data.addedAt,
            multiplier: data.multiplier ?? 1
          });
          setAppAddedStatus('idle');
        }
      } catch (err) {
        console.warn('Failed to load app added data', err);
        setAppAddedStatus('idle');
      }
    };
    loadAppAddedData();
    return () => {
      cancelled = true;
    };
  }, [userData?.fid, activeTab]);

  // Fetch house tier (ascension) data
  useEffect(() => {
    const fid = userData?.fid;
    if (!fid) {
      setHouseTier(null);
      return;
    }
    if (activeTab !== 'rewards') return;
    if (houseTier !== null) return;

    const loadHouseTier = async () => {
      try {
        const response = await fetch(`/api/ascension?fid=${fid}`);
        if (!response.ok) return;
        const data = await response.json();
        setHouseTier({
          tier: data.tier?.tier ?? 'wanderer',
          name: data.tier?.name ?? 'Wanderer',
          emoji: data.tier?.emoji ?? '◌',
          harvestMultiplier: data.tier?.harvestMultiplier ?? 1,
          totalBurnedFormatted: data.totalBurnedFormatted ?? '0',
          nextTier: data.nextTier
        });
      } catch (err) {
        console.warn('Failed to load house tier', err);
      }
    };
    loadHouseTier();
  }, [userData?.fid, activeTab, houseTier]);

  // Fetch referral data
  useEffect(() => {
    const fid = userData?.fid;
    if (!fid) {
      setReferralData(null);
      return;
    }
    if (activeTab !== 'rewards') return;
    if (referralData !== null) return;

    const loadReferralData = async () => {
      try {
        const response = await fetch(`/api/referrals?fid=${fid}`);
        if (!response.ok) return;
        const data = await response.json();
        setReferralData({
          referralCode: data.referralCode,
          referralLink: data.referralLink,
          directReferrals: data.directReferrals ?? 0,
          totalReferralPoints: data.totalReferralPoints ?? 0,
          referredBy: data.referredBy
        });
      } catch (err) {
        console.warn('Failed to load referral data', err);
      }
    };
    loadReferralData();
  }, [userData?.fid, activeTab, referralData]);

  // Fetch harvest stats
  useEffect(() => {
    const fid = userData?.fid;
    if (!fid) {
      setHarvestStats(null);
      return;
    }
    if (activeTab !== 'rewards') return;
    if (harvestStats !== null) return;

    const loadHarvestStats = async () => {
      try {
        const response = await fetch(`/api/harvest?fid=${fid}`);
        if (!response.ok) return;
        const data = await response.json();
        setHarvestStats({
          totalHarvests: data.totalHarvests ?? 0,
          totalPoints: data.totalPoints ?? 0,
          currentWeekPoints: data.currentWeekPoints ?? 0
        });
      } catch (err) {
        console.warn('Failed to load harvest stats', err);
      }
    };
    loadHarvestStats();
  }, [userData?.fid, activeTab, harvestStats]);

  useEffect(() => {
    let cancelled = false;
    const loadSolarSystem = async () => {
      setSolarSystemStatus('loading');
      try {
        const response = await fetch('/api/lp-solar-system');
        if (!response.ok) {
          throw new Error('lp_solar_system_failed');
        }
        const data = (await response.json()) as {
          positions: LeaderboardLpPosition[];
          updatedAt: string;
          limit?: number;
        };
        if (!cancelled) {
          const hasPositions = Array.isArray(data.positions) && data.positions.length > 0;
          if (hasPositions) {
            setSolarSystemData(data);
            setSolarSystemStatus('loaded');
          } else {
            setSolarSystemStatus('empty');
          }
        }
      } catch (error) {
        console.error('Solar system fetch failed', error);
        if (!cancelled) {
          setSolarSystemStatus('error');
        }
      }
    };

    // Only load solar system on explicit refresh, not automatically
    // This saves API calls - users can refresh manually if needed
    if (solarSystemRefreshNonce > 0) {
      void loadSolarSystem();
    }

    return () => {
      cancelled = true;
    };
  }, [solarSystemRefreshNonce]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const computeSize = () => {
      const widthCap = Math.min(520, window.innerWidth - 48);
      const heightAllowance = window.innerHeight - 360;
      const responsiveSize = Math.max(220, Math.min(widthCap, heightAllowance));
      setSolarCanvasSize(responsiveSize);
    };
    computeSize();
    let resizeTimeout: number | null = null;
    const handleResize = () => {
      if (resizeTimeout) {
        window.clearTimeout(resizeTimeout);
      }
      resizeTimeout = window.setTimeout(() => {
        computeSize();
      }, 100);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      if (resizeTimeout) {
        window.clearTimeout(resizeTimeout);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const formatAmount = (amount?: string | number) => {
    if (amount === undefined || amount === null) return '0';
    const numeric = typeof amount === 'string' ? parseInt(amount, 10) : amount;
    if (Number.isNaN(numeric)) return '0';
    return numeric.toLocaleString();
  };

  const isAdmin = viewerContext?.fid === ADMIN_FID;

  const classifyEligiblePersona = useCallback((amount: number, replyCount: number): UserPersona => {
    if (!Number.isFinite(amount) || amount <= 0) {
      return 'locked_out';
    }
    if (replyCount >= 20 || amount > 100000) {
      return 'claimed_bought_more';
    }
    if (replyCount >= 5) {
      return 'claimed_held';
    }
    if (replyCount >= 0) {
      return 'claimed_sold';
    }
    return 'eligible_holder';
  }, []);

  const csvPersona = useMemo<UserPersona | 'emoji_chat' | null>(() => {
    if (!personaHint) return null;
    if (
      personaHint === 'claimed_sold' ||
      personaHint === 'claimed_held' ||
      personaHint === 'claimed_bought_more' ||
      personaHint === 'emoji_chat'
    ) {
      return personaHint;
    }
    return null;
  }, [personaHint]);

  const observationDeckEligible = useMemo(() => {
    if (primaryBalanceStatus !== 'loaded') return false;
    if (!primaryAddressMoonBalanceWei) return false;
    return primaryAddressMoonBalanceWei >= MOON_EMOJI_THRESHOLD_WEI;
  }, [primaryAddressMoonBalanceWei, primaryBalanceStatus]);

  const handleCloseObservationDeck = useCallback(() => {
    setIsObservationDeckOpen(false);
    setAdminPortalView((prev) => (prev === 'emoji_chat' ? 'default' : prev));
  }, []);

  const handleAdminPortalSelect = useCallback((portalId: AdminPortalView) => {
    if (portalId === 'emoji_chat') {
      setAdminPortalView(portalId);
      setIsObservationDeckOpen(true);
      return;
    }
    setAdminPortalView(portalId);
    setIsObservationDeckOpen(false);
  }, []);

  const personaFromLpPositions = useMemo<UserPersona | null>(() => {
    if (lpGateState.lpStatus !== 'HAS_LP') {
      return null;
    }
    const positions = lpGateState.lpPositions ?? [];
    if (positions.length === 0) {
      return null;
    }
    if (positions.some((pos) => pos.bandType === 'upside_band')) {
      return 'claimed_held';
    }
    if (positions.some((pos) => pos.bandType === 'crash_band')) {
      return 'claimed_bought_more';
    }
    return 'claimed_held';
  }, [lpGateState.lpPositions, lpGateState.lpStatus]);

  const derivedPersona: UserPersona = useMemo(() => {
    if (!userData) {
      return 'locked_out';
    }
    const lpPersona =
      personaFromLpPositions &&
      ['claimed_held', 'claimed_bought_more'].includes(personaFromLpPositions)
        ? (personaFromLpPositions as UserPersona)
        : null;
    if (lpPersona) {
      return lpPersona;
    }
    if (csvPersona) {
      return csvPersona;
    }
    if (hasZeroPoints) {
      return 'locked_out';
    }
    if (airdropData?.eligible) {
      const amount = Number(airdropData.amount ?? '0');
      const replyCount = engagementData?.replyCount ?? 0;
      return classifyEligiblePersona(amount, replyCount);
    }
    if (LP_GATE_ENABLED) {
      return 'lp_gate';
    }
    return 'locked_out';
  }, [
    airdropData?.amount,
    airdropData?.eligible,
    classifyEligiblePersona,
    engagementData?.replyCount,
    hasZeroPoints,
    csvPersona,
    personaFromLpPositions,
    userData
  ]);

  const adminPersonaOverride =
    isAdmin &&
    adminPortalView !== 'default' &&
    adminPortalView !== 'emoji_chat' &&
    adminPortalView !== 'advanced_lp'
      ? adminPortalView
      : null;
  const effectivePersona: UserPersona = adminPersonaOverride ?? derivedPersona;
  const personaNeedsLpData = useMemo(
    () =>
      ['lp_gate', 'claimed_held', 'claimed_bought_more', 'emoji_chat'].includes(effectivePersona),
    [effectivePersona]
  );
  const lpScanInProgress = personaNeedsLpData && lpGateState.lpStatus === 'CHECKING';

  const personaBadge = useMemo<PersonaBadge>(() => {
    if (effectivePersona === 'claimed_bought_more') {
      return 'keeper';
    }
    if (effectivePersona === 'claimed_held') {
      return 'moon_boy';
    }
    if (effectivePersona === 'emoji_chat') {
      return 'believer';
    }
    if (effectivePersona === 'eligible_holder' || effectivePersona === 'lp_gate') {
      return 'newcomer';
    }
    if (
      personaRecord &&
      personaRecord.totalEstimatedBalance !== undefined &&
      personaRecord.totalEstimatedBalance !== null &&
      personaRecord.totalEstimatedBalance <= 0
    ) {
      return 'fader';
    }
    return 'newcomer';
  }, [effectivePersona, personaRecord]);
  const canAccessLpFeatures = personaBadge === 'moon_boy' || personaBadge === 'keeper';

  useEffect(() => {
    if (lpParamHandled) return;
    const lpParam = searchParams?.get('lp');
    if (!lpParam) return;
    setIsObservationDeckOpen(false);
    if (lpParam === 'manager' || lpParam === 'lounge') {
      setLpPortalMode(canAccessLpFeatures ? 'lounge' : 'gate');
      setLpParamHandled(true);
      return;
    }
    if (lpParam === 'gate') {
      setLpPortalMode('gate');
      setLpParamHandled(true);
    }
  }, [searchParams, canAccessLpFeatures, lpParamHandled]);

  // Handle referral parameter
  const [referralHandled, setReferralHandled] = useState(false);
  useEffect(() => {
    if (referralHandled) return;
    const refParam = searchParams?.get('ref');
    const fid = userData?.fid;
    const address = miniWalletAddress ?? primaryAddress;
    if (!refParam || !fid || !address) return;

    const referrerFid = parseInt(refParam, 10);
    if (isNaN(referrerFid) || referrerFid === fid) return;

    // Record the referral
    fetch('/api/referrals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referrerFid,
        refereeFid: fid,
        refereeUsername: userData?.username,
        refereeAddress: address
      })
    }).catch((e) => console.warn('Failed to record referral', e));

    setReferralHandled(true);
  }, [
    searchParams,
    userData?.fid,
    userData?.username,
    miniWalletAddress,
    primaryAddress,
    referralHandled
  ]);

  const handleOpenLpGate = useCallback(() => {
    setIsObservationDeckOpen(false);
    setLpPortalMode('gate');
  }, []);

  const handleOpenLpManager = useCallback(() => {
    if (!canAccessLpFeatures) return;
    setLpPortalMode('lounge');
  }, [canAccessLpFeatures]);

  const handleCloseLpPortal = useCallback(() => {
    setLpPortalMode('closed');
  }, []);

  useEffect(() => {
    const personaWantsSky =
      effectivePersona === 'claimed_held' ||
      effectivePersona === 'emoji_chat' ||
      personaHint === 'claimed_held' ||
      personaHint === 'emoji_chat';

    let nextPreferred: 'crash_band' | 'upside_band' = personaWantsSky
      ? 'upside_band'
      : 'crash_band';

    if (hasCrashBand && !hasSkyBand) {
      nextPreferred = 'crash_band';
    } else if (hasSkyBand && !hasCrashBand) {
      nextPreferred = 'upside_band';
    }

    setPreferredBand(nextPreferred);
  }, [effectivePersona, personaHint, hasCrashBand, hasSkyBand]);

  useEffect(() => {
    if (!isAdmin && adminPortalView !== 'default') {
      setAdminPortalView('default');
      return;
    }
    if (isAdmin && adminPortalView !== 'default') {
      const portalNeedsLp = ['lp_gate', 'claimed_held', 'claimed_bought_more'].includes(
        adminPortalView
      );
      if (portalNeedsLp && miniWalletAddress && lpGateState.walletAddress !== miniWalletAddress) {
        setLpGateState((prev) => {
          if (prev.walletAddress === miniWalletAddress && prev.lpStatus === 'CHECKING') {
            return prev;
          }
          return {
            ...prev,
            lpStatus: 'CHECKING',
            walletAddress: miniWalletAddress,
            lpPositions: []
          };
        });
        setLpRefreshNonce((prev) => prev + 1);
      }
    }
  }, [isAdmin, adminPortalView, miniWalletAddress, lpGateState.walletAddress]);

  useEffect(() => {
    if (!hasAnyLp && isSigilManagerVisible) {
      setIsSigilManagerVisible(false);
    }
  }, [hasAnyLp, isSigilManagerVisible]);

  useEffect(() => {
    if (!observationDeckEligible && isObservationDeckOpen) {
      setIsObservationDeckOpen(false);
    }
  }, [observationDeckEligible, isObservationDeckOpen]);

  const fallingStickers = useMemo(
    () =>
      Array.from({ length: 22 }).map((_, idx) => ({
        id: idx,
        emoji: STICKER_EMOJIS[idx % STICKER_EMOJIS.length],
        color: STICKER_COLORS[idx % STICKER_COLORS.length],
        left: Math.random() * 100,
        duration: 10 + Math.random() * 10,
        delay: Math.random() * -15,
        scale: 0.7 + Math.random() * 0.8
      })),
    []
  );

  useEffect(() => {
    const bootstrapSdk = async () => {
      try {
        const insideMiniApp = await sdk.isInMiniApp();
        setIsMiniApp(insideMiniApp);

        if (!insideMiniApp) {
          setError('Open this mini app inside Warpcast to connect your FID.');
          setIsLoading(false);
          return;
        }

        await sdk.actions.ready();
        setIsSdkReady(true);
        setIsLoading(false);

        const context = await sdk.context;
        if (context.user) {
          setViewerContext({
            fid: context.user.fid,
            username: context.user.username,
            displayName: context.user.displayName
          });

          try {
            await syncAddresses(context.user.fid);
          } catch (addressError) {
            console.error('Failed to prefetch addresses', addressError);
          }
        }
      } catch (err) {
        console.error('Failed to call sdk.actions.ready()', err);
        setError('Unable to connect to the Farcaster SDK bridge. Reload to try again.');
      }
    };

    void bootstrapSdk();
  }, []);

  // Always fetch LP data when wallet is connected (not gated by persona anymore)
  useEffect(() => {
    if (!miniWalletAddress) {
      setLpGateState({ lpStatus: 'DISCONNECTED', walletAddress: null, lpPositions: [] });
      return;
    }

    let cancelled = false;
    const walletAddress = miniWalletAddress;
    const runCheck = async () => {
      setLpGateState((prev) => {
        if (prev.walletAddress === walletAddress && prev.lpStatus === 'CHECKING') {
          return prev;
        }
        return {
          ...prev,
          lpStatus: 'CHECKING',
          walletAddress,
          lpPositions: prev.walletAddress === walletAddress ? prev.lpPositions : []
        };
      });

      try {
        console.log('LP_GATE_FETCH:start', { walletAddress });

        const response = await fetch(`/api/lp-nft?address=${walletAddress}`, {
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`LP on-chain check failed: ${response.status}`);
        }

        const data = (await response.json()) as {
          hasLpNft: boolean;
          lpPositions: LpPosition[];
          error?: string;
          hasLpFromOnchain?: boolean;
          hasLpFromSubgraph?: boolean;
          indexerPositionCount?: number;
          currentTick?: number;
          sqrtPriceX96?: string;
          wmonUsdPrice?: number | null;
          token0?: {
            symbol?: string;
            decimals?: number;
            totalSupply?: number;
            circulatingSupply?: number;
          };
        };

        if (data.error) {
          throw new Error(data.error);
        }

        if (cancelled) return;

        const lpPositions = (data.lpPositions ?? []).map((position) => ({
          ...position,
          feesStatus: position.fees ? ('loaded' as const) : ('idle' as const),
          feesError: null,
          collectStatus: 'idle' as const,
          collectError: null,
          removeStatus: 'idle' as const,
          removeError: null
        }));
        const hasLpSignal = lpPositions.length > 0 || data.hasLpNft;

        console.log('LP_GATE_FETCH:result', {
          lpData: data,
          lpPositions
        });

        setLpGateState({
          lpStatus: hasLpSignal ? 'HAS_LP' : 'NO_LP',
          walletAddress,
          lpPositions,
          hasLpFromOnchain: data.hasLpFromOnchain,
          hasLpFromSubgraph: data.hasLpFromSubgraph,
          indexerPositionCount: data.indexerPositionCount,
          poolCurrentTick: data.currentTick,
          poolSqrtPriceX96: data.sqrtPriceX96,
          poolWmonUsdPrice: data.wmonUsdPrice ?? null,
          token0TotalSupply: data.token0?.totalSupply,
          token0CirculatingSupply: data.token0?.circulatingSupply
        });
      } catch (err) {
        console.error('LP gate lookup failed', err);
        if (cancelled) return;
        setLpGateState({
          lpStatus: 'ERROR',
          walletAddress,
          lpPositions: []
        });
      }
    };

    void runCheck();

    return () => {
      cancelled = true;
    };
  }, [miniWalletAddress, lpRefreshNonce]);

  // Fetch fees for LP positions - only when on LP tab to save API calls
  useEffect(() => {
    const positions = lpGateState.lpPositions ?? [];
    // Only fetch fees when user is on LP tab and has positions
    if (positions.length === 0 || !miniWalletAddress || activeTab !== 'lp') return;
    // Skip if fees already loaded
    const alreadyLoaded = positions.some((p) => p.feesStatus === 'loaded');
    if (alreadyLoaded) return;

    let cancelled = false;

    const fetchFees = async () => {
      try {
        const resp = await fetch(`/api/lp-fees?address=${miniWalletAddress}`);
        if (!resp.ok) return;
        const data = (await resp.json()) as {
          positions?: Array<{
            tokenId: string;
            token0?: { symbol: string; amount: string };
            token1?: { symbol: string; amount: string };
            unclaimed?: {
              token0: string;
              token1: string;
              token0Wei?: string;
              token1Wei?: string;
              usd: number | null;
            };
            lifetime?: {
              token0: string;
              token1: string;
              usd: number | null;
            };
          }>;
        };
        if (cancelled || !data.positions) return;

        // Update positions with fees
        const feeMap = new Map(data.positions.map((p) => [p.tokenId, p]));
        setLpGateState((prev) => ({
          ...prev,
          lpPositions: (prev.lpPositions ?? []).map((pos) => {
            const feeInfo = feeMap.get(pos.tokenId);
            if (!feeInfo) return pos;
            return {
              ...pos,
              fees: {
                token0Wei: feeInfo.unclaimed?.token0Wei ?? '0',
                token1Wei: feeInfo.unclaimed?.token1Wei ?? '0',
                token0Formatted: feeInfo.unclaimed?.token0 ?? '0',
                token1Formatted: feeInfo.unclaimed?.token1 ?? '0',
                unclaimedUsd: feeInfo.unclaimed?.usd ?? null,
                lifetimeUsd: feeInfo.lifetime?.usd ?? null
              },
              feesStatus: 'loaded' as const
            };
          })
        }));
      } catch (err) {
        console.warn('Failed to fetch LP fees', err);
      }
    };

    void fetchFees();

    return () => {
      cancelled = true;
    };
  }, [lpGateState.lpPositions?.length, miniWalletAddress, activeTab]);

  // Position Alerts - detect state changes since last visit
  useEffect(() => {
    const positions = lpGateState.lpPositions ?? [];
    if (positions.length === 0 || alertsDismissed) return;

    const alerts: PositionAlert[] = [];
    const STORAGE_PREFIX = 'm00n_pos_state_';

    positions.forEach((pos) => {
      const storageKey = `${STORAGE_PREFIX}${pos.tokenId}`;
      const isInRange = pos.rangeStatus === 'in-range';
      const bandType = pos.bandType;

      try {
        const savedState = localStorage.getItem(storageKey);
        const wasInRange = savedState ? JSON.parse(savedState).inRange : null;
        const savedBandType = savedState ? JSON.parse(savedState).bandType : null;

        // First visit - just save state, no alert
        if (wasInRange === null) {
          localStorage.setItem(storageKey, JSON.stringify({ inRange: isInRange, bandType }));
          return;
        }

        // Detect state changes
        if (wasInRange && !isInRange) {
          // Was in range, now out
          if (bandType === 'upside_band') {
            alerts.push({
              tokenId: pos.tokenId,
              type: 'sky_band_complete',
              message: `🚀 #${pos.tokenId}: Profit taken! Price exited above your range.`
            });
          } else if (bandType === 'crash_band') {
            alerts.push({
              tokenId: pos.tokenId,
              type: 'crash_band_complete',
              message: `📉 #${pos.tokenId}: Accumulation complete! Price exited below your range.`
            });
          } else {
            alerts.push({
              tokenId: pos.tokenId,
              type: 'went_out_of_range',
              message: `⚠️ #${pos.tokenId}: Position went out of range.`
            });
          }
        } else if (!wasInRange && isInRange) {
          // Was out of range, now back in
          alerts.push({
            tokenId: pos.tokenId,
            type: 'back_in_range',
            message: `✅ #${pos.tokenId}: Back in range! Earning fees again.`
          });
        }

        // Update saved state
        localStorage.setItem(storageKey, JSON.stringify({ inRange: isInRange, bandType }));
      } catch {
        // localStorage not available
      }
    });

    if (alerts.length > 0) {
      setPositionAlerts(alerts);
    }
  }, [lpGateState.lpPositions, alertsDismissed]);

  useEffect(() => {
    const tick = () => {
      setTimeUntilClaimMs(Math.max(CLAIM_UNLOCK_TIMESTAMP_MS - Date.now(), 0));
    };

    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Consolidated balance fetch - uses same logic as refreshFundingStatus
  useEffect(() => {
    const targetAddress = miniWalletAddress ?? primaryAddress;
    setBalanceProbeAddress(targetAddress);

    if (!targetAddress) {
      setPrimaryAddressMoonBalanceWei(null);
      setMoonBalanceWei(null);
      setWmonBalanceWei(null);
      setPrimaryBalanceStatus('idle');
      return;
    }

    let cancelled = false;

    const fetchBalance = async () => {
      setPrimaryBalanceStatus('loading');
      try {
        const response = await fetch(
          `/api/lp-funding?address=${encodeURIComponent(targetAddress)}`
        );
        if (!response.ok) {
          throw new Error('funding_lookup_failed');
        }
        const data = (await response.json()) as {
          wmonBalanceWei?: string;
          wmonAllowanceWei?: string;
          moonBalanceWei?: string;
          moonAllowanceWei?: string;
        };
        if (cancelled) return;

        // Set all balance states from the same source
        const moonBal = BigInt(data.moonBalanceWei ?? '0');
        const wmonBal = BigInt(data.wmonBalanceWei ?? '0');

        setPrimaryAddressMoonBalanceWei(moonBal);
        setMoonBalanceWei(moonBal);
        setWmonBalanceWei(wmonBal);
        setWmonAllowanceWei(BigInt(data.wmonAllowanceWei ?? '0'));
        setMoonAllowanceWei(BigInt(data.moonAllowanceWei ?? '0'));
        setPrimaryBalanceStatus('loaded');
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch wallet balances', err);
        setPrimaryAddressMoonBalanceWei(null);
        setMoonBalanceWei(null);
        setWmonBalanceWei(null);
        setPrimaryBalanceStatus('error');
      }
    };

    void fetchBalance();

    return () => {
      cancelled = true;
    };
  }, [miniWalletAddress, primaryAddress]);

  useEffect(() => {
    if (!viewerContext?.fid) {
      setPersonaRecord(null);
      setPersonaHint(null);
      setPersonaLookupStatus('idle');
      return;
    }

    let cancelled = false;
    const fid = viewerContext.fid;

    const fetchPersona = async () => {
      setPersonaLookupStatus('loading');
      try {
        const response = await fetch(`/api/persona?fid=${fid}`);
        if (!response.ok) {
          throw new Error('persona_lookup_failed');
        }
        const data = (await response.json()) as PersonaApiResponse;
        if (cancelled) return;
        setPersonaRecord(data.record ?? null);
        setPersonaHint((data.personaHint as CsvPersonaHint | undefined) ?? null);
        setPersonaLookupStatus('loaded');
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch persona row from CSV', err);
        setPersonaRecord(null);
        setPersonaHint(null);
        setPersonaLookupStatus('error');
      }
    };

    void fetchPersona();

    return () => {
      cancelled = true;
    };
  }, [viewerContext?.fid]);

  const syncAddresses = async (fid: number) => {
    const response = await fetch(`/api/addresses?fid=${fid}`);
    if (!response.ok) {
      throw new Error('Unable to sync verified addresses');
    }
    const data = (await response.json()) as { addresses: string[] };
    const fetchedAddresses = data.addresses ?? [];
    setAddresses(fetchedAddresses);
    setPrimaryAddress(fetchedAddresses[0] ?? null);
    return fetchedAddresses;
  };

  const handleSignIn = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setScanPhase('authenticating');

    let activeContext = viewerContext;

    try {
      const nonce =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`;
      await sdk.actions.signIn({ nonce });
      const context = await sdk.context;
      if (context.user) {
        activeContext = {
          fid: context.user.fid,
          username: context.user.username,
          displayName: context.user.displayName
        };
        setViewerContext(activeContext);
      }
    } catch (authErr) {
      console.warn('Sign in failed, falling back to cached context', authErr);
    }

    if (!activeContext) {
      setError('Failed to authenticate. Please try again.');
      setScanPhase('error');
      setIsLoading(false);
      return;
    }

    try {
      setScanPhase('addresses');
      const fetchedAddresses =
        addresses.length > 0 ? addresses : await syncAddresses(activeContext.fid);
      const derivedPrimaryAddress = fetchedAddresses[0];

      if (!derivedPrimaryAddress) {
        setError('No verified address available. Add a wallet in Warpcast and retry.');
        setScanPhase('error');
        return;
      }

      setDropAddress(null);
      let matchedAddress: string | null = null;
      let matchedResult: AirdropData | null = null;

      for (const addr of fetchedAddresses) {
        setScanPhase('fetching');
        try {
          const response = await fetch(`/api/airdrop?address=${addr}`);
          const result = (await response.json()) as AirdropData;
          if (result.eligible) {
            matchedAddress = addr;
            matchedResult = result;
            break;
          }
          if (!matchedResult) {
            matchedResult = result;
          }
        } catch (airdropErr) {
          console.error('Failed to fetch airdrop for address', addr, airdropErr);
        }
      }

      if (!matchedAddress) {
        matchedAddress = derivedPrimaryAddress;
      }

      setDropAddress(matchedAddress);
      setPrimaryAddress(derivedPrimaryAddress);

      setUserData({
        fid: activeContext.fid,
        username: activeContext.username,
        displayName: activeContext.displayName,
        verifiedAddresses: fetchedAddresses
      });

      if (matchedResult) {
        setAirdropData(matchedResult);
      }

      // Check if user has 0 points
      if (
        matchedResult &&
        (!matchedResult.eligible ||
          matchedResult.amount === '0' ||
          matchedResult.amount === undefined)
      ) {
        setHasZeroPoints(true);
        setScanPhase('ready');
        setIsLoading(false);
        return;
      }

      setScanPhase('fetching');
      try {
        const engagementResponse = await fetch(`/api/engagement?fid=${activeContext.fid}`);
        if (engagementResponse.ok) {
          const engagementResult = await engagementResponse.json();
          setEngagementData(engagementResult);

          if (
            matchedResult?.eligible &&
            engagementResult.isFollowing &&
            engagementResult.replyCount > 0
          ) {
            setShowLootReveal(true);
          }
        }
      } catch (engagementErr) {
        console.error('Failed to fetch engagement data', engagementErr);
      }

      setScanPhase('ready');
    } catch (err) {
      console.error('Failed to complete scan:', err);
      setError('Unable to complete the scan. Please try again.');
      setScanPhase('error');
    } finally {
      setIsLoading(false);
    }
  }, [addresses, viewerContext]);

  // Auto-sign in when we have viewerContext from SDK but no userData yet
  // This prevents having to click "SCAN FID" when navigating back from other pages
  useEffect(() => {
    if (viewerContext && !userData && isSdkReady && scanPhase === 'idle') {
      // Auto-trigger sign in since we already have context from SDK
      handleSignIn();
    }
  }, [viewerContext, userData, isSdkReady, scanPhase, handleSignIn]);

  const handleCopyContract = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_ADDRESS);
      setCopiedContract(true);
      setTimeout(() => setCopiedContract(false), 2500);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleCopyWallet = async (address?: string | null) => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopiedWallet(true);
      setTimeout(() => setCopiedWallet(false), 2500);
    } catch (err) {
      console.error('Failed to copy wallet', err);
    }
  };

  const asHexAddress = (value: string): `0x${string}` =>
    (value.startsWith('0x') ? value : `0x${value}`) as `0x${string}`;

  const formatTokenAmount = useCallback((value?: bigint | null, decimals = 18, precision = 4) => {
    if (value === undefined || value === null) return '—';
    try {
      const asNumber = Number(formatUnits(value, decimals));
      if (Number.isFinite(asNumber)) {
        return asNumber.toLocaleString(undefined, { maximumFractionDigits: precision });
      }
      const formatted = formatUnits(value, decimals);
      return Number(formatted).toLocaleString(undefined, { maximumFractionDigits: precision });
    } catch {
      return formatUnits(value, decimals);
    }
  }, []);

  const mutateLpPosition = useCallback(
    (tokenId: string, updater: (position: LpPosition) => LpPosition) => {
      setLpGateState((prev) => {
        if (!prev.lpPositions || prev.lpPositions.length === 0) {
          return prev;
        }
        let hasUpdate = false;
        const lpPositions = prev.lpPositions.map((position) => {
          if (position.tokenId !== tokenId) {
            return position;
          }
          hasUpdate = true;
          return updater(position);
        });
        if (!hasUpdate) {
          return prev;
        }
        return {
          ...prev,
          lpPositions
        };
      });
    },
    [setLpGateState]
  );

  const handleCheckLpFees = useCallback(
    async (tokenId: string) => {
      mutateLpPosition(tokenId, (position) => ({
        ...position,
        feesStatus: 'loading',
        feesError: null
      }));

      const fallbackError = 'Unable to refresh rewards right now';

      try {
        const response = await fetch(`/api/lp-fees?tokenId=${tokenId}`, {
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`fees_route_${response.status}`);
        }

        const data = (await response.json()) as {
          tokenId: string;
          fees: { token0Wei: string; token1Wei: string } | null;
        };

        const token0Wei = data.fees?.token0Wei ?? '0';
        const token1Wei = data.fees?.token1Wei ?? '0';

        const safeBigInt = (value: string) => {
          try {
            return BigInt(value);
          } catch {
            return BigInt(0);
          }
        };

        mutateLpPosition(tokenId, (position) => {
          const decimals0 = position.token0?.decimals ?? 18;
          const decimals1 = position.token1?.decimals ?? 18;
          const amount0 = safeBigInt(token0Wei);
          const amount1 = safeBigInt(token1Wei);

          return {
            ...position,
            fees: {
              token0Wei,
              token1Wei,
              token0Formatted: formatTokenAmount(amount0, decimals0, 4),
              token1Formatted: formatTokenAmount(amount1, decimals1, 4)
            },
            feesStatus: 'loaded',
            feesError: null
          };
        });

        setToast({
          kind: 'success',
          message: 'Rewards synced'
        });
      } catch (error) {
        console.error('LP_FEES:refresh_failed', { tokenId, error });
        const errorMessage = error instanceof Error ? error.message : fallbackError;
        mutateLpPosition(tokenId, (position) => ({
          ...position,
          feesStatus: 'error',
          feesError: errorMessage
        }));
        setToast({
          kind: 'error',
          message: 'Failed to fetch rewards'
        });
      }
    },
    [formatTokenAmount, mutateLpPosition]
  );

  const formatLpClaimErrorMessage = (code?: string) => {
    switch (code) {
      case 'lp_simulation_failed':
        return 'Simulation indicated this LP transaction would revert. Check your m00n balance/approval and try again.';
      case 'lp_claim_failed':
        return 'LP transaction failed to build. Please retry in a moment.';
      default:
        return code ?? 'lp_claim_failed';
    }
  };

  const handleMiniWalletAccountsChanged = useCallback((accounts?: readonly string[]) => {
    if (Array.isArray(accounts) && accounts.length > 0) {
      setMiniWalletAddress(accounts[0] ?? null);
    } else {
      setMiniWalletAddress(null);
    }
  }, []);

  const getMiniWalletProvider = useCallback(async () => {
    return (
      (await sdk.wallet.getEthereumProvider().catch(() => undefined)) ?? sdk.wallet.ethProvider
    );
  }, []);

  const sendCallsViaProvider = useCallback(
    async ({ calls }: { calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] }) => {
      const provider = await getMiniWalletProvider();
      if (!provider || typeof provider.request !== 'function' || !miniWalletAddress) {
        throw new Error('wallet_provider_unavailable');
      }

      const request = provider.request.bind(provider) as <T>(args: {
        method: string;
        params?: unknown[];
      }) => Promise<T>;

      for (const call of calls) {
        const tx = {
          from: miniWalletAddress,
          to: call.to,
          data: call.data,
          value:
            call.value && call.value > BigInt(0) ? `0x${call.value.toString(16)}` : ('0x0' as const)
        };
        // Sequentially send each transaction; Monad does not yet support wallet_sendCalls.
        await request({
          method: 'eth_sendTransaction',
          params: [tx]
        });
      }
    },
    [getMiniWalletProvider, miniWalletAddress]
  );

  const handleCollectLpFees = useCallback(
    async (tokenId: string) => {
      if (!miniWalletAddress) {
        showToast('error', 'Connect your mini wallet to collect rewards');
        return;
      }

      mutateLpPosition(tokenId, (position) => ({
        ...position,
        collectStatus: 'loading',
        collectError: null
      }));

      try {
        const response = await fetch('/api/lp-collect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            tokenId,
            recipient: miniWalletAddress
          })
        });

        if (!response.ok) {
          throw new Error(`collect_route_${response.status}`);
        }

        const payload = (await response.json()) as {
          to: `0x${string}`;
          data: `0x${string}`;
          value?: string;
        };

        const callValue =
          typeof payload.value === 'string' && payload.value.length > 0
            ? BigInt(payload.value)
            : BigInt(0);

        await sendCallsViaProvider({
          calls: [
            {
              to: payload.to,
              data: payload.data,
              value: callValue
            }
          ]
        });

        mutateLpPosition(tokenId, (position) => ({
          ...position,
          collectStatus: 'idle',
          collectError: null
        }));

        // Record harvest for points + auto-tune (harvest = daily tune)
        const position = lpGateState.lpPositions?.find((p) => p.tokenId === tokenId);
        if (userData?.fid && position?.fees) {
          try {
            const wmonPrice = lpGateState.poolWmonUsdPrice ?? 0;
            const currentTick = lpGateState.poolCurrentTick ?? 0;
            const moonPriceInWmon = currentTick ? Math.pow(1.0001, currentTick) : 0;
            const moonPrice = moonPriceInWmon * wmonPrice;

            // Record harvest
            await fetch('/api/harvest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fid: userData.fid,
                username: userData.username,
                address: miniWalletAddress,
                tokenId,
                wmonAmountWei: position.fees.token1Wei ?? '0',
                moonAmountWei: position.fees.token0Wei ?? '0',
                wmonPriceUsd: wmonPrice,
                moonPriceUsd: moonPrice
              })
            });

            // Auto-tune: harvesting counts as daily tune
            if (checkInData?.canCheckIn) {
              const tuneResponse = await fetch('/api/daily-checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fid: userData.fid, action: 'checkin' })
              });
              if (tuneResponse.ok) {
                const tuneData = await tuneResponse.json();
                setCheckInData({
                  currentStreak: tuneData.currentStreak ?? 0,
                  longestStreak: tuneData.longestStreak ?? 0,
                  totalCheckIns: tuneData.totalCheckIns ?? 0,
                  multiplier: tuneData.multiplier ?? 1,
                  multiplierTier: tuneData.multiplierTier ?? '—',
                  canCheckIn: false,
                  nextAvailableAt: tuneData.nextAvailableAt,
                  hoursUntilAvailable: tuneData.hoursUntilAvailable ?? 24
                });
                // Show milestone if any
                if (tuneData.reward?.message) {
                  showToast('success', tuneData.reward.message);
                }
              }
            }

            // Refresh stats
            setHarvestStats(null);
          } catch (e) {
            console.warn('Failed to record harvest/tune', e);
          }
        }

        // Clear old fees for this position only (fees were just collected)
        mutateLpPosition(tokenId, (pos) => ({
          ...pos,
          fees: {
            token0Wei: '0',
            token1Wei: '0',
            token0Formatted: '0',
            token1Formatted: '0',
            unclaimedUsd: 0
          },
          feesStatus: 'loaded', // Keep as loaded but with zero values
          collectStatus: 'idle'
        }));

        // Show success with tune status - use a ref-like check for canCheckIn
        const didTune = checkInData?.canCheckIn === true;
        showToast('success', 'Harvested! 🌾 +points' + (didTune ? ' +tuned 🎵' : ''));

        // DON'T call refreshPersonalSigils() - it wipes all position data
        // The position data is still valid, we just collected the fees
      } catch (error) {
        console.error('LP_FEES:collect_failed', { tokenId, error });
        const errorMessage =
          error instanceof Error ? error.message : 'Unable to collect rewards right now';
        mutateLpPosition(tokenId, (position) => ({
          ...position,
          collectStatus: 'error',
          collectError: errorMessage
        }));
        showToast('error', 'Failed to collect rewards');
      }
    },
    [
      miniWalletAddress,
      mutateLpPosition,
      sendCallsViaProvider,
      showToast,
      userData?.fid,
      userData?.username,
      checkInData,
      lpGateState.lpPositions,
      lpGateState.poolWmonUsdPrice,
      lpGateState.poolCurrentTick
    ]
  );

  // Compound: collect fees + add them back to position
  const handleCompoundLpFees = useCallback(
    async (tokenId: string) => {
      if (!miniWalletAddress) {
        showToast('error', 'Connect your mini wallet to compound');
        return;
      }

      const position = lpGateState.lpPositions?.find((p) => p.tokenId === tokenId);
      if (!position?.fees) {
        showToast('error', 'No fees to compound');
        return;
      }

      // Step 1: Checking
      mutateLpPosition(tokenId, (pos) => ({
        ...pos,
        compoundStatus: 'checking',
        compoundStep: 'Preparing compound...',
        collectStatus: 'loading',
        collectError: null
      }));

      try {
        // Fetch fresh fee data to ensure accuracy
        const feeResponse = await fetch(`/api/lp-fees?tokenId=${tokenId}`);
        let amount0Wei = position.fees.token0Wei ?? '0';
        let amount1Wei = position.fees.token1Wei ?? '0';

        if (feeResponse.ok) {
          const feeData = await feeResponse.json();
          if (feeData.fees) {
            amount0Wei = feeData.fees.token0Wei ?? amount0Wei;
            amount1Wei = feeData.fees.token1Wei ?? amount1Wei;
            console.log('COMPOUND:fresh_fees', { amount0Wei, amount1Wei });
          }
        }

        mutateLpPosition(tokenId, (pos) => ({
          ...pos,
          compoundStep: 'Building transaction...'
        }));

        const response = await fetch('/api/lp-compound', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenId,
            recipient: miniWalletAddress,
            amount0Wei,
            amount1Wei,
            slippagePercent: 5
          })
        });

        const payload = await response.json();

        if (!response.ok) {
          // Handle specific errors with helpful messages
          if (payload.error === 'no_fees_to_compound') {
            throw new Error('No fees to compound');
          } else if (payload.error === 'single_sided_in_range') {
            throw new Error(
              payload.detail ?? 'In-range positions need both tokens - collect instead'
            );
          } else if (payload.error === 'zero_liquidity') {
            throw new Error(payload.detail ?? 'Fees too small - collect instead');
          } else if (payload.error === 'position_build_failed') {
            throw new Error(payload.detail ?? 'Cannot build position from fees');
          }
          throw new Error(payload.detail ?? payload.error ?? `compound_failed_${response.status}`);
        }

        // Step 2: Collecting fees
        mutateLpPosition(tokenId, (pos) => ({
          ...pos,
          compoundStatus: 'collecting',
          compoundStep: 'Step 1/2: Collecting fees...'
        }));

        // Execute collect transaction
        const collectCall = payload.calls[0];
        await sendCallsViaProvider({
          calls: [
            {
              to: payload.to as `0x${string}`,
              data: collectCall.data,
              value: BigInt(collectCall.value || '0')
            }
          ]
        });

        // Step 3: Increasing liquidity
        mutateLpPosition(tokenId, (pos) => ({
          ...pos,
          compoundStatus: 'increasing',
          compoundStep: 'Step 2/2: Adding to position...'
        }));

        // Execute increase transaction
        const increaseCall = payload.calls[1];
        await sendCallsViaProvider({
          calls: [
            {
              to: payload.to as `0x${string}`,
              data: increaseCall.data,
              value: BigInt(increaseCall.value || '0')
            }
          ]
        });

        // Success!
        mutateLpPosition(tokenId, (pos) => ({
          ...pos,
          compoundStatus: 'success',
          compoundStep: 'Compound complete! ✓',
          collectStatus: 'idle',
          collectError: null,
          // Clear old fees - they've been compounded
          fees: undefined,
          feesStatus: 'idle'
        }));

        // Reset after 3 seconds
        setTimeout(() => {
          mutateLpPosition(tokenId, (pos) => ({
            ...pos,
            compoundStatus: 'idle',
            compoundStep: undefined
          }));
        }, 3000);

        // Record harvest for points + auto-tune
        if (userData?.fid) {
          try {
            const wmonPrice = lpGateState.poolWmonUsdPrice ?? 0;
            const currentTick = lpGateState.poolCurrentTick ?? 0;
            const moonPriceInWmon = currentTick ? Math.pow(1.0001, currentTick) : 0;
            const moonPrice = moonPriceInWmon * wmonPrice;

            await fetch('/api/harvest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fid: userData.fid,
                username: userData.username,
                address: miniWalletAddress,
                tokenId,
                wmonAmountWei: position.fees.token1Wei ?? '0',
                moonAmountWei: position.fees.token0Wei ?? '0',
                wmonPriceUsd: wmonPrice,
                moonPriceUsd: moonPrice
              })
            });

            if (checkInData?.canCheckIn) {
              const tuneResponse = await fetch('/api/daily-checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fid: userData.fid, action: 'checkin' })
              });
              if (tuneResponse.ok) {
                const tuneData = await tuneResponse.json();
                setCheckInData({
                  currentStreak: tuneData.currentStreak ?? 0,
                  longestStreak: tuneData.longestStreak ?? 0,
                  totalCheckIns: tuneData.totalCheckIns ?? 0,
                  multiplier: tuneData.multiplier ?? 1,
                  multiplierTier: tuneData.multiplierTier ?? '—',
                  canCheckIn: false,
                  nextAvailableAt: tuneData.nextAvailableAt,
                  hoursUntilAvailable: tuneData.hoursUntilAvailable ?? 24
                });
                // Show milestone rewards if any
                if (tuneData.reward?.message) {
                  showToast('success', tuneData.reward.message);
                }
              }
            }

            setHarvestStats(null);
          } catch (e) {
            console.warn('Failed to record compound harvest', e);
          }
        }

        // Show success with tune status
        const didTune = checkInData?.canCheckIn === true;
        showToast(
          'success',
          'Compounded! 🔄 Fees added back to position' + (didTune ? ' +tuned 🎵' : '')
        );

        // DON'T call refreshPersonalSigils() - it wipes all position data
        // Position data is still valid, fees were compounded back into liquidity
      } catch (error) {
        console.error('LP_COMPOUND:failed', { tokenId, error });
        const errorMessage = error instanceof Error ? error.message : 'Compound failed';
        mutateLpPosition(tokenId, (pos) => ({
          ...pos,
          compoundStatus: 'error',
          compoundStep: errorMessage,
          collectStatus: 'error',
          collectError: errorMessage
        }));
        showToast('error', errorMessage);

        // Reset error state after 5 seconds
        setTimeout(() => {
          mutateLpPosition(tokenId, (pos) => ({
            ...pos,
            compoundStatus: 'idle',
            compoundStep: undefined,
            collectStatus: 'idle',
            collectError: null
          }));
        }, 5000);
      }
    },
    [
      miniWalletAddress,
      lpGateState.lpPositions,
      lpGateState.poolWmonUsdPrice,
      lpGateState.poolCurrentTick,
      mutateLpPosition,
      sendCallsViaProvider,
      showToast,
      userData?.fid,
      userData?.username,
      checkInData
    ]
  );

  // Burn m00n to ascend house tier
  const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD';
  const handleBurnMoon = useCallback(
    async (amountFormatted: string) => {
      if (!miniWalletAddress) {
        showToast('error', 'Connect your wallet to burn');
        return;
      }
      if (!userData?.fid) {
        showToast('error', 'Sign in to burn');
        return;
      }

      const amount = parseFloat(amountFormatted.replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) {
        showToast('error', 'Invalid burn amount');
        return;
      }

      const amountWei = parseUnits(amount.toString(), 18);

      // Check balance
      if (moonBalanceWei && amountWei > moonBalanceWei) {
        showToast('error', 'Insufficient m00n balance');
        return;
      }

      setBurnStatus('burning');

      try {
        // Transfer m00n to burn address
        const transferData = encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [BURN_ADDRESS as `0x${string}`, amountWei]
        });

        await sendCallsViaProvider({
          calls: [
            {
              to: TOKEN_ADDRESS as `0x${string}`,
              data: transferData,
              value: BigInt(0)
            }
          ]
        });

        setBurnStatus('recording');

        // Record the burn (tx hash not available from sendCalls, use timestamp as unique ID)
        const recordResponse = await fetch('/api/ascension', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'burn',
            fid: userData.fid,
            username: userData.username,
            address: miniWalletAddress,
            txHash: `burn_${Date.now()}`,
            amountWei: amountWei.toString()
          })
        });

        if (recordResponse.ok) {
          const result = await recordResponse.json();
          // Update house tier - use currentTier which is always returned
          const tier = result.currentTier;
          setHouseTier({
            tier: tier?.tier ?? 'wanderer',
            name: tier?.name ?? 'Wanderer',
            emoji: tier?.emoji ?? '◌',
            harvestMultiplier: tier?.harvestMultiplier ?? 1,
            totalBurnedFormatted: result.record?.totalBurnedWei
              ? (Number(BigInt(result.record.totalBurnedWei)) / 10 ** 18).toLocaleString()
              : '0',
            nextTier: result.nextTier
          });

          if (result.tierChanged) {
            showToast('success', `🔥 Ascended to ${tier?.name}!`);
          } else {
            showToast('success', `🔥 Burned ${amountFormatted} m00n!`);
          }
        }

        setShowBurnModal(false);
        setBurnAmount('');
        setBurnStatus('idle');
      } catch (error) {
        console.error('BURN:failed', error);
        showToast('error', 'Burn failed');
        setBurnStatus('idle');
      }
    },
    [
      miniWalletAddress,
      userData?.fid,
      userData?.username,
      moonBalanceWei,
      sendCallsViaProvider,
      showToast
    ]
  );

  const handleRemoveLiquidity = useCallback(
    async (tokenId: string) => {
      if (!miniWalletAddress) {
        showToast('error', 'Connect your mini wallet to remove liquidity');
        return;
      }

      // Confirm with user
      const confirmed = window.confirm(
        'Remove all liquidity from this position?\n\nThis will withdraw your tokens and any uncollected fees.'
      );
      if (!confirmed) return;

      mutateLpPosition(tokenId, (position) => ({
        ...position,
        removeStatus: 'loading',
        removeError: null
      }));

      try {
        const response = await fetch('/api/lp-remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenId,
            recipient: miniWalletAddress,
            percentageToRemove: 100,
            burnToken: true
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || `remove_route_${response.status}`);
        }

        const payload = (await response.json()) as {
          to: `0x${string}`;
          data: `0x${string}`;
          value?: string;
        };

        const callValue =
          typeof payload.value === 'string' && payload.value.length > 0
            ? BigInt(payload.value)
            : BigInt(0);

        await sendCallsViaProvider({
          calls: [{ to: payload.to, data: payload.data, value: callValue }]
        });

        mutateLpPosition(tokenId, (position) => ({
          ...position,
          removeStatus: 'success',
          removeError: null
        }));

        showToast('success', 'Liquidity removal submitted! Position will close.');

        // Remove from list after a delay
        setTimeout(() => {
          setLpGateState((prev) => ({
            ...prev,
            lpPositions: (prev.lpPositions ?? []).filter((p) => p.tokenId !== tokenId)
          }));
        }, 3000);
      } catch (error) {
        console.error('LP_FEES:remove_failed', { tokenId, error });
        const errorMessage =
          error instanceof Error ? error.message : 'Unable to remove liquidity right now';
        mutateLpPosition(tokenId, (position) => ({
          ...position,
          removeStatus: 'error',
          removeError: errorMessage
        }));
        showToast('error', 'Failed to remove liquidity');
      }
    },
    [miniWalletAddress, mutateLpPosition, sendCallsViaProvider, showToast]
  );

  const handleSharePosition = useCallback(
    async (position: LpPosition) => {
      if (!userData) {
        showToast('error', 'Unable to share right now');
        return;
      }

      const wmonPrice = lpGateState.poolWmonUsdPrice ?? 0;

      // Calculate position value in USD
      // token0 is m00n, token1 is WMON
      const wmonValueUsd = position.token1?.amountFormatted
        ? Number(position.token1.amountFormatted) * wmonPrice
        : 0;
      const moonValueUsd = position.token0?.amountFormatted
        ? Number(position.token0.amountFormatted) * (wmonPrice / 100000000) // m00n price = wmon price / 100M supply ratio
        : 0;
      const positionValueUsd = wmonValueUsd + moonValueUsd;

      // Get username - fallback to displayName then fid
      const displayUsername = userData.username || userData.displayName || `fid${userData.fid}`;
      console.log(
        'SHARE_POSITION: userData=',
        JSON.stringify(userData),
        'displayUsername=',
        displayUsername
      );

      // Build OG image URL with position data
      const baseUrl =
        typeof window !== 'undefined' ? window.location.origin : 'https://m00nad.vercel.app';
      // Build share URL with position data for OG image
      const shareParams = new URLSearchParams({
        bandType: position.bandType || 'custom',
        rangeStatus: position.rangeStatus || 'unknown',
        rangeLower: position.priceLowerInToken1
          ? String(Math.round(Number(position.priceLowerInToken1) * 100000000 * wmonPrice))
          : '0',
        rangeUpper: position.priceUpperInToken1
          ? String(Math.round(Number(position.priceUpperInToken1) * 100000000 * wmonPrice))
          : '0',
        username: displayUsername,
        valueUsd: positionValueUsd > 0 ? String(positionValueUsd.toFixed(2)) : ''
      });

      const shareUrl = `${baseUrl}/share/position/${position.tokenId}?${shareParams.toString()}`;

      // Compose text based on position status
      const isInRange = position.rangeStatus === 'in-range';
      const bandEmoji =
        position.bandType === 'crash_band'
          ? '🔻'
          : position.bandType === 'upside_band'
            ? '🚀'
            : position.bandType === 'double_sided'
              ? '⚖️'
              : '🎯';
      const statusEmoji = isInRange ? '✅' : '⚠️';

      // Check if there are fees (non-zero token amounts)
      const hasFees =
        position.fees &&
        (BigInt(position.fees.token0Wei || '0') > BigInt(0) ||
          BigInt(position.fees.token1Wei || '0') > BigInt(0));

      const shareText = `${bandEmoji} My $m00n LP position #${position.tokenId}

${statusEmoji} ${isInRange ? 'Currently in range and earning!' : 'Out of range - watching the market'}
${hasFees ? `💰 Earning fees!` : ''}

Join the $m00n cabal 🌙`;

      try {
        await sdk.actions.composeCast({
          text: shareText,
          embeds: [shareUrl]
        });
        showToast('success', 'Share dialog opened!');
      } catch (err) {
        console.error('SHARE_POSITION:failed', err);
        showToast('error', 'Unable to share right now');
      }
    },
    [userData, lpGateState.poolWmonUsdPrice, showToast]
  );

  const syncMiniWalletAddress = useCallback(async () => {
    try {
      const provider = await getMiniWalletProvider();
      if (!provider || typeof provider.request !== 'function') {
        setMiniWalletAddress(null);
        return null;
      }
      const accounts = (await provider.request({
        method: 'eth_accounts'
      })) as string[] | undefined;
      handleMiniWalletAccountsChanged(accounts);
      return accounts?.[0] ?? null;
    } catch (err) {
      console.warn('Failed to sync mini wallet address', err);
      setMiniWalletAddress(null);
      return null;
    }
  }, [getMiniWalletProvider, handleMiniWalletAccountsChanged]);

  useEffect(() => {
    void syncMiniWalletAddress();
  }, [syncMiniWalletAddress]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const attachListeners = async () => {
      const provider = await getMiniWalletProvider();
      if (!provider) return;

      const anyProvider = provider as typeof provider & {
        on?: (event: string, listener: (...args: unknown[]) => void) => void;
        off?: (event: string, listener: (...args: unknown[]) => void) => void;
        removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
      };

      if (typeof anyProvider.on === 'function') {
        const listener = (...args: unknown[]) => {
          const accounts = Array.isArray(args[0]) ? (args[0] as readonly string[]) : undefined;
          handleMiniWalletAccountsChanged(accounts);
        };
        anyProvider.on('accountsChanged', listener);
        cleanup = () => {
          if (typeof anyProvider.removeListener === 'function') {
            anyProvider.removeListener('accountsChanged', listener);
          } else if (typeof anyProvider.off === 'function') {
            anyProvider.off('accountsChanged', listener);
          }
        };
      }
    };

    void attachListeners();

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [getMiniWalletProvider, handleMiniWalletAccountsChanged]);

  const openExternalUrl = async (url: string) => {
    try {
      await sdk.actions.openUrl({ url });
    } catch (err) {
      console.warn('Failed to open external url via sdk', err);
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const handleOpenClaimSite = async () => {
    try {
      await sdk.actions.openMiniApp({ url: CLAIM_URL });
    } catch (err) {
      console.warn('openMiniApp failed, falling back to openUrl', err);
      if (typeof window !== 'undefined') {
        try {
          await sdk.actions.openUrl({ url: CLAIM_URL });
        } catch (fallbackErr) {
          console.warn('openUrl fallback failed, opening new tab', fallbackErr);
          window.open(CLAIM_URL, '_blank', 'noopener,noreferrer');
        }
      }
    }
  };

  const handleOpenLpHelp = useCallback(() => {
    router.push(LP_HELP_PATH);
  }, [router]);

  const handleOpenHolderChat = async () => {
    await openExternalUrl(HOLDER_CHAT_URL);
  };

  const handleOpenHeavenMode = async () => {
    await openExternalUrl(HEAVEN_MODE_URL);
  };

  const handleOpenMoonLander = async () => {
    await openExternalUrl(MOONLANDER_URL);
  };

  const handleOpenAdvancedLp = async () => {
    setIsObservationDeckOpen(false);
    try {
      router.push('/miniapp/advanced-lp');
    } catch (err) {
      console.warn('router push advanced LP failed, falling back to openUrl', err);
      await openExternalUrl('/miniapp/advanced-lp');
    }
  };

  const handleRetryLpStatus = () => {
    refreshPersonalSigils();
  };

  const handleOpenLpClaimModal = (preset: LpClaimPreset = 'backstop') => {
    if (!canAccessLpFeatures) return;
    setLpClaimPreset(preset);
    setLpClaimError(null);
    setLpClaimAmount('');
    setIsLpClaimModalOpen(true);
    void syncMiniWalletAddress();
  };

  const handleCloseLpClaimModal = () => {
    if (isSubmittingLpClaim) return;
    setIsLpClaimModalOpen(false);
    setLpClaimAmount('');
    setLpClaimError(null);
  };

  const refreshFundingStatus = useCallback(async () => {
    if (!miniWalletAddress) {
      setWmonBalanceWei(null);
      setWmonAllowanceWei(null);
      setMoonBalanceWei(null);
      setMoonAllowanceWei(null);
      setFundingStatus('idle');
      return;
    }
    setFundingStatus('loading');
    try {
      const response = await fetch(`/api/lp-funding?address=${miniWalletAddress}`);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error ?? 'funding_lookup_failed');
      }
      const data = (await response.json()) as {
        wmonBalanceWei?: string;
        wmonAllowanceWei?: string;
        moonBalanceWei?: string;
        moonAllowanceWei?: string;
        wmonDecimals?: number;
        moonDecimals?: number;
      };
      setWmonBalanceWei(BigInt(data.wmonBalanceWei ?? '0'));
      setWmonAllowanceWei(BigInt(data.wmonAllowanceWei ?? '0'));
      setMoonBalanceWei(BigInt(data.moonBalanceWei ?? '0'));
      setMoonAllowanceWei(BigInt(data.moonAllowanceWei ?? '0'));
      setTokenDecimals({
        wmon:
          typeof data.wmonDecimals === 'number' && Number.isFinite(data.wmonDecimals)
            ? data.wmonDecimals
            : 18,
        moon:
          typeof data.moonDecimals === 'number' && Number.isFinite(data.moonDecimals)
            ? data.moonDecimals
            : 18
      });
      setFundingStatus('idle');
    } catch (err) {
      console.error('Failed to refresh funding status', err);
      setFundingStatus('error');
    }
  }, [miniWalletAddress]);

  // Always fetch balances when wallet is connected
  useEffect(() => {
    if (!miniWalletAddress) return;
    refreshFundingStatus();
  }, [miniWalletAddress, refreshFundingStatus]);

  useEffect(() => {
    if (!isLpClaimModalOpen || !miniWalletAddress) return;
    refreshFundingStatus();
  }, [isLpClaimModalOpen, miniWalletAddress, fundingRefreshNonce, refreshFundingStatus]);

  const handleSubmitLpClaim = async () => {
    if (!miniWalletAddress) {
      setLpClaimError('Connect your wallet to continue.');
      setLpDebugLog('❌ No wallet address; aborting LP claim.');
      return;
    }

    const sanitizedAmount = lpClaimAmount.trim();
    if (!sanitizedAmount) {
      setLpClaimError('Enter an amount to deposit.');
      setLpDebugLog('❌ Empty amount input.');
      return;
    }

    const amountWei = desiredAmountWei;
    if (!amountWei) {
      setLpClaimError('Invalid amount.');
      setLpDebugLog(`❌ Invalid amount after parsing: "${lpClaimAmount}".`);
      return;
    }

    if (wmonBalanceWei === null || moonBalanceWei === null) {
      setLpClaimError('Still checking wallet balances. Please retry.');
      setLpDebugLog('⏳ Balances not ready yet (WMON or m00n is null).');
      return;
    }

    // Up-front check: user must at least have enough WMON for their desired input
    const depositTokenLabel = lpClaimPreset === 'moon_upside' ? 'm00n' : 'WMON';
    const depositBalanceWei = lpClaimPreset === 'moon_upside' ? moonBalanceWei : wmonBalanceWei;
    if (depositBalanceWei < amountWei) {
      setLpClaimError(`Not enough ${depositTokenLabel} balance for this deposit.`);
      setLpDebugLog(
        `❌ ${depositTokenLabel} balance too low for input.\n` +
          `  desiredInputWei=${amountWei.toString()}\n` +
          `  walletDepositWei=${depositBalanceWei.toString()}`
      );
      return;
    }

    setIsSubmittingLpClaim(true);
    setLpClaimError(null);
    setLpDebugLog(
      [
        '🚀 Starting LP claim ritual…',
        `  input (${depositTokenLabel}): ${sanitizedAmount} (${amountWei.toString()} wei)`,
        `  wallet WMON: ${wmonBalanceWei.toString()} wei`,
        `  wallet m00n: ${moonBalanceWei.toString()} wei`,
        `  preset: ${lpClaimPreset}`
      ].join('\n')
    );

    try {
      const response = await fetch('/api/lp-claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: miniWalletAddress,
          amount: sanitizedAmount,
          preset: lpClaimPreset
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const code = errorBody?.error ?? 'lp_claim_failed';
        setLpDebugLog((prev) =>
          [
            prev,
            '',
            '❌ /api/lp-claim returned non-OK status.',
            `  status=${response.status}`,
            `  errorCode=${code}`
          ]
            .filter(Boolean)
            .join('\n')
        );
        throw new Error(code);
      }

      const payload = (await response.json()) as {
        to: string;
        data: string;
        value?: string;
        requiredMoonWei?: string;
        requiredWmonWei?: string;
        maxRequiredMoonWei?: string;
        maxRequiredWmonWei?: string;
      };

      const requiredMoonWei = BigInt(payload.requiredMoonWei ?? '0');
      const requiredWmonWei = BigInt(payload.requiredWmonWei ?? '0');
      const targetMoonAllowance = BigInt(
        payload.maxRequiredMoonWei ?? payload.requiredMoonWei ?? '0'
      );
      const targetWmonAllowance = BigInt(
        payload.maxRequiredWmonWei ?? payload.requiredWmonWei ?? '0'
      );

      setLpDebugLog((prev) =>
        [
          prev,
          '',
          '✅ Built LP position payload from backend.',
          `  requiredWmonWei=${requiredWmonWei.toString()}`,
          `  requiredMoonWei=${requiredMoonWei.toString()}`,
          `  walletWmonWei=${wmonBalanceWei.toString()}`,
          `  walletMoonWei=${moonBalanceWei.toString()}`
        ]
          .filter(Boolean)
          .join('\n')
      );

      if (moonBalanceWei < requiredMoonWei) {
        setLpClaimError('Not enough m00n for this LP band. Swap MON → m00n first.');
        setLpDebugLog((prev) =>
          [
            prev,
            '❌ Not enough m00n for required amount.',
            `  requiredMoonWei=${requiredMoonWei.toString()}`,
            `  walletMoonWei=${moonBalanceWei.toString()}`
          ].join('\n')
        );
        return;
      }
      if (wmonBalanceWei < requiredWmonWei) {
        setLpClaimError('Not enough WMON for this LP band.');
        setLpDebugLog((prev) =>
          [
            prev,
            '❌ Not enough WMON for required amount.',
            `  requiredWmonWei=${requiredWmonWei.toString()}`,
            `  walletWmonWei=${wmonBalanceWei.toString()}`
          ].join('\n')
        );
        return;
      }

      const needsWmonApproval =
        targetWmonAllowance > BigInt(0) &&
        (wmonAllowanceWei === null || wmonAllowanceWei < targetWmonAllowance);
      const needsMoonApproval =
        targetMoonAllowance > BigInt(0) &&
        (moonAllowanceWei === null || moonAllowanceWei < targetMoonAllowance);

      if (needsWmonApproval) {
        await approveTokenForLp('wmon', targetWmonAllowance);
      }
      if (needsMoonApproval) {
        await approveTokenForLp('moon', targetMoonAllowance);
      }

      const rawValue = (payload.value ?? '').trim();
      const callValue =
        rawValue && rawValue !== '0' && rawValue !== '0x0' ? BigInt(rawValue) : BigInt(0);

      setLpDebugLog((prev) =>
        [
          prev,
          '🧪 Sending LP mint transaction from mini wallet…',
          callValue > BigInt(0) ? `  with attached value = ${callValue.toString()} wei` : ''
        ]
          .filter(Boolean)
          .join('\n')
      );

      await sendCallsViaProvider({
        calls: [
          {
            to: asHexAddress(payload.to),
            data: payload.data as `0x${string}`,
            value: callValue > BigInt(0) ? callValue : undefined
          }
        ]
      });

      setIsLpClaimModalOpen(false);
      setLpClaimAmount('');
      setLpClaimError(null);
      setLpDebugLog((prev) => `${prev}\n✅ LP claim batch sent to wallet successfully.`);
      setTimeout(() => {
        refreshPersonalSigils();
        if (canAccessLpFeatures) {
          setLpPortalMode('gate');
        }
      }, 2000);
      setFundingRefreshNonce((prev) => prev + 1);
    } catch (err) {
      console.error('LP claim failed', err);
      const errorCode = err instanceof Error ? err.message : 'lp_claim_failed';
      setLpClaimError(formatLpClaimErrorMessage(errorCode));
      setLpDebugLog((prev) =>
        [prev, '', '💥 LP claim threw in frontend handler.', `  errorCode=${errorCode}`]
          .filter(Boolean)
          .join('\n')
      );
    } finally {
      setIsSubmittingLpClaim(false);
    }
  };

  const handleSwapMonToToken = async (target: 'wmon' | 'moon') => {
    setSwapInFlight(target);
    try {
      await sdk.actions.swapToken({
        sellToken: MON_NATIVE_CAIP,
        buyToken: target === 'wmon' ? WMON_CAIP : MOON_CAIP
      });
      if (target === 'wmon' || target === 'moon') {
        setFundingRefreshNonce((prev) => prev + 1);
      }
    } catch (err) {
      console.error('swapToken failed', err);
    } finally {
      setSwapInFlight((current) => (current === target ? null : current));
    }
  };

  const handleViewToken = async (token: 'wmon' | 'moon') => {
    try {
      await sdk.actions.viewToken({
        token: token === 'wmon' ? WMON_CAIP : MOON_CAIP
      });
    } catch (err) {
      console.error('viewToken failed', err);
    }
  };

  const approveTokenForLp = useCallback(
    async (token: 'moon' | 'wmon', amountWei: bigint) => {
      if (!miniWalletAddress) {
        throw new Error('wallet_provider_unavailable');
      }
      if (amountWei <= BigInt(0)) {
        return;
      }
      const tokenAddress = token === 'moon' ? TOKEN_ADDRESS : WMON_ADDRESS;
      const label = token === 'moon' ? 'm00n' : 'WMON';
      const decimals =
        token === 'moon'
          ? Number.isFinite(tokenDecimals.moon)
            ? tokenDecimals.moon
            : 18
          : Number.isFinite(tokenDecimals.wmon)
            ? tokenDecimals.wmon
            : 18;
      const formattedAmount = formatTokenAmount(amountWei, decimals, 2);

      const nowSec = Math.floor(Date.now() / 1000);
      const permitExpiration = nowSec + 60 * 60 * 24 * 30;

      const approveUnderlyingData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [asHexAddress(PERMIT2_ADDRESS), amountWei]
      });

      const permitData = encodeFunctionData({
        abi: permit2Abi,
        functionName: 'approve',
        args: [
          asHexAddress(tokenAddress),
          asHexAddress(POSITION_MANAGER_ADDRESS),
          amountWei,
          permitExpiration
        ]
      });

      showToast('info', `Approving ${label} (~${formattedAmount} ${label})…`);
      setLpDebugLog((prev) =>
        [prev, `🔐 Auto-approving ${label} via Permit2 for ${amountWei.toString()} wei…`]
          .filter(Boolean)
          .join('\n')
      );

      try {
        await sendCallsViaProvider({
          calls: [
            { to: asHexAddress(tokenAddress), data: approveUnderlyingData, value: BigInt(0) },
            { to: asHexAddress(PERMIT2_ADDRESS), data: permitData, value: BigInt(0) }
          ]
        });
      } catch (error) {
        showToast('error', `Approval failed for ${label}. Check wallet and retry.`);
        throw error;
      }

      setLpDebugLog((prev) =>
        [prev, `✅ ${label} Permit2 approval complete.`].filter(Boolean).join('\n')
      );
      if (token === 'moon') {
        setMoonAllowanceWei(amountWei);
      } else {
        setWmonAllowanceWei(amountWei);
      }
      setFundingRefreshNonce((prev) => prev + 1);
      showToast('success', `Approved ${label} for LP.`);
    },
    [
      miniWalletAddress,
      sendCallsViaProvider,
      showToast,
      tokenDecimals.moon,
      tokenDecimals.wmon,
      formatTokenAmount
    ]
  );

  const personaActionHandlers: Record<PersonaActionId, (() => void) | undefined> = {
    lp_connect_wallet: handleSignIn,
    lp_become_lp: () => handleOpenLpClaimModal('backstop'),
    lp_open_docs: handleOpenLpHelp,
    lp_try_again: handleRetryLpStatus,
    lp_enter_lounge: handleOpenLpManager,
    open_claim: handleOpenClaimSite,
    open_chat: handleOpenHolderChat,
    open_heaven_mode: handleOpenHeavenMode,
    learn_more: handleOpenLpHelp
  };

  const renderCopyBody = (lines: string[]) => (
    <div className="space-y-2 text-sm opacity-80">
      {lines.map((line, idx) => (
        <p key={`${line}-${idx}`}>{line}</p>
      ))}
    </div>
  );

  const renderPersonaCtas = (
    copy: ReturnType<typeof getPersonaCopy>,
    options?: { disablePrimary?: boolean; disableSecondary?: boolean }
  ) => {
    if (!copy.primaryCta && !copy.secondaryCta) {
      return null;
    }

    const primaryHandler = copy.primaryCta
      ? personaActionHandlers[copy.primaryCta.actionId]
      : undefined;
    const secondaryHandler = copy.secondaryCta
      ? personaActionHandlers[copy.secondaryCta.actionId]
      : undefined;

    const shouldHidePrimary =
      (copy.primaryCta?.actionId === 'lp_enter_lounge' && (!hasLpNft || !canAccessLpFeatures)) ||
      (copy.primaryCta?.actionId === 'lp_become_lp' && !canAccessLpFeatures);
    const shouldHideSecondary =
      (copy.secondaryCta?.actionId === 'lp_enter_lounge' && (!hasLpNft || !canAccessLpFeatures)) ||
      (copy.secondaryCta?.actionId === 'lp_become_lp' && !canAccessLpFeatures);

    return (
      <div className="flex flex-col sm:flex-row sm:justify-center gap-3">
        {copy.primaryCta && !shouldHidePrimary && (
          <button
            onClick={primaryHandler}
            disabled={!primaryHandler || options?.disablePrimary}
            type="button"
            className="pixel-font px-6 py-3 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-40"
          >
            {copy.primaryCta.label}
          </button>
        )}
        {copy.secondaryCta && !shouldHideSecondary && (
          <button
            onClick={secondaryHandler}
            disabled={!secondaryHandler || options?.disableSecondary}
            type="button"
            className="pixel-font px-6 py-3 border border-[var(--monad-purple)] text-[var(--monad-purple)] rounded-lg hover:bg-[var(--monad-purple)] hover:text-white transition-colors disabled:opacity-40"
          >
            {copy.secondaryCta.label}
          </button>
        )}
      </div>
    );
  };

  const renderBalanceButtons = (options?: { layout?: 'row' | 'column' }) => {
    const layoutClass = options?.layout === 'row' ? 'flex-row' : 'flex-col sm:flex-row';
    return (
      <div className={`flex ${layoutClass} gap-2 w-full`}>
        <button
          type="button"
          onClick={() => handleSwapMonToToken('moon')}
          disabled={swapInFlight === 'moon'}
          className="flex-1 rounded-xl border border-[var(--monad-purple)] px-[5px] py-[5px] text-[11px] uppercase tracking-[0.25em] text-[var(--monad-purple)] hover:bg-[var(--monad-purple)] hover:text-black transition-colors disabled:opacity-40"
        >
          {swapInFlight === 'moon' ? 'OPENING…' : 'BUY m00n'}
        </button>
        <button
          type="button"
          onClick={() => handleSwapMonToToken('wmon')}
          disabled={swapInFlight === 'wmon'}
          className="flex-1 rounded-xl border border-white/40 px-[5px] py-[5px] text-[11px] uppercase tracking-[0.25em] text-white hover:bg-white/10 transition-colors disabled:opacity-40"
        >
          {swapInFlight === 'wmon' ? 'OPENING…' : 'BUY WMON'}
        </button>
      </div>
    );
  };

  const desiredAmountWei = useMemo(() => {
    const sanitized = lpClaimAmount.trim();
    if (!sanitized) return null;
    const decimals =
      lpClaimPreset === 'moon_upside' ? (tokenDecimals.moon ?? 18) : (tokenDecimals.wmon ?? 18);
    try {
      return parseUnits(sanitized, decimals);
    } catch {
      return null;
    }
  }, [lpClaimAmount, lpClaimPreset, tokenDecimals.moon, tokenDecimals.wmon]);

  const renderLpClaimModal = () => {
    const walletReady = Boolean(miniWalletAddress);
    const presetConfig = LP_PRESET_CONTENT[lpClaimPreset];
    const inputTokenKey = presetConfig.inputToken === 'WMON' ? 'wmon' : 'moon';
    const inputBalanceWei = inputTokenKey === 'wmon' ? wmonBalanceWei : moonBalanceWei;
    const hasFundingSnapshot =
      wmonBalanceWei !== null &&
      wmonAllowanceWei !== null &&
      moonBalanceWei !== null &&
      moonAllowanceWei !== null &&
      fundingStatus !== 'loading';
    const tokenInfoPending = walletReady && !hasFundingSnapshot;
    const hasAmountInput = Boolean(lpClaimAmount.trim());
    const hasSufficientInputBalance =
      walletReady &&
      desiredAmountWei !== null &&
      inputBalanceWei !== null &&
      inputBalanceWei >= desiredAmountWei;
    const hasSomeInputToken =
      walletReady && inputBalanceWei !== null && inputBalanceWei > BigInt(0);
    const amountPlaceholder =
      presetConfig.quickAmounts[0] ?? (lpClaimPreset === 'moon_upside' ? '50000' : '1.0');
    const fundingWarning = !walletReady
      ? 'Connect your Warpcast wallet to fund the LP ritual.'
      : !hasAmountInput
        ? `Enter an amount denominated in ${presetConfig.inputToken}.`
        : tokenInfoPending
          ? 'Checking wallet balances…'
          : fundingStatus === 'error'
            ? 'Failed to load wallet balances. Tap refresh or VIEW token.'
            : desiredAmountWei === null
              ? 'Amount is invalid.'
              : !hasSomeInputToken
                ? `You also need ${presetConfig.inputToken} in your Warp wallet for this LP band.`
                : !hasSufficientInputBalance
                  ? `Not enough ${presetConfig.inputToken} for this deposit.`
                  : null;

    const primaryLabel = walletReady
      ? isSubmittingLpClaim
        ? 'CLAIMING…'
        : 'CLAIM LP'
      : 'CONNECT WALLET';
    const primaryHandler = walletReady ? handleSubmitLpClaim : handleSignIn;
    const primaryDisabled =
      (!walletReady && isSubmittingLpClaim) ||
      isSubmittingLpClaim ||
      !hasAmountInput ||
      Boolean(fundingWarning && walletReady) ||
      tokenInfoPending;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={() => {
            if (!isSubmittingLpClaim) {
              handleCloseLpClaimModal();
            }
          }}
        />
        <div className="relative w-full max-w-md space-y-5 rounded-3xl border border-[var(--monad-purple)] bg-black/80 p-6 text-left shadow-2xl">
          <div className="flex items-center justify-between">
            <h2 className="pixel-font text-xl text-white">{presetConfig.title}</h2>
            <button
              onClick={handleCloseLpClaimModal}
              className="text-sm text-white/60 hover:text-white transition-colors"
              disabled={isSubmittingLpClaim}
              type="button"
            >
              CLOSE
            </button>
          </div>
          <p className="text-sm opacity-80">{presetConfig.description}</p>
          <p className="text-xs text-white/50">{presetConfig.helper}</p>
          {!walletReady && (
            <div className="rounded-lg border border-yellow-400/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
              Connect your Warpcast wallet to enter the LP ritual.
            </div>
          )}
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="opacity-70">WMON Balance</span>
              <span className="font-mono text-xs">
                {tokenInfoPending
                  ? '—'
                  : `${formatTokenAmount(wmonBalanceWei, tokenDecimals.wmon)} WMON`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="opacity-70">m00n Balance</span>
              <span className="font-mono text-xs">
                {tokenInfoPending
                  ? '—'
                  : `${formatTokenAmount(moonBalanceWei, tokenDecimals.moon)} m00n`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="opacity-70">m00n Allowance → LP</span>
              <span className="font-mono text-xs">
                {tokenInfoPending
                  ? '—'
                  : `${formatTokenAmount(moonAllowanceWei, tokenDecimals.moon)} m00n`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setFundingRefreshNonce((prev) => prev + 1)}
                disabled={!walletReady || fundingStatus === 'loading'}
                className="pixel-font text-[10px] px-3 py-1 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-colors disabled:opacity-40"
              >
                {fundingStatus === 'loading' ? 'REFRESHING…' : 'REFRESH'}
              </button>
              {fundingStatus === 'error' && (
                <span className="text-xs text-red-300">Failed to load wallet data.</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleViewToken('wmon')}
                className="pixel-font text-[10px] px-3 py-1 border border-white/20 rounded hover:bg-white/10 transition-colors"
              >
                VIEW WMON
              </button>
              <button
                type="button"
                onClick={() => handleViewToken('moon')}
                className="pixel-font text-[10px] px-3 py-1 border border-white/10 rounded hover:bg-white/10 transition-colors"
              >
                VIEW m00n
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.4em] text-[var(--moss-green)]">
              {presetConfig.amountLabel}
            </label>
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={lpClaimAmount}
              onChange={(event) => handleLpAmountChange(event.target.value)}
              placeholder={amountPlaceholder}
              className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 font-mono text-sm text-white focus:border-[var(--monad-purple)] focus:outline-none disabled:opacity-40"
              disabled={!walletReady || isSubmittingLpClaim}
            />
          </div>

          {/* Compact Quick Select - % and amounts in one row */}
          <div className="flex flex-wrap gap-1.5">
            {/* % of balance buttons - only show if wallet has balance */}
            {walletReady && inputBalanceWei !== null && inputBalanceWei > BigInt(0) && (
              <>
                {[25, 50, 100].map((pct) => {
                  const decimals =
                    inputTokenKey === 'wmon' ? tokenDecimals.wmon : tokenDecimals.moon;
                  const pctAmount = (inputBalanceWei * BigInt(pct)) / BigInt(100);
                  const pctAmountFormatted = formatUnits(pctAmount, decimals);
                  const pctAmountClean =
                    inputTokenKey === 'wmon'
                      ? parseFloat(pctAmountFormatted).toFixed(4)
                      : Math.floor(parseFloat(pctAmountFormatted)).toString();
                  const isActive = lpClaimAmount.trim() === pctAmountClean;
                  return (
                    <button
                      key={`pct-${pct}`}
                      type="button"
                      onClick={() => setLpClaimAmount(pctAmountClean)}
                      className={`px-2 py-1 text-[10px] font-bold rounded transition ${
                        isActive
                          ? 'bg-[var(--moss-green)] text-black'
                          : 'bg-white/10 text-white/60 hover:bg-[var(--moss-green)]/30'
                      }`}
                    >
                      {pct}%
                    </button>
                  );
                })}
                <span className="text-white/20 self-center">|</span>
              </>
            )}
            {/* Quick amounts */}
            {presetConfig.quickAmounts.map((choice) => {
              const isActive = lpClaimAmount.trim() === choice;
              const abbrev =
                Number(choice) >= 1000000
                  ? `${(Number(choice) / 1000000).toFixed(0)}M`
                  : Number(choice) >= 1000
                    ? `${(Number(choice) / 1000).toFixed(0)}K`
                    : choice;
              return (
                <button
                  key={`${lpClaimPreset}-quick-${choice}`}
                  type="button"
                  onClick={() => setLpClaimAmount(choice)}
                  className={`px-2 py-1 text-[10px] font-bold rounded transition ${
                    isActive
                      ? 'bg-[var(--monad-purple)] text-white'
                      : 'bg-white/10 text-white/60 hover:bg-[var(--monad-purple)]/30'
                  }`}
                >
                  {abbrev}
                </button>
              );
            })}
          </div>
          {fundingWarning && (
            <div className="rounded-lg border border-red-400/50 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {fundingWarning}
            </div>
          )}
          {lpClaimError && (
            <div className="rounded-lg border border-red-400/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {lpClaimError}
            </div>
          )}
          {lpDebugLog && (
            <div className="space-y-1 rounded-xl border border-white/10 bg-black/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">
                  LP DEBUG TRACE
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(lpDebugLog);
                      } catch {
                        // ignore clipboard failures; this is purely a debug helper
                      }
                    }}
                    className="text-[10px] text-white/40 hover:text-white/80 transition-colors"
                  >
                    COPY
                  </button>
                  <button
                    type="button"
                    onClick={() => setLpDebugLog('')}
                    className="text-[10px] text-white/40 hover:text-white/80 transition-colors"
                  >
                    CLEAR
                  </button>
                </div>
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-white/70">
                {lpDebugLog}
              </pre>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={primaryHandler}
              disabled={primaryDisabled}
              type="button"
              className="flex-1 rounded-xl bg-[var(--monad-purple)] px-4 py-3 text-sm font-semibold text-white transition-all disabled:opacity-40"
            >
              {primaryLabel}
            </button>
            <button
              onClick={handleCloseLpClaimModal}
              disabled={isSubmittingLpClaim}
              type="button"
              className="flex-1 rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/5 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--moss-green)]">
              NEED MATERIALS?
            </p>
            <p className="text-xs opacity-70">
              Use the Warpcast swapper to convert native MON into m00n (or WMON if you&apos;re
              balancing elsewhere) before joining the cabal. Swaps open in-place and you can adjust
              the details there.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => handleSwapMonToToken('wmon')}
                disabled={swapInFlight === 'wmon'}
                className="flex-1 rounded-xl border border-[var(--monad-purple)] px-4 py-3 text-sm font-semibold text-[var(--monad-purple)] hover:bg-[var(--monad-purple)] hover:text-white transition-colors disabled:opacity-40"
              >
                {swapInFlight === 'wmon' ? 'OPENING…' : 'Swap MON → WMON'}
              </button>
              <button
                type="button"
                onClick={() => handleSwapMonToToken('moon')}
                disabled={swapInFlight === 'moon'}
                className="flex-1 rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                {swapInFlight === 'moon' ? 'OPENING…' : 'Swap MON → m00n'}
              </button>
            </div>
          </div>
          <p className="text-xs opacity-60">
            Transaction executes via the Farcaster mini wallet. Unlocks the LP lounge once
            confirmed.
          </p>
        </div>
      </div>
    );
  };

  const repliesCount = airdropData?.replyCount ?? engagementData?.replyCount ?? 0;
  const tier = repliesCount ? getTierByReplyCount(repliesCount) : null;
  const replyGlow = useMemo(() => getReplyGlowConfig(repliesCount), [repliesCount]);
  const claimCountdown = useMemo(() => {
    const totalSeconds = Math.max(Math.floor(timeUntilClaimMs / 1000), 0);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
      totalSeconds,
      days,
      hours,
      minutes,
      seconds
    };
  }, [timeUntilClaimMs]);
  const countdownUnits = useMemo(
    () => [
      { label: 'DAYS', value: claimCountdown.days },
      { label: 'HOURS', value: claimCountdown.hours },
      { label: 'MINS', value: claimCountdown.minutes },
      { label: 'SECS', value: claimCountdown.seconds }
    ],
    [claimCountdown.days, claimCountdown.hours, claimCountdown.minutes, claimCountdown.seconds]
  );
  const formatCountdownValue = (value: number) => value.toString().padStart(2, '0');

  const handleShare = async () => {
    if (!airdropData?.eligible || !airdropData.amount || !userData) return;

    const baseText = `I'm part of the m00n cabal! Receiving ${formatAmount(
      airdropData.amount
    )} $m00n tokens 🌙✨`;
    const finalText = `${baseText}\n\n${SHARE_URL}`;

    await sdk.actions.composeCast({
      text: finalText,
      embeds: [SHARE_URL]
    });
  };

  const SHOW_LP_SOURCE_DIAGNOSTICS = false;

  const PANEL_CLASS = 'lunar-card px-6 py-5 text-white/90';

  const renderSessionCard = (fid?: number, wallet?: string | null, extraClass = '') => (
    <div className={`${PANEL_CLASS} grid grid-cols-1 gap-7 text-sm md:grid-cols-2 ${extraClass}`}>
      <div>
        <p className="lunar-heading">Connected FID</p>
        <p className="lunar-value font-mono">{fid ?? '—'}</p>
      </div>
      <div>
        <p className="lunar-heading">Wallet</p>
        <div className="flex items-center gap-3 font-mono text-base leading-tight">
          <span className="break-all text-white/80">
            {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '—'}
          </span>
          {wallet && (
            <button
              onClick={() => handleCopyWallet(wallet)}
              className="cta-ghost px-4 py-2 text-[10px] font-semibold tracking-[0.3em]"
            >
              {copiedWallet ? 'COPIED' : 'COPY'}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const getMoonPhase = (fillPercent: number): MoonPhase => {
    for (let i = MOON_PHASES.length - 1; i >= 0; i--) {
      if (fillPercent >= MOON_PHASES[i].threshold) {
        return MOON_PHASES[i];
      }
    }
    return MOON_PHASES[0];
  };

  const parseTokenAmount = (value?: string) => {
    if (!value) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getMoonMeterStats = (position: LpPosition) => {
    const price = Math.pow(1.0001, position.currentTick ?? 0);
    const token0Amount = parseTokenAmount(position.token0?.amountFormatted);
    const token1Amount = parseTokenAmount(position.token1?.amountFormatted);
    const token0ValueInToken1 = token0Amount * price;
    const totalValueInToken1 = token0ValueInToken1 + token1Amount;

    let convertedValue = 0;
    if (position.bandType === 'crash_band') {
      convertedValue = token0ValueInToken1;
    } else if (position.bandType === 'upside_band') {
      convertedValue = token1Amount;
    } else {
      convertedValue = Math.min(token0ValueInToken1, token1Amount);
    }

    const fillPercent =
      totalValueInToken1 > 0 ? Math.max(0, Math.min(1, convertedValue / totalValueInToken1)) : 0;

    return {
      fillPercent,
      phase: getMoonPhase(fillPercent)
    };
  };

  const renderMoonMeter = (position: LpPosition) => {
    const { fillPercent, phase } = getMoonMeterStats(position);
    const percentDisplay = Math.round(fillPercent * 100);
    const fillDegrees = fillPercent * 360;
    const accentColor =
      position.bandType === 'crash_band'
        ? '#ffd966'
        : position.bandType === 'upside_band'
          ? '#c7b5ff'
          : 'rgba(255,255,255,0.8)';

    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <div
          className="relative w-16 h-16 rounded-full border border-white/15 shadow-inner"
          style={{
            background: `conic-gradient(${accentColor} ${fillDegrees}deg, rgba(255,255,255,0.08) ${fillDegrees}deg)`
          }}
        >
          <div className="absolute inset-1 rounded-full bg-black/80 border border-white/5" />
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold flex items-center gap-2">
            <span>{phase.emoji}</span>
            {phase.label}
          </p>
          <p className="text-xs opacity-70">{percentDisplay}% synced</p>
          <div className="text-lg leading-none">
            {MOON_PHASES.map((moonPhase) => (
              <span
                key={moonPhase.label}
                className={moonPhase.label === phase.label ? 'opacity-100' : 'opacity-25'}
              >
                {moonPhase.emoji}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderPositionManager = ({
    title,
    subtitle,
    filter,
    allowFeeRefresh = true
  }: {
    title: string;
    subtitle?: string;
    filter?: 'crash_band' | 'upside_band';
    allowFeeRefresh?: boolean;
  }) => {
    const { token0TotalSupply, token0CirculatingSupply, poolWmonUsdPrice } = lpGateState;
    const positions = (lpGateState.lpPositions ?? []).filter((position) =>
      filter ? position.bandType === filter : true
    );
    const isLoadingPositions = lpGateState.lpStatus === 'CHECKING';
    if (isLoadingPositions) {
      return (
        <div className={`${PANEL_CLASS} flex items-center gap-3 text-sm text-white/70`}>
          <span className="loader-dot" />
          <span>Scanning for sigils in your wallet…</span>
        </div>
      );
    }
    if (positions.length === 0) {
      return null;
    }
    return (
      <div className={`${PANEL_CLASS} space-y-4`}>
        <div>
          <p className="text-lg font-semibold">{title}</p>
          {subtitle && <p className="text-sm opacity-70">{subtitle}</p>}
        </div>
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {positions.map((position) => (
            <div
              key={position.tokenId}
              className="border border-white/10 rounded-2xl p-4 space-y-3 bg-black/30"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">Sigil #{position.tokenId}</p>
                  <p className="text-xs opacity-70">
                    {describeBandTypeLabel(position.bandType)} · Tick {position.tickLower} →{' '}
                    {position.tickUpper}
                  </p>
                </div>
                <div className="text-right text-xs opacity-70 font-mono">
                  <p>{formatTokenDisplay(position.token0)}</p>
                  <p>{formatTokenDisplay(position.token1)}</p>
                </div>
              </div>
              {canAccessLpFeatures && allowFeeRefresh && (
                <div className="flex flex-wrap gap-3 items-center">
                  <button
                    type="button"
                    onClick={() => handleCheckLpFees(position.tokenId)}
                    disabled={position.feesStatus === 'loading'}
                    className="pixel-font text-[10px] tracking-[0.3em] px-4 py-2 border border-white/20 rounded-full uppercase disabled:opacity-50"
                  >
                    {position.feesStatus === 'loading'
                      ? 'CHECKING REWARDS…'
                      : position.fees
                        ? 'REFRESH REWARDS'
                        : 'CHECK REWARDS'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCollectLpFees(position.tokenId)}
                    disabled={
                      position.collectStatus === 'loading' ||
                      !position.fees ||
                      (position.fees &&
                        BigInt(position.fees.token0Wei || '0') === BigInt(0) &&
                        BigInt(position.fees.token1Wei || '0') === BigInt(0))
                    }
                    className="pixel-font text-[10px] tracking-[0.3em] px-4 py-2 border border-white/20 rounded-full uppercase disabled:opacity-50"
                  >
                    {position.collectStatus === 'loading' ? 'COLLECTING…' : 'COLLECT'}
                  </button>
                  {(() => {
                    // Compound requires both tokens when in-range
                    const hasToken0 = BigInt(position.fees?.token0Wei || '0') > BigInt(0);
                    const hasToken1 = BigInt(position.fees?.token1Wei || '0') > BigInt(0);
                    const isInRange = position.rangeStatus === 'in-range';
                    const canCompound = position.fees && ((hasToken0 && hasToken1) || !isInRange);
                    const noFees = !hasToken0 && !hasToken1;
                    const isCompounding =
                      position.compoundStatus && position.compoundStatus !== 'idle';
                    const isSuccess = position.compoundStatus === 'success';
                    const isError = position.compoundStatus === 'error';

                    return (
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleCompoundLpFees(position.tokenId)}
                          disabled={
                            position.collectStatus === 'loading' ||
                            isCompounding ||
                            !canCompound ||
                            noFees
                          }
                          title={
                            isInRange && !canCompound && !noFees
                              ? 'In-range positions need both tokens to compound'
                              : undefined
                          }
                          className={`pixel-font text-[10px] tracking-[0.3em] px-4 py-2 border rounded-full uppercase disabled:opacity-50 transition-all ${
                            isSuccess
                              ? 'border-[var(--moss-green)] bg-[var(--moss-green)] text-black'
                              : isError
                                ? 'border-red-400 text-red-400'
                                : 'border-[var(--moss-green)]/50 text-[var(--moss-green)] hover:bg-[var(--moss-green)]/20'
                          }`}
                        >
                          {isCompounding && !isSuccess && !isError
                            ? '...'
                            : isSuccess
                              ? '✓ DONE'
                              : 'COMPOUND ↻'}
                        </button>
                        {position.compoundStep && (
                          <span
                            className={`text-[8px] ${isError ? 'text-red-400' : isSuccess ? 'text-[var(--moss-green)]' : 'text-white/60'}`}
                          >
                            {position.compoundStep}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => handleRemoveLiquidity(position.tokenId)}
                    disabled={position.removeStatus === 'loading'}
                    className="pixel-font text-[10px] tracking-[0.3em] px-4 py-2 border border-red-400/50 text-red-400 rounded-full uppercase disabled:opacity-50"
                  >
                    {position.removeStatus === 'loading'
                      ? 'REMOVING…'
                      : position.removeStatus === 'success'
                        ? 'REMOVED ✓'
                        : 'REMOVE LP'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSharePosition(position)}
                    className="pixel-font text-[10px] tracking-[0.3em] px-4 py-2 border border-[#8c54ff]/50 text-[#8c54ff] rounded-full uppercase hover:bg-[#8c54ff]/10"
                  >
                    SHARE 🌙
                  </button>
                  {position.feesStatus === 'error' && (
                    <span className="text-xs text-red-400">
                      {position.feesError ?? 'Unable to load rewards'}
                    </span>
                  )}
                  {position.collectStatus === 'error' && (
                    <span className="text-xs text-red-400">
                      {position.collectError ?? 'Unable to collect rewards'}
                    </span>
                  )}
                  {position.removeStatus === 'error' && (
                    <span className="text-xs text-red-400">
                      {position.removeError ?? 'Unable to remove liquidity'}
                    </span>
                  )}
                </div>
              )}
              {position.fees && (
                <div className="rounded-2xl border border-white/5 bg-black/30 px-4 py-3 text-xs font-mono text-white/80 space-y-1">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-white/60">
                    Unclaimed fees
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <span>
                      {position.fees.token0Formatted}{' '}
                      {position.token0?.symbol ?? position.token0?.label ?? 'token0'}
                    </span>
                    <span>
                      {position.fees.token1Formatted}{' '}
                      {position.token1?.symbol ?? position.token1?.label ?? 'token1'}
                    </span>
                  </div>
                </div>
              )}
              {renderMoonMeter(position)}
              {(() => {
                const fdvRange = formatMarketCapRange(
                  position.priceLowerInToken1,
                  position.priceUpperInToken1,
                  token0TotalSupply,
                  poolWmonUsdPrice
                );
                const circRange = formatMarketCapRange(
                  position.priceLowerInToken1,
                  position.priceUpperInToken1,
                  token0CirculatingSupply,
                  poolWmonUsdPrice
                );
                if (fdvRange === '–' && circRange === '–') {
                  return null;
                }
                return (
                  <div className="text-[11px] uppercase tracking-[0.35em] text-white/70 space-y-1">
                    {fdvRange !== '–' && (
                      <p className="flex justify-between text-[10px] tracking-[0.25em]">
                        <span className="opacity-60">FDV</span>
                        <span>{fdvRange}</span>
                      </p>
                    )}
                    {circRange !== '–' && (
                      <p className="flex justify-between text-[10px] tracking-[0.25em]">
                        <span className="opacity-60">CIRC</span>
                        <span>{circRange}</span>
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSigilPreview = ({
    title = 'LP Sigils',
    subtitle,
    filter,
    limit = 2,
    emptyLabel,
    allowFeeRefresh = false
  }: {
    title?: string;
    subtitle?: string;
    filter?: 'crash_band' | 'upside_band';
    limit?: number;
    emptyLabel?: string;
    allowFeeRefresh?: boolean;
  }) => {
    const { token0TotalSupply, token0CirculatingSupply, poolWmonUsdPrice } = lpGateState;
    const allPositions = (lpGateState.lpPositions ?? []).filter((position) =>
      filter ? position.bandType === filter : true
    );

    if (lpGateState.lpStatus === 'CHECKING') {
      return (
        <div className={`${PANEL_CLASS} text-sm opacity-70 text-center`}>
          Scanning for sigils in your wallet…
        </div>
      );
    }

    if (allPositions.length === 0) {
      if (emptyLabel) {
        return <div className={`${PANEL_CLASS} text-sm opacity-70 text-center`}>{emptyLabel}</div>;
      }
      return (
        <div className={`${PANEL_CLASS} text-sm opacity-70 text-center`}>
          No sigils detected yet — try rescanning or deploy a new one.
        </div>
      );
    }

    const positions = allPositions.slice(0, limit);
    const extraCount = allPositions.length - positions.length;

    return (
      <div className={`${PANEL_CLASS} text-left space-y-3`}>
        <div>
          <p className="text-lg font-semibold">{title}</p>
          {subtitle && <p className="text-xs opacity-70">{subtitle}</p>}
        </div>
        {positions.map((position) => {
          const fdvRange = formatMarketCapRange(
            position.priceLowerInToken1,
            position.priceUpperInToken1,
            token0TotalSupply,
            poolWmonUsdPrice
          );
          const circRange = formatMarketCapRange(
            position.priceLowerInToken1,
            position.priceUpperInToken1,
            token0CirculatingSupply,
            poolWmonUsdPrice
          );
          return (
            <div key={position.tokenId} className="space-y-2 border border-white/5 rounded-2xl p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-semibold">Sigil #{position.tokenId}</p>
                  <p className="text-[11px] opacity-65">
                    Tick {position.tickLower} → {position.tickUpper}
                  </p>
                </div>
                <div className="text-right text-[11px] font-mono opacity-70">
                  <p>{formatTokenDisplay(position.token0)}</p>
                  <p>{formatTokenDisplay(position.token1)}</p>
                </div>
              </div>
              {allowFeeRefresh && (
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    onClick={() => handleCheckLpFees(position.tokenId)}
                    disabled={position.feesStatus === 'loading'}
                    className="pixel-font text-[8px] tracking-[0.3em] px-3 py-1.5 border border-white/15 rounded-full uppercase disabled:opacity-50"
                  >
                    {position.feesStatus === 'loading'
                      ? 'CHECKING…'
                      : position.fees
                        ? 'REFRESH REWARDS'
                        : 'CHECK REWARDS'}
                  </button>
                  {position.feesStatus === 'error' && (
                    <span className="text-[10px] text-red-400">
                      {position.feesError ?? 'Unable to load rewards'}
                    </span>
                  )}
                </div>
              )}
              {position.fees && (
                <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] font-mono text-white/80 space-y-1">
                  <p className="text-[9px] uppercase tracking-[0.35em] text-white/60">
                    Unclaimed fees
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <span>
                      {position.fees.token0Formatted}{' '}
                      {position.token0?.symbol ?? position.token0?.label ?? 'token0'}
                    </span>
                    <span>
                      {position.fees.token1Formatted}{' '}
                      {position.token1?.symbol ?? position.token1?.label ?? 'token1'}
                    </span>
                  </div>
                </div>
              )}
              {(fdvRange !== '–' || circRange !== '–') && (
                <div className="text-[10px] uppercase tracking-[0.35em] text-white/70 space-y-1">
                  {fdvRange !== '–' && (
                    <p className="flex justify-between">
                      <span className="opacity-55">FDV</span>
                      <span>{fdvRange}</span>
                    </p>
                  )}
                  {circRange !== '–' && (
                    <p className="flex justify-between">
                      <span className="opacity-55">CIRC</span>
                      <span>{circRange}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {extraCount > 0 && (
          <p className="text-[11px] uppercase tracking-[0.35em] opacity-60">
            +{extraCount} more sigils detected.
          </p>
        )}
      </div>
    );
  };

  const renderSigilScanGate = () =>
    renderShell(
      <div className="min-h-screen flex items-center justify-center p-6 relative z-10">
        <div className={`${PANEL_CLASS} text-center space-y-3`}>
          <p className="pixel-font text-2xl text-white">Calibrating your sigils…</p>
          <p className="text-sm text-white/70">
            We’re syncing your wallet positions to unlock the correct portal.
          </p>
          <div className="w-40 h-2 bg-white/10 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-[var(--monad-purple)] animate-pulse" />
          </div>
        </div>
      </div>
    );

  const renderLeaderboardVisualizer = (
    entries: LeaderboardEntry[] | undefined,
    { title, subtitle, emptyLabel }: { title: string; subtitle?: string; emptyLabel?: string }
  ) => {
    if (!entries) return null;
    if (entries.length === 0) {
      return (
        <div className={`${PANEL_CLASS} text-center text-sm opacity-70`}>
          {emptyLabel ?? 'No qualifying LP positions yet.'}
        </div>
      );
    }

    const maxValue = Math.max(...entries.map((entry) => entry.valueUsd));

    return (
      <div className={`${PANEL_CLASS} space-y-4 bg-black/60`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-semibold">{title}</p>
            {subtitle && <p className="text-sm opacity-70">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={refreshLeaderboard}
            className="self-start sm:self-auto pixel-font text-[10px] px-[5px] py-[5px] border border-white/20 rounded-full text-white hover:bg-white/10 transition-colors"
          >
            Refresh
          </button>
        </div>
        <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1 touch-pan-y">
          {entries.map((entry, index) => {
            const ratio = maxValue > 0 ? entry.valueUsd / maxValue : 0;
            const iconSize = 28 + ratio * 60;
            const resolvedLabel = entry.label ?? truncateAddress(entry.owner);
            return (
              <div
                key={`${entry.tokenId}-${entry.owner}`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/40 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="select-none"
                    style={{ fontSize: `${iconSize}px`, lineHeight: 1 }}
                    aria-hidden="true"
                  >
                    🌙
                  </span>
                  <div>
                    <p className="text-sm font-semibold">
                      #{index + 1} <span className="opacity-80">{resolvedLabel}</span>
                    </p>
                    <p className="text-xs opacity-60">{formatUsd(entry.valueUsd)}</p>
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-[0.4em] text-[var(--moss-green)]">
                  {entry.bandType?.replace('_', ' ') ?? ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderObservationLeaderboard = (
    key: string,
    entries: LeaderboardEntry[] | undefined,
    { title, subtitle }: { title: string; subtitle?: string }
  ) => {
    if (!entries || entries.length === 0) return null;
    const expanded = expandedLeaderboards[key] ?? false;
    const visibleEntries = expanded ? entries : entries.slice(0, 5);
    const maxValue = Math.max(...entries.map((entry) => entry.valueUsd));

    return (
      <div className={`${PANEL_CLASS} space-y-4 bg-black/60`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-semibold">{title}</p>
            {subtitle && <p className="text-sm opacity-70">{subtitle}</p>}
          </div>
          {entries.length > 5 && (
            <button
              type="button"
              onClick={() => setExpandedLeaderboards((prev) => ({ ...prev, [key]: !expanded }))}
              className="self-start sm:self-auto pixel-font text-[10px] px-[5px] py-[5px] border border-white/20 rounded-full text-white hover:bg-white/10 transition-colors"
            >
              {expanded ? 'Show Top 5' : `Show all ${entries.length}`}
            </button>
          )}
        </div>
        <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1 touch-pan-y">
          {visibleEntries.map((entry, index) => {
            const ratio = maxValue > 0 ? entry.valueUsd / maxValue : 0;
            const iconSize = 28 + ratio * 60;
            const resolvedLabel = entry.label ?? truncateAddress(entry.owner);
            return (
              <div
                key={`${key}-${entry.tokenId}-${entry.owner}`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/40 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="select-none"
                    style={{ fontSize: `${iconSize}px`, lineHeight: 1 }}
                    aria-hidden="true"
                  >
                    🌙
                  </span>
                  <div>
                    <p className="text-sm font-semibold">
                      #{index + 1} <span className="opacity-80">{resolvedLabel}</span>
                    </p>
                    <p className="text-xs opacity-60">{formatUsd(entry.valueUsd)}</p>
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-[0.4em] text-[var(--moss-green)]">
                  {entry.bandType?.replace('_', ' ') ?? ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Streak Leaderboard Renderer
  const renderStreakLeaderboard = () => {
    if (streakLeaderboardStatus === 'loading') {
      return (
        <div className={`${PANEL_CLASS} animate-pulse bg-black/60`}>
          <div className="h-6 bg-white/10 rounded w-48 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-white/10 rounded-2xl" />
            ))}
          </div>
        </div>
      );
    }

    if (streakLeaderboardStatus === 'error' || !streakLeaderboardData) {
      return (
        <div className={`${PANEL_CLASS} text-center text-sm opacity-70 bg-black/60`}>
          <p>Streak data not available yet.</p>
          <button
            type="button"
            onClick={refreshStreakLeaderboard}
            className="mt-2 text-[var(--moss-green)] underline"
          >
            Try again
          </button>
        </div>
      );
    }

    const { entries, totalPositionsTracked, lastCheckAt } = streakLeaderboardData;

    // Find max streak for sizing
    const allEntries = entries ?? [];
    const maxStreak = Math.max(
      ...allEntries.map((e) => e.currentStreakDuration ?? 0),
      ...allEntries.map((e) => e.longestStreakDuration ?? 0),
      1
    );

    const renderStreakEntry = (
      entry: StreakLeaderboardEntry,
      index: number,
      type: 'current' | 'allTime' | 'points'
    ) => {
      const duration =
        type === 'allTime' ? entry.longestStreakDuration : entry.currentStreakDuration;
      const ratio = maxStreak > 0 ? duration / maxStreak : 0;
      const fireSize = 20 + ratio * 24;
      const resolvedLabel = entry.label ?? truncateAddress(entry.owner);
      const abbreviatedAddr = truncateAddress(entry.owner);

      // Streak tier colors
      const days = duration / 86400;
      let tierColor = 'var(--moss-green)';
      let tierEmoji = '🔥';
      if (days >= 7) {
        tierColor = '#ffd700'; // Gold
        tierEmoji = '👑';
      } else if (days >= 3) {
        tierColor = '#c0c0c0'; // Silver
        tierEmoji = '⭐';
      } else if (days >= 1) {
        tierColor = '#cd7f32'; // Bronze
        tierEmoji = '🔥';
      }

      return (
        <div
          key={`streak-${type}-${entry.tokenId}`}
          className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className="select-none flex-shrink-0"
              style={{ fontSize: `${fireSize}px`, lineHeight: 1 }}
              aria-hidden="true"
            >
              {tierEmoji}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">#{index + 1}</span>
                <span className="text-sm opacity-90 truncate">{resolvedLabel}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] opacity-60">
                <span className="font-mono">{abbreviatedAddr}</span>
                {entry.valueUsd ? <span>• {formatUsd(entry.valueUsd)}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            {/* Points display - primary metric */}
            <span className="text-sm font-bold" style={{ color: tierColor }}>
              {entry.points?.toLocaleString() ?? 0} pts
            </span>
            <span className="text-[10px]">
              {entry.isCurrentlyInRange ? (
                <span className="text-[var(--moss-green)]">🟢 In Range</span>
              ) : (
                <span className="text-white/50">⚪ Out</span>
              )}
            </span>
          </div>
        </div>
      );
    };

    // Sort all entries by points for unified leaderboard
    const allEntriesByPoints = [...(entries ?? [])]
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
      .slice(0, 10);

    return (
      <div className={`${PANEL_CLASS} space-y-4 bg-black/60`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-bold">🏆 Points Leaderboard</p>
            <p className="text-[10px] opacity-60">
              {totalPositionsTracked} positions • Updated{' '}
              {new Date(lastCheckAt).toLocaleTimeString()}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshStreakLeaderboard}
            className="self-start sm:self-auto pixel-font text-[10px] px-3 py-1 border border-white/20 rounded-full text-white hover:bg-white/10 transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Unified Points Leaderboard */}
        {allEntriesByPoints.length > 0 ? (
          <div className="space-y-2">
            {allEntriesByPoints.map((entry, index) => renderStreakEntry(entry, index, 'points'))}
          </div>
        ) : (
          <p className="text-sm opacity-50 text-center py-4">No qualifying positions yet</p>
        )}

        {/* Points breakdown legend */}
        <div className="text-[10px] opacity-40 text-center pt-2 border-t border-white/10">
          <p>50% value + 30% streak + 20% time</p>
          <p className="mt-1">× In-range bonus × Yap multiplier</p>
        </div>
      </div>
    );
  };

  // Season 1 Rewards Panel
  const renderSeason1Panel = () => {
    if (tokenomicsStatus === 'loading') {
      return (
        <div className={`${PANEL_CLASS} animate-pulse bg-black/60`}>
          <div className="h-6 bg-white/10 rounded w-48 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-white/10 rounded-xl" />
            ))}
          </div>
        </div>
      );
    }

    if (tokenomicsStatus === 'error' || !tokenomicsData) {
      return null; // Don't show if no data
    }

    const { userAllocation, currentSeason } = tokenomicsData;

    if (!currentSeason) return null;

    const positionCount = lpGateState.lpPositions?.length ?? 0;

    return (
      <div className={`${PANEL_CLASS} space-y-3 bg-black/60`}>
        {/* Header - More Compact */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">⛏️ Season {currentSeason.number}</p>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-[var(--moss-green)]/20 text-[var(--moss-green)]">
            {currentSeason.status}
          </span>
        </div>

        {/* User Stats or CTA */}
        {positionCount > 0 ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-black/40 rounded-lg p-2">
              <p className="text-sm font-bold text-[var(--monad-purple)]">
                {userAllocation?.formattedPoints ?? '—'}
              </p>
              <p className="text-[8px] opacity-50">Points</p>
            </div>
            <div className="bg-black/40 rounded-lg p-2">
              <p className="text-sm font-bold">#{userAllocation?.rank ?? '—'}</p>
              <p className="text-[8px] opacity-50">Rank</p>
            </div>
            <div className="bg-black/40 rounded-lg p-2">
              <p className="text-sm font-bold">{positionCount}</p>
              <p className="text-[8px] opacity-50">LPs</p>
            </div>
          </div>
        ) : (
          <div className="bg-black/40 rounded-xl p-3 border border-white/10 text-center space-y-2">
            <p className="text-xs opacity-70">No qualifying LP positions</p>
            <p className="text-[10px] opacity-50">
              Deploy an LP with &gt;$5 value to start earning
            </p>
            <button
              type="button"
              onClick={handleOpenAdvancedLp}
              className="text-xs px-4 py-1.5 bg-[var(--monad-purple)] text-white rounded-lg"
            >
              🫡 Deploy LP
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderLpGateInlineButton = () => (
    <div className="flex flex-wrap gap-2 justify-center">
      <button
        type="button"
        onClick={handleOpenLpGate}
        className="cta-ghost text-[10px] tracking-[0.3em] px-6 py-3"
      >
        LP MANAGER
      </button>
      <button
        type="button"
        onClick={handleOpenAdvancedLp}
        className="cta-ghost text-[10px] tracking-[0.3em] px-6 py-3 border-[var(--monad-purple)] text-[var(--monad-purple)]"
      >
        ADVANCED LP
      </button>
    </div>
  );

  const renderLpDiagnostics = () => {
    if (!SHOW_LP_SOURCE_DIAGNOSTICS || !lpGateState.walletAddress) return null;

    const diagnostics = {
      wallet: lpGateState.walletAddress,
      status: lpGateState.lpStatus,
      hasLpFromOnchain: lpGateState.hasLpFromOnchain ?? null,
      hasLpFromSubgraph: lpGateState.hasLpFromSubgraph ?? null,
      indexerPositionCount: lpGateState.indexerPositionCount ?? null,
      poolCurrentTick: lpGateState.poolCurrentTick ?? null,
      poolSqrtPriceX96: lpGateState.poolSqrtPriceX96 ?? null,
      wmonUsdPrice: lpGateState.poolWmonUsdPrice ?? null,
      lpPositionsLength: lpGateState.lpPositions?.length ?? 0,
      timestamp: new Date().toISOString()
    };

    return (
      <div className={`${PANEL_CLASS} text-left text-[10px] font-mono space-y-1`}>
        <p className="text-[var(--moss-green)] tracking-[0.3em] uppercase text-[9px]">
          LP SOURCE DIAG
        </p>
        {Object.entries(diagnostics).map(([key, value]) => (
          <div key={key} className="flex justify-between gap-4">
            <span className="opacity-60">{key}</span>
            <span>{String(value)}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderLpGatePanel = () => {
    const { lpStatus, walletAddress, lpPositions } = lpGateState;
    const truncatedWallet = truncateAddress(walletAddress);
    const positionCount = lpPositions?.length ?? 0;
    const copy = getPersonaCopy({
      persona: 'lp_gate',
      lpState: { status: lpStatus, positionCount }
    });
    const showLoader = lpStatus === 'CHECKING';

    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
        <div className="max-w-2xl w-full space-y-6 text-center scanline bg-black/45 border border-[var(--monad-purple)] rounded-3xl px-8 py-10">
          <div className="flex justify-center">
            <NeonHaloLogo size={140} />
          </div>
          <h1 className="pixel-font text-2xl glow-purple">{copy.title}</h1>
          {renderCopyBody(copy.body)}
          {truncatedWallet && lpStatus === 'HAS_LP' && (
            <p className="text-xs opacity-60">Wallet: {truncatedWallet}</p>
          )}
          {showLoader && (
            <div className="flex justify-center">
              <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-[var(--monad-purple)] animate-pulse" />
              </div>
            </div>
          )}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={refreshPersonalSigils}
              disabled={lpStatus === 'CHECKING'}
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/70 hover:bg-white/10 disabled:opacity-40"
            >
              <span className="inline-block h-1 w-1 rounded-full bg-[var(--moss-green)]" />
              Rescan LP sigils
            </button>
          </div>
          {renderPersonaCtas(copy, { disablePrimary: lpStatus === 'CHECKING' })}
          {renderSigilPreview({
            title: 'LP Sigils',
            subtitle: 'Sigils currently gating this portal.',
            limit: 2,
            allowFeeRefresh: canAccessLpFeatures
          })}
          <div className="text-xs opacity-60">
            Need help?{' '}
            <button onClick={handleOpenLpHelp} className="underline hover:text-white transition">
              LP Guide
            </button>
          </div>
          {renderLpDiagnostics()}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleCloseLpPortal}
              className="pixel-font text-xs px-4 py-2 border border-white/25 rounded-full hover:bg-white/10 transition-colors"
            >
              Back to live state
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderLpLoungePanel = () => {
    const positionCount = lpGateState.lpPositions?.length ?? 0;
    const hasLp = lpGateState.lpStatus === 'HAS_LP';
    const displayCount = positionCount > 0 ? positionCount : hasLp ? 1 : 0;

    // Debug signal separation for LP source mismatch (indexer vs on-chain)
    console.log('LP_LOUNGE_DEBUG', {
      lpStatus: lpGateState.lpStatus,
      hasLpFromOnchain: lpGateState.hasLpFromOnchain,
      hasLpFromSubgraph: lpGateState.hasLpFromSubgraph,
      indexerPositionCount: lpGateState.indexerPositionCount,
      lpPositionCount: positionCount
    });

    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-4xl w-full space-y-8 scanline bg-black/50 border border-[var(--monad-purple)] rounded-3xl px-10 py-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <NeonHaloLogo size={150} />
            <div className="text-right">
              <p className="pixel-font text-sm tracking-[0.5em] text-[var(--moss-green)]">
                LP LOUNGE
              </p>
              <p className="text-xs opacity-70">
                {displayCount} active {displayCount === 1 ? 'sigil' : 'sigils'}
              </p>
              {typeof lpGateState.poolCurrentTick === 'number' && (
                <p className="text-[11px] opacity-60">
                  Pool tick: {lpGateState.poolCurrentTick}{' '}
                  {lpGateState.poolSqrtPriceX96
                    ? `| √P: ${lpGateState.poolSqrtPriceX96.slice(0, 8)}…`
                    : null}
                </p>
              )}
              {lpGateState.poolWmonUsdPrice && (
                <p className="text-[11px] opacity-60">
                  1 WMON ≈ ${lpGateState.poolWmonUsdPrice.toFixed(4)}
                </p>
              )}
            </div>
          </div>

          {renderPositionManager({
            title: 'Your cabal sigils',
            subtitle: 'Band type updates live as price moves through your ticks.'
          })}

          {positionCount === 0 && hasLp && (
            <div className={`${PANEL_CLASS} text-left text-xs opacity-75`}>
              {lpGateState.hasLpFromSubgraph
                ? "We detected at least one LP sigil on-chain, but metadata hasn't loaded yet. You're through the gate—tap “Rescan LP sigils” if you just minted."
                : "Indexer lag: on-chain proves you have a sigil, but the subgraph hasn't caught up yet. You're still through the gate—rescan in a moment."}
            </div>
          )}

          {renderLpDiagnostics()}

          <div className="flex justify-end">
            <div className="flex flex-wrap gap-3 justify-center">
              <button
                onClick={() => setLpPortalMode('gate')}
                className="pixel-font text-xs px-4 py-2 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-colors"
              >
                Back to gate
              </button>
              <button
                onClick={handleCloseLpPortal}
                className="pixel-font text-xs px-4 py-2 border border-white/25 rounded hover:bg-white/10 transition-colors"
              >
                Exit to live state
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderClaimedSoldPortal = () => {
    const copy = getPersonaCopy({ persona: 'claimed_sold' });
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-2xl w-full text-center space-y-6 scanline bg-black/55 border border-red-600 rounded-3xl px-8 py-12">
          <div className="flex justify-center">
            <NeonHaloLogo size={140} />
          </div>
          <h1 className="pixel-font text-3xl text-red-500">{copy.title}</h1>
          {renderCopyBody(copy.body)}
          {renderPersonaCtas(copy)}
          <div className="w-full">{renderBalanceButtons()}</div>
        </div>
      </div>
    );
  };

  const renderPersonaStatsCard = () => {
    if (!personaRecord) return null;
    const formatStat = (value?: number | null) => {
      return formatCompactNumber(value);
    };
    const badgeCopy = PERSONA_BADGE_COPY[personaBadge];

    return (
      <div className={`${PANEL_CLASS} space-y-3 text-left`}>
        <p className="text-xs uppercase tracking-[0.4em] text-[var(--moss-green)]">Cabal dossier</p>
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-[10px] uppercase tracking-[0.35em] text-white/60 mb-1">Persona</p>
          <p className="font-mono text-xl text-white">{badgeCopy.label}</p>
          <p className="text-xs opacity-70 mt-1 leading-relaxed">{badgeCopy.description}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="opacity-60">Replies logged</p>
            <p className="font-mono text-lg">{formatStat(personaRecord.replyCount)}</p>
          </div>
          <div>
            <p className="opacity-60">Estimated balance</p>
            <p className="font-mono text-lg">
              {formatStat(personaRecord.totalEstimatedBalance)} m00n
            </p>
          </div>
          <div>
            <p className="opacity-60">Combined flow</p>
            <p className="font-mono text-lg">
              {formatStat((personaRecord.totalPurchased ?? 0) + (personaRecord.totalSold ?? 0))}{' '}
              m00n
            </p>
          </div>
          <div>
            <p className="opacity-60">Primary wallet</p>
            <p className="font-mono text-lg">
              {primaryAddressMoonBalanceWei
                ? `${formatAmountDisplay(formatUnits(primaryAddressMoonBalanceWei, 18))} m00n`
                : '—'}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderClaimedHeldPortal = () => {
    const preset = LP_PRESET_CONTENT.moon_upside;
    const showManager = hasAnyLp;
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-4xl w-full space-y-8 scanline bg-black/45 border border-[var(--monad-purple)] rounded-3xl px-8 py-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <NeonHaloLogo size={140} />
            <div className="text-right">
              <p className="pixel-font text-sm tracking-[0.5em] text-[var(--moss-green)]">
                THE ONES WHO CAME ANYWAY
              </p>
              <p className="text-xs opacity-70">m00n-only ladder ~20% above tick</p>
            </div>
          </div>
          <div className="flex justify-end">{renderLpGateInlineButton()}</div>
          <div className="grid md:grid-cols-2 gap-6 items-start">
            <div className={`${PANEL_CLASS} space-y-4`}>
              <div>
                <p className="text-lg font-semibold text-white">{preset.title}</p>
                <p className="text-sm opacity-80">{preset.description}</p>
              </div>
              <ul className="list-disc list-inside text-sm opacity-85 space-y-2">
                <li>Band snaps to ~1.2× → 5× current tick (m00n-only input).</li>
                <li>Pumps stream value into WMON without touching downside liquidity.</li>
                <li>Modal enforces Permit2 approvals + 5% slippage guardrails.</li>
                <li>Transaction ships via the Farcaster mini wallet on Monad.</li>
              </ul>
            </div>
            {renderPersonaStatsCard()}
          </div>
          {renderSigilPreview({
            title: 'Sky Ladder Sigils',
            subtitle: 'Single-sided upside bands already on-chain.',
            filter: 'upside_band',
            limit: 3,
            emptyLabel: 'No upside sigils yet — deploy one to unlock this panel.',
            allowFeeRefresh: canAccessLpFeatures
          })}
          {showManager ? (
            renderPositionManager({
              title: 'Holder Band Manager',
              subtitle: 'Monitor your single-sided ladder from 1.2× up to 5× spot.',
              filter: 'upside_band',
              allowFeeRefresh: true
            })
          ) : (
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                type="button"
                onClick={() => handleOpenLpClaimModal('moon_upside')}
                className="pixel-font px-6 py-3 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-colors"
              >
                DEPLOY SKY LADDER
              </button>
              <button
                type="button"
                onClick={() => handleSwapMonToToken('moon')}
                disabled={swapInFlight === 'moon'}
                className="pixel-font px-6 py-3 border border-[var(--moss-green)] text-[var(--moss-green)] rounded-lg hover:bg-[var(--moss-green)] hover:text-black transition-colors disabled:opacity-40"
              >
                {swapInFlight === 'moon' ? 'SWAPPING…' : 'BUY MORE m00n'}
              </button>
              {canAccessLpFeatures && (
                <button
                  type="button"
                  onClick={handleOpenLpGate}
                  className="pixel-font px-6 py-3 border border-white/20 text-white rounded-lg hover:bg-white/10 transition-colors"
                >
                  OPEN LP LOUNGE
                </button>
              )}
            </div>
          )}
          <div className="flex justify-end">{renderLpGateInlineButton()}</div>
          {leaderboardStatus === 'loaded' && leaderboardData
            ? renderLeaderboardVisualizer(leaderboardData.upsideBand, {
                title: 'Sky Ladder Leaderboard',
                subtitle: 'Top single-sided m00n positions across all wallets.'
              })
            : null}
        </div>
      </div>
    );
  };

  const renderClaimedBoughtMorePortal = () => {
    const preset = LP_PRESET_CONTENT.backstop;
    const showManager = hasAnyLp;
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-4xl w-full space-y-8 scanline bg-black/45 border border-white/20 rounded-3xl px-8 py-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-200 via-pink-200 to-white blur-2xl opacity-80" />
              <div>
                <p className="pixel-font text-lg text-white">{preset.title}</p>
                <p className="text-xs opacity-70">Crash-backstop preset</p>
              </div>
            </div>
            <div className="text-right">
              <p className="pixel-font text-sm tracking-[0.5em] text-[var(--moss-green)]">
                THE ONES WHO DOUBLED DOWN
              </p>
              <p className="text-xs opacity-70">WMON crash band ~20% below tick</p>
            </div>
          </div>
          <div className="flex justify-end">{renderLpGateInlineButton()}</div>
          <div className="grid md:grid-cols-2 gap-6 items-start">
            <div className={`${PANEL_CLASS} space-y-4 text-left`}>
              <p className="text-sm opacity-85">{preset.description}</p>
              <ul className="list-disc list-inside text-sm opacity-85 space-y-2">
                <li>Band hovers ~10% under spot across 6× tick spacing.</li>
                <li>Input asset WMON; backend computes any required m00n.</li>
                <li>Permit2 approvals stay per-asset—never unlimited.</li>
                <li>Debugger panel lets you copy the exact viem payload.</li>
              </ul>
            </div>
            {renderPersonaStatsCard()}
          </div>
          {renderSigilPreview({
            title: 'Crash Backstop Sigils',
            subtitle: 'WMON single-sided bands staged beneath spot.',
            filter: 'crash_band',
            limit: 3,
            emptyLabel: 'No crash bands yet — deploy one to anchor the downside.',
            allowFeeRefresh: canAccessLpFeatures
          })}
          {showManager ? (
            renderPositionManager({
              title: 'Crash Band Manager',
              subtitle: 'Scales WMON into m00n ~10% beneath the current tick.',
              filter: 'crash_band',
              allowFeeRefresh: true
            })
          ) : (
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                type="button"
                onClick={() => handleOpenLpClaimModal('backstop')}
                className="pixel-font px-6 py-3 bg-white/15 text-white rounded-lg hover:bg-white/25 transition-colors"
              >
                DEPLOY CRASH BACKSTOP
              </button>
              <button
                type="button"
                onClick={() => handleSwapMonToToken('wmon')}
                disabled={swapInFlight === 'wmon'}
                className="pixel-font px-6 py-3 border border-white/30 text-white rounded-lg hover:bg-white/10 transition-colors disabled:opacity-40"
              >
                {swapInFlight === 'wmon' ? 'SWAPPING…' : 'BUY MORE WMON'}
              </button>
              {canAccessLpFeatures && (
                <button
                  type="button"
                  onClick={handleOpenLpGate}
                  className="pixel-font px-6 py-3 border border-white/30 text-white rounded-lg hover:bg-white/10 transition-colors"
                >
                  OPEN LP LOUNGE
                </button>
              )}
            </div>
          )}
          <div className="flex justify-end">{renderLpGateInlineButton()}</div>
          {leaderboardStatus === 'loaded' && leaderboardData
            ? renderLeaderboardVisualizer(leaderboardData.crashBand, {
                title: 'Crash Backstop Leaderboard',
                subtitle: 'Top WMON single-sided bands keeping the floor alive.'
              })
            : null}
        </div>
      </div>
    );
  };

  const renderObservationDeckPortal = () => {
    if (lpGateState.lpStatus === 'CHECKING') {
      return renderSigilScanGate();
    }
    const updatedStamp =
      solarSystemStatus === 'loaded' && solarSystemData?.updatedAt
        ? new Date(solarSystemData.updatedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })
        : null;
    const personaCopy = PERSONA_BADGE_COPY[personaBadge];
    const moonBalanceDisplay = primaryAddressMoonBalanceWei
      ? formatAmountDisplay(formatUnits(primaryAddressMoonBalanceWei, 18))
      : '0';
    const walletLabel = balanceProbeAddress ? truncateAddress(balanceProbeAddress) : null;
    const deckStatusLabel = observationDeckEligible
      ? 'Deck access unlocked'
      : 'Hold ≥ 1M m00n on this wallet to unlock VIP telemetry';
    const deckStatusTone = observationDeckEligible ? 'text-[var(--moss-green)]' : 'text-yellow-300';
    if (!preferredBand) {
      return renderShell(
        <div className="min-h-screen flex items-center justify-center p-6 relative z-10">
          <div className={`${PANEL_CLASS} text-center space-y-2`}>
            <p className="pixel-font text-xl">Calibrating persona</p>
            <p className="text-sm text-white/70">Synchronizing cabal dossier…</p>
          </div>
        </div>
      );
    }

    const bandCopy =
      preferredBand === 'crash_band'
        ? {
            title: 'Crash Band Console',
            subtitle: 'Deploy or monitor WMON crash backstops.'
          }
        : {
            title: 'Sky Band Console',
            subtitle: 'Stagger m00n ladders up to the heavens.'
          };
    const deckLeaderboardEntries =
      leaderboardStatus === 'loaded'
        ? preferredBand === 'crash_band'
          ? leaderboardData?.crashBand
          : leaderboardData?.upsideBand
        : undefined;
    const canRefreshTelemetry = isAdmin;

    const renderSolarSystem = () => {
      if (solarSystemStatus === 'loaded' && activeSolarPositions.length) {
        return (
          <div className="flex w-full justify-center">
            <M00nSolarSystem
              positions={activeSolarPositions}
              width={solarCanvasSize}
              height={solarCanvasSize}
            />
          </div>
        );
      }
      if (solarSystemStatus === 'empty') {
        return (
          <div className={`${PANEL_CLASS} text-center text-sm text-white/70`}>
            Solar telemetry snapshot came back empty. Control is rebuilding the sigil index — tap
            REFRESH TELEMETRY to retry.
          </div>
        );
      }
      if (solarSystemStatus === 'error') {
        return (
          <div className={`${PANEL_CLASS} text-center text-sm text-red-300`}>
            Solar telemetry unavailable right now — tap REFRESH TELEMETRY to retry.
          </div>
        );
      }
      return (
        <div className={`${PANEL_CLASS} text-center text-sm opacity-70`}>
          Calibrating orbital tracks… hang tight or tap REFRESH TELEMETRY.
        </div>
      );
    };

    const renderBandActions = (band: 'crash_band' | 'upside_band') => {
      if (!canAccessLpFeatures) {
        return null;
      }
      const isCrash = band === 'crash_band';
      const isCurrentBand = band === preferredBand;
      return (
        <div className={`${PANEL_CLASS} flex flex-wrap items-center gap-3`}>
          {!hasAnyLp && (
            <button
              type="button"
              onClick={() => handleOpenLpClaimModal(isCrash ? 'backstop' : 'moon_upside')}
              disabled={!isCurrentBand}
              className="pixel-font px-5 py-3 border border-white/20 rounded-2xl text-xs tracking-[0.35em] hover:bg-white/10 transition-colors"
            >
              {isCrash ? 'DEPLOY CRASH BAND' : 'DEPLOY SKY BAND'}
            </button>
          )}
          <button
            type="button"
            onClick={handleOpenLpGate}
            className="pixel-font px-5 py-3 border border-white/20 rounded-2xl text-xs tracking-[0.35em] hover:bg-white/10 transition-colors"
          >
            OPEN LP LOUNGE
          </button>
        </div>
      );
    };

    const renderBandInventory = (band: 'crash_band' | 'upside_band') => {
      if (!canAccessLpFeatures) {
        return null;
      }
      return (
        <>
          {renderBandActions(band)}
          {hasAnyLp && (
            <>
              <div
                className={`${PANEL_CLASS} flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between`}
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-white/60">Sigil manager</p>
                  <p className="text-sm opacity-75">
                    Toggle the live positions powering your access.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSigilManagerVisible((prev) => !prev)}
                  className="pixel-font px-5 py-2 border border-white/25 rounded-full text-xs tracking-[0.35em] hover:bg-white/10 transition-colors"
                >
                  {isSigilManagerVisible ? 'HIDE SIGILS' : 'SHOW SIGILS'}
                </button>
              </div>
              {isSigilManagerVisible &&
                renderPositionManager({
                  title: band === 'crash_band' ? 'Crash Band Manager' : 'Sky Band Manager',
                  subtitle:
                    band === 'crash_band'
                      ? 'Scale WMON into m00n roughly −10% from spot.'
                      : 'Scale m00n into WMON from 1.2× to 5× spot.',
                  filter: band
                })}
            </>
          )}
        </>
      );
    };

    return renderShell(
      <div className="min-h-screen w-full flex flex-col items-center justify-start gap-6 p-4 pb-24 relative z-10">
        <div className="max-w-5xl w-full space-y-6 scanline bg-black/40 border border-white/15 rounded-3xl px-6 py-8">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCloseObservationDeck}
              className="pixel-font px-4 py-2 border border-white/20 rounded-full text-[10px] tracking-[0.4em] text-white hover:bg-white/10 transition-colors"
            >
              EXIT LIVE STATE
            </button>
          </div>
          <div className="text-center space-y-2">
            <p className="pixel-font text-2xl text-white">Observation Deck</p>
            <p className="text-sm opacity-75">
              The deck is live — broadcasting the m00n LP solar system telemetry in real time.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className={`${PANEL_CLASS} space-y-2`}>
              <p className="text-xs uppercase tracking-[0.4em] text-white/60">Persona</p>
              <p className="text-lg font-semibold">{personaCopy.label}</p>
              <p className="text-sm opacity-80">{personaCopy.description}</p>
            </div>
            <div className={`${PANEL_CLASS} space-y-2`}>
              <p className="text-xs uppercase tracking-[0.4em] text-white/60">Replies logged</p>
              <p className="text-3xl font-mono">{repliesCount}</p>
              <p className="text-xs opacity-70">Synced from Warpcast channel activity</p>
            </div>
            <div className={`${PANEL_CLASS} space-y-2`}>
              <p className="text-xs uppercase tracking-[0.4em] text-white/60">Connected wallet</p>
              <p className="text-lg font-semibold">{walletLabel ?? 'Wallet pending'}</p>
              <p className="text-sm">
                <span className="font-mono text-xl">{moonBalanceDisplay}</span>
                <span className="text-xs uppercase tracking-[0.35em] text-white/70 ml-2">m00n</span>
              </p>
              <p className={`text-xs ${deckStatusTone}`}>{deckStatusLabel}</p>
            </div>
          </div>
          <div
            className={`${PANEL_CLASS} flex flex-col gap-3 text-[11px] uppercase tracking-[0.35em] text-white/70`}
          >
            <span>
              {updatedStamp
                ? `Snapshot synced at ${updatedStamp}`
                : 'Snapshot pending — refresh to fetch telemetry.'}
            </span>
            {totalSolarNotionalUsd !== null && (
              <span>Total LP notional • {formatUsd(totalSolarNotionalUsd)}</span>
            )}
            <div className="flex flex-wrap gap-2">
              {canRefreshTelemetry && (
                <button
                  type="button"
                  onClick={handleRefreshTelemetry}
                  className="pixel-font px-[5px] py-[5px] rounded-full border border-white/30 text-white hover:bg-white/10 transition-colors"
                >
                  REFRESH TELEMETRY
                </button>
              )}
              <button
                type="button"
                onClick={refreshPersonalSigils}
                className="pixel-font px-[5px] py-[5px] rounded-full border border-[var(--monad-purple)] text-[var(--monad-purple)] hover:bg-[var(--monad-purple)] hover:text-black transition-colors"
              >
                RESCAN SIGILS
              </button>
            </div>
          </div>
          {renderSolarSystem()}
          {canAccessLpFeatures ? (
            <>
              <div className={`${PANEL_CLASS} space-y-1`}>
                <p className="text-xs uppercase tracking-[0.4em] text-white/60">{bandCopy.title}</p>
                <p className="text-sm opacity-75">{bandCopy.subtitle}</p>
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleOpenLpGate}
                    className="pixel-font px-5 py-2 border border-white/20 rounded-full text-xs tracking-[0.35em] hover:bg-white/10 transition-colors"
                  >
                    LP MANAGER
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenAdvancedLp}
                    className="pixel-font px-5 py-2 border border-[var(--monad-purple)] text-[var(--monad-purple)] rounded-full text-xs tracking-[0.35em] hover:bg-[var(--monad-purple)] hover:text-black transition-colors"
                  >
                    ADVANCED LP
                  </button>
                </div>
                <div className="space-y-4">{renderBandInventory(preferredBand)}</div>
              </div>
            </>
          ) : (
            <div className={`${PANEL_CLASS} text-center space-y-2`}>
              <p className="text-sm text-white/80">
                View-only telemetry unlocked. Moon Boys & Keepers can deploy crash/sky bands from
                this module.
              </p>
              <p className="text-[11px] uppercase tracking-[0.35em] text-white/60">
                Earn LP sigils to unlock deployment controls.
              </p>
              <div className="flex justify-center">{renderLpGateInlineButton()}</div>
            </div>
          )}
          {renderObservationLeaderboard(`deck-${preferredBand}`, deckLeaderboardEntries, {
            title:
              preferredBand === 'crash_band' ? 'Crash Band Leaderboard' : 'Sky Band Leaderboard',
            subtitle:
              preferredBand === 'crash_band'
                ? 'Top WMON crash backstops in the Monad pool.'
                : 'Top m00n ladders pushing the upside.'
          })}
          {/* Streak Leaderboard */}
          {renderStreakLeaderboard()}
          {/* Season 1 Rewards Panel */}
          {renderSeason1Panel()}
          {personaLookupStatus === 'loading' && (
            <p className="text-center text-xs text-yellow-300">Syncing cabal dossier…</p>
          )}
          {personaLookupStatus === 'error' && (
            <p className="text-center text-xs text-red-300">CSV dossier temporarily unavailable.</p>
          )}
          <div className="flex flex-wrap gap-3 justify-center">
            <button
              type="button"
              onClick={handleOpenMoonLander}
              className="pixel-font px-6 py-3 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
            >
              LAUNCH m00nLANDER
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderEligibleHolderPanel = () => {
    if (!airdropData || !userData) {
      return renderLockedOutPanel();
    }
    const copy = getPersonaCopy({ persona: 'eligible_holder' });
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10">
        <div className="max-w-3xl w-full space-y-8 scanline p-10 bg-black/50 rounded-lg border-2 border-[var(--monad-purple)]">
          <div className="flex justify-center mb-2">
            <NeonHaloLogo size={150} />
          </div>
          <h1 className="pixel-font text-2xl text-center glow-purple">{copy.title}</h1>
          {renderCopyBody(copy.body)}
          {renderPersonaCtas(copy)}

          <div className="text-center space-y-4">
            <p className="text-3xl font-bold glow-green">
              {formatAmount(airdropData.amount!)} $m00n
            </p>
            <p className="text-lg">
              {userData.displayName ? `${userData.displayName} ` : ''}
              {userData.username ? `@${userData.username}` : `FID: ${userData.fid}`}
            </p>
          </div>

          <div className={`${PANEL_CLASS} text-center`}>
            <p className="pixel-font text-[11px] uppercase tracking-[0.5em] text-[var(--moss-green)] mb-4">
              {claimCountdown.totalSeconds > 0 ? 'Claim unlocks in' : 'Claim window active'}
            </p>
            {claimCountdown.totalSeconds > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {countdownUnits.map((unit) => (
                  <div
                    key={unit.label}
                    className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-black/30 py-3"
                  >
                    <span className="text-3xl font-mono glow-green">
                      {formatCountdownValue(unit.value)}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.4em] text-[var(--moss-green)]">
                      {unit.label}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--moss-green)]">
                Claim window is live — head to the portal to execute.
              </p>
            )}
          </div>

          <div className="flex justify-center mb-6">
            <div
              className="pixel-font text-[11px] uppercase tracking-[0.5em] px-8 py-3 rounded-full"
              style={{
                border: `2px solid ${replyGlow.color}`,
                color: replyGlow.color,
                boxShadow: `0 0 22px ${replyGlow.shadow}`,
                background: 'rgba(0, 0, 0, 0.45)'
              }}
            >
              {repliesCount} replies logged
            </div>
          </div>

          <div className="mb-2">{renderSessionCard(userData?.fid, primaryAddress)}</div>
          {dropAddress && dropAddress !== primaryAddress && (
            <p className="text-xs opacity-70">
              Allocation detected on{' '}
              <span className="font-mono">{`${dropAddress.slice(0, 6)}…${dropAddress.slice(-4)}`}</span>
              .
            </p>
          )}

          {tier && engagementData?.isFollowing && (
            <div
              className={`mt-8 p-8 bg-purple-900/30 rounded-lg border ${
                showLootReveal ? 'crt-flicker' : ''
              }`}
              style={{
                borderColor: replyGlow.color,
                boxShadow: `0 0 28px ${replyGlow.shadow}`
              }}
            >
              <h3 className="pixel-font text-lg mb-3" style={{ color: replyGlow.color }}>
                {tier.icon} {tier.title}
              </h3>
              <p className="text-sm mb-4 italic">{tier.flavorText}</p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Tier: {tier.name}</span>
                  <span>Replies: {repliesCount}</span>
                </div>
                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--monad-purple)] to-[var(--moss-green)] transition-all duration-1000"
                    style={{ width: `${tier.progressPercentage}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-center mt-8">
            <button
              onClick={handleShare}
              className="pixel-font px-6 py-2 bg-[var(--monad-purple)] text-white rounded hover:bg-opacity-90 transition-all"
            >
              SHARE CAST
            </button>
          </div>

          {renderContractCard()}
        </div>
      </div>
    );
  };

  const renderLockedOutPanel = () => {
    const copy = getPersonaCopy({ persona: 'locked_out' });
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
        <div className="max-w-2xl w-full text-center space-y-6 scanline shake">
          <div className="flex justify-center">
            <NeonHaloLogo size={160} />
          </div>

          <h1 className="pixel-font text-2xl text-red-400">{copy.title}</h1>
          {renderCopyBody(copy.body)}
          {renderPersonaCtas(copy)}

          {userData && (
            <div className="text-sm text-left bg-black/40 border border-[var(--monad-purple)] rounded-2xl p-6 space-y-3">
              <p className="uppercase text-[var(--moss-green)] text-xs tracking-widest">Session</p>
              <p>FID: {userData.fid}</p>
              <div className="flex items-center gap-3 font-mono text-base">
                <span>
                  Wallet:{' '}
                  {primaryAddress
                    ? `${primaryAddress.slice(0, 6)}…${primaryAddress.slice(-4)}`
                    : '—'}
                </span>
                {primaryAddress && (
                  <button
                    onClick={() => handleCopyWallet(primaryAddress)}
                    className="pixel-font text-[10px] px-3 py-1 border border-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)] hover:text-white transition-colors"
                  >
                    {copiedWallet ? 'COPIED' : 'COPY'}
                  </button>
                )}
              </div>
            </div>
          )}

          {dropAddress && dropAddress !== primaryAddress && (
            <p className="text-xs opacity-70">
              Drop checks were performed against{' '}
              <span className="font-mono">{`${dropAddress.slice(0, 6)}…${dropAddress.slice(-4)}`}</span>
              .
            </p>
          )}

          <div className="w-full">{renderContractCard({ showClaimButton: false })}</div>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => handleSwapMonToToken('moon')}
              disabled={swapInFlight === 'moon'}
              className="pixel-font px-6 py-3 border border-[var(--moss-green)] text-[var(--moss-green)] rounded-lg hover:bg-[var(--moss-green)] hover:text-black transition-colors disabled:opacity-40"
            >
              {swapInFlight === 'moon' ? 'SWAPPING…' : 'BUY MORE m00n'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const StickerRain = () => (
    <div className="sticker-rain pointer-events-none" aria-hidden="true">
      {fallingStickers.map((drop) => (
        <span
          key={drop.id}
          className="sticker"
          style={
            {
              left: `${drop.left}%`,
              color: drop.color,
              animationDuration: `${drop.duration}s`,
              animationDelay: `${drop.delay}s`,
              '--scale': drop.scale
            } as CSSProperties
          }
        >
          {drop.emoji}
        </span>
      ))}
    </div>
  );

  const NeonHaloLogo = ({ size = 140, onActivate }: { size?: number; onActivate?: () => void }) => (
    <div
      className={`neon-logo-wrapper ${onActivate ? 'cursor-pointer focus-visible:outline-none' : ''}`}
      style={{ width: size, height: size }}
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={onActivate ? 'View manifesto' : undefined}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (!onActivate) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      <span className="neon-halo" />
      <span className="neon-halo halo-sm" />
      <div className="neon-logo-core">
        <Image
          src="/brand/logo.png"
          alt="m00n"
          width={size - 24}
          height={size - 24}
          className="neon-logo-img"
        />
      </div>
    </div>
  );

  const renderAdminPanel = () => {
    if (!isAdmin) return null;

    const portals: { id: AdminPortalView; label: string }[] = [
      { id: 'default', label: 'Live state' },
      { id: 'claimed_sold', label: 'Claimed + sold' },
      { id: 'claimed_held', label: 'Claimed + held' },
      { id: 'claimed_bought_more', label: 'Claimed + bought' },
      { id: 'emoji_chat', label: 'Observation deck' },
      { id: 'eligible_holder', label: 'Claim console' },
      { id: 'locked_out', label: 'Lockout gate' },
      { id: 'lp_gate', label: 'No claim + LP' }
    ];

    const currentPortalLabel =
      portals.find((portal) => portal.id === adminPortalView)?.label ?? 'Live state';

    if (isAdminPanelCollapsed) {
      return (
        <button
          type="button"
          onClick={() => setIsAdminPanelCollapsed(false)}
          className="fixed top-4 right-4 z-50 pixel-font text-[10px] tracking-[0.4em] px-4 py-2 rounded-full border border-[var(--monad-purple)] text-white bg-black/70 hover:bg-black/60 transition-colors"
        >
          ADMIN • {currentPortalLabel}
        </button>
      );
    }

    return (
      <div className="fixed top-4 right-4 z-50 bg-black/70 border border-[var(--monad-purple)] rounded-2xl p-4 w-64 space-y-3 backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <div className="text-left">
            <p className="pixel-font text-[10px] uppercase tracking-[0.4em] text-[var(--moss-green)]">
              Admin portal
            </p>
            <p className="text-xs opacity-70">Preview each basket instantly</p>
          </div>
          <button
            type="button"
            onClick={() => setIsAdminPanelCollapsed(true)}
            className="pixel-font text-[10px] border border-white/20 rounded-full px-2 py-1 hover:bg-white/10 transition-colors"
            aria-label="Collapse admin controls"
          >
            —
          </button>
        </div>
        <button
          onClick={handleOpenClaimSite}
          className="w-full text-xs px-3 py-2 rounded-lg border border-[var(--moss-green)] text-[var(--moss-green)] hover:bg-[var(--moss-green)] hover:text-black transition-colors"
        >
          Open claim site
        </button>
        <button
          onClick={() => router.push('/miniapp/advanced-lp')}
          className="w-full text-xs px-3 py-2 rounded-lg border border-white/25 text-white hover:bg-white/10 transition-colors"
        >
          Open advanced LP lab
        </button>
        <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto pr-1">
          {portals.map((portal) => (
            <button
              key={portal.id}
              onClick={() => handleAdminPortalSelect(portal.id)}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
                adminPortalView === portal.id
                  ? 'bg-[var(--monad-purple)] text-white border-[var(--monad-purple)]'
                  : 'border-white/20 text-white/80 hover:bg-white/5'
              }`}
            >
              {portal.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Tab navigation component
  const renderTabNavigation = () => (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[100] bg-black/95 backdrop-blur-lg border-t border-white/10 safe-area-pb"
      style={{ touchAction: 'manipulation' }}
    >
      <div className="max-w-lg mx-auto flex justify-around items-center h-16">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
            activeTab === 'home' ? 'text-[var(--moss-green)]' : 'text-white/50 hover:text-white/80'
          }`}
        >
          <span className="text-lg">🏠</span>
          <span className="text-[9px] font-medium">HOME</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('lp')}
          className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
            activeTab === 'lp' ? 'text-[var(--monad-purple)]' : 'text-white/50 hover:text-white/80'
          }`}
        >
          <span className="text-lg">💧</span>
          <span className="text-[9px] font-medium">POSITIONS</span>
        </button>
        <button
          type="button"
          onClick={handleOpenAdvancedLp}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors text-white/50 hover:text-white/80"
        >
          <span className="text-lg">🫡</span>
          <span className="text-[9px] font-medium">DEPLOY</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('rewards')}
          className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
            activeTab === 'rewards' ? 'text-[#ffd700]' : 'text-white/50 hover:text-white/80'
          }`}
        >
          <span className="text-lg">🏆</span>
          <span className="text-[9px] font-medium">REWARDS</span>
        </button>
      </div>
    </nav>
  );

  const renderShell = (content: ReactNode, showTabs = false) => (
    <div className="relative min-h-screen flex flex-col">
      {renderAdminPanel()}
      <BackgroundOrbs />
      <StickerRain />
      {/* Safe area padding for iPhone - explicit padding values */}
      <main
        className="relative z-10 mx-auto w-full max-w-5xl px-4 flex-1"
        style={{ paddingTop: '60px', paddingBottom: '100px' }}
      >
        <div className="space-y-8">{content}</div>
      </main>
      {showTabs && renderTabNavigation()}
      {toast && (
        <div
          className={`fixed top-6 left-1/2 z-50 -translate-x-1/2 px-4 py-2 rounded-full border backdrop-blur ${
            toast.kind === 'success'
              ? 'bg-green-500/20 border-green-400 text-green-100'
              : toast.kind === 'error'
                ? 'bg-red-500/20 border-red-400 text-red-100'
                : 'bg-white/10 border-white/40 text-white'
          }`}
        >
          <span className="pixel-font text-xs tracking-[0.3em]">{toast.message}</span>
        </div>
      )}
      {isLpClaimModalOpen && renderLpClaimModal()}
    </div>
  );

  const BackgroundOrbs = () => (
    <>
      <span className="floating-orb orb-one pointer-events-none" />
      <span className="floating-orb orb-two pointer-events-none" />
      <span className="floating-orb orb-three pointer-events-none" />
    </>
  );

  // =====================
  // TAB CONTENT RENDERERS
  // =====================

  // Home Tab - Overview, wallet info, quick stats
  const renderHomeTab = () => {
    // Use best available balance source (LP funding API has priority, then balance probe)
    const bestBalanceWei = moonBalanceWei ?? primaryAddressMoonBalanceWei;
    const moonBalance = bestBalanceWei ? Number(formatUnits(bestBalanceWei, 18)) : 0;
    // Abbreviate: 5.12B, 123.4M, 45.6K
    const formatAbbreviated = (n: number): string => {
      if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return n.toFixed(2);
    };
    const formattedBalance = formatAbbreviated(moonBalance);
    const positionCount = lpGateState.lpPositions?.length ?? 0;
    // Show WMON balance instead of price
    const wmonBalance = wmonBalanceWei ? Number(formatUnits(wmonBalanceWei, 18)) : 0;
    const formattedWmon = formatAbbreviated(wmonBalance);

    // Calculate live m00n price
    const wmonPriceUsd = lpGateState.poolWmonUsdPrice ?? 0;
    const currentTick = lpGateState.poolCurrentTick ?? 0;
    const moonPriceInWmon = currentTick ? Math.pow(1.0001, currentTick) : 0;
    const liveMoonPriceUsd = moonPriceInWmon * wmonPriceUsd;
    // Calculate market cap (100B total supply)
    const marketCapUsd = liveMoonPriceUsd * 100_000_000_000;
    const formatMarketCap = (mc: number): string => {
      if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`;
      if (mc >= 1_000) return `$${(mc / 1_000).toFixed(1)}K`;
      return `$${mc.toFixed(0)}`;
    };

    return (
      <div className="space-y-5 pb-4">
        {/* Live Price Header - more prominent */}
        <div
          className="p-5 rounded-2xl text-center border border-[var(--monad-purple)]/30"
          style={{
            background:
              'linear-gradient(135deg, rgba(138,43,226,0.15) 0%, rgba(0,0,0,0.4) 50%, rgba(76,175,80,0.1) 100%)'
          }}
        >
          <p className="text-[10px] uppercase tracking-[0.4em] text-white/40 mb-2">$M00N PRICE</p>
          <p className="text-3xl font-bold text-[var(--moss-green)] mb-1">
            {liveMoonPriceUsd > 0 ? formatSmallPrice(liveMoonPriceUsd) : '—'}
          </p>
          <p className="text-sm text-white/50">
            Market Cap: {marketCapUsd > 0 ? formatMarketCap(marketCapUsd) : '—'}
          </p>
        </div>

        {/* Balance + Stats Row */}
        <div className="p-5 rounded-2xl border border-white/10 bg-black/40">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-[var(--moss-green)]">{formattedBalance}</p>
              <p className="text-[10px] text-white/40 mt-1">$m00n</p>
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--monad-purple)]">{positionCount}</p>
              <p className="text-[10px] text-white/40 mt-1">LPs</p>
            </div>
            <div>
              <p className="text-lg font-bold text-white/80">{formattedWmon}</p>
              <p className="text-[10px] text-white/40 mt-1">WMON</p>
            </div>
          </div>
          {(miniWalletAddress || primaryAddress) && (
            <div className="flex items-center justify-center gap-2 text-[10px] text-white/40 mt-4 pt-4 border-t border-white/10">
              <span className="font-mono">
                {truncateAddress(miniWalletAddress ?? primaryAddress ?? '')}
              </span>
              <button
                type="button"
                onClick={() => {
                  const addr = miniWalletAddress ?? primaryAddress ?? '';
                  navigator.clipboard.writeText(addr);
                  setCopiedWallet(true);
                  setTimeout(() => setCopiedWallet(false), 2000);
                }}
                className="text-[var(--monad-purple)] hover:underline"
              >
                {copiedWallet ? '✓' : 'Copy'}
              </button>
            </div>
          )}
        </div>

        {/* Quick Actions - 2x2 grid with proper spacing */}
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setActiveTab('lp')}
            className="py-6 rounded-2xl bg-[var(--monad-purple)]/15 border-2 border-[var(--monad-purple)]/40 text-center hover:bg-[var(--monad-purple)]/25 transition"
          >
            <span className="text-2xl block mb-2">💧</span>
            <span className="text-sm font-medium">My LPs</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rewards')}
            className="py-6 rounded-2xl bg-[#ffd700]/10 border-2 border-[#ffd700]/30 text-center hover:bg-[#ffd700]/20 transition"
          >
            <span className="text-2xl block mb-2">🏆</span>
            <span className="text-sm font-medium">Rewards</span>
          </button>
          <button
            type="button"
            onClick={handleOpenAdvancedLp}
            className="py-6 rounded-2xl bg-white/5 border-2 border-white/20 text-center hover:bg-white/10 transition"
          >
            <span className="text-2xl block mb-2">🫡</span>
            <span className="text-sm font-medium">Deploy LP</span>
          </button>
          <button
            type="button"
            onClick={handleOpenMoonLander}
            className="py-6 rounded-2xl bg-white/5 border-2 border-white/20 text-center hover:bg-white/10 transition"
          >
            <span className="text-2xl block mb-2">🚀</span>
            <span className="text-sm font-medium">Game</span>
          </button>
        </div>

        {/* Observation Deck - standalone with night sky feel */}
        <button
          type="button"
          onClick={() => {
            setSolarSystemRefreshNonce((n) => n + 1);
            setIsObservationDeckOpen(true);
          }}
          className="w-full py-5 rounded-2xl text-center border-2 border-[var(--monad-purple)]/40 hover:border-[var(--monad-purple)]/60 transition"
          style={{
            background: 'linear-gradient(180deg, rgba(13,13,26,0.9) 0%, rgba(0,0,5,0.95) 100%)'
          }}
        >
          <span className="text-xl inline-block mr-2">🔭</span>
          <span className="text-sm font-medium">Observation Deck</span>
          <p className="text-[10px] text-white/30 mt-1">View LP Solar System</p>
        </button>

        {/* Buy Tokens */}
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => handleSwapMonToToken('moon')}
            disabled={swapInFlight === 'moon'}
            className="py-4 bg-[var(--moss-green)]/20 border-2 border-[var(--moss-green)]/50 rounded-2xl text-sm font-semibold text-[var(--moss-green)] disabled:opacity-50 hover:bg-[var(--moss-green)]/30 transition"
          >
            {swapInFlight === 'moon' ? '...' : '🌙 Buy m00n'}
          </button>
          <button
            type="button"
            onClick={() => handleSwapMonToToken('wmon')}
            disabled={swapInFlight === 'wmon'}
            className="py-4 bg-[var(--monad-purple)]/20 border-2 border-[var(--monad-purple)]/50 rounded-2xl text-sm font-semibold text-[var(--monad-purple)] disabled:opacity-50 hover:bg-[var(--monad-purple)]/30 transition"
          >
            {swapInFlight === 'wmon' ? '...' : '💎 Buy WMON'}
          </button>
        </div>

        {/* Contract Address - compact */}
        <div className="p-4 rounded-2xl border border-white/10 bg-black/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-white/40 mb-1">m00n Contract</p>
              <p className="font-mono text-xs text-white/70">{truncateAddress(TOKEN_ADDRESS)}</p>
            </div>
            <button
              type="button"
              onClick={handleCopyContract}
              className="text-xs px-4 py-2 rounded-full border border-white/20 text-white/60 hover:bg-white/10 hover:text-white transition"
            >
              {copiedContract ? '✓' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Season Info */}
        {tokenomicsData?.currentSeason && (
          <div className="p-4 rounded-2xl border border-white/10 bg-black/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">⛏️</span>
                <div>
                  <p className="text-sm font-semibold text-white">
                    Season {tokenomicsData.currentSeason.number}
                  </p>
                  <p className="text-[10px] text-white/40">{tokenomicsData.currentSeason.name}</p>
                </div>
              </div>
              <span className="text-[10px] px-3 py-1.5 rounded-full bg-[var(--moss-green)]/20 text-[var(--moss-green)] font-medium">
                ACTIVE
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  // LP Tab - Positions & Deploy (open to everyone!)
  const renderLpTab = () => {
    const positions = lpGateState.lpPositions ?? [];
    const hasPositions = positions.length > 0;
    const wmonPrice = lpGateState.poolWmonUsdPrice ?? 0;
    const currentTick = lpGateState.poolCurrentTick ?? 0;

    // Calculate moon price from current tick
    const moonPriceInWmon = currentTick ? Math.pow(1.0001, currentTick) : 0;
    const moonPriceUsd = moonPriceInWmon * wmonPrice;

    // Calculate position value from token breakdown (same logic as desktop)
    const getPositionValueUsd = (pos: LpPosition): number => {
      const token0Amt = pos.token0?.amountWei
        ? Number(formatUnits(BigInt(pos.token0.amountWei), pos.token0.decimals ?? 18))
        : 0;
      const token1Amt = pos.token1?.amountWei
        ? Number(formatUnits(BigInt(pos.token1.amountWei), pos.token1.decimals ?? 18))
        : 0;
      // token0 = m00n, token1 = WMON
      return token0Amt * moonPriceUsd + token1Amt * wmonPrice;
    };

    // Get band type label matching desktop
    const getBandLabel = (bandType?: string): string => {
      if (bandType === 'crash_band') return 'CRASH BAND';
      if (bandType === 'upside_band') return 'SKY BAND';
      return 'DOUBLE SIDED';
    };

    return (
      <div className="space-y-6">
        {/* Position Alerts Banner - Actionable */}
        {positionAlerts.length > 0 && !alertsDismissed && (
          <div className="space-y-3">
            {positionAlerts.slice(0, 3).map((alert) => {
              // Determine alert styling and action based on type
              const isSkyComplete = alert.type === 'sky_band_complete';
              const isCrashComplete = alert.type === 'crash_band_complete';
              const isBackInRange = alert.type === 'back_in_range';

              const bgClass = isSkyComplete
                ? 'border-[var(--monad-purple)]/50 bg-[var(--monad-purple)]/10'
                : isCrashComplete
                  ? 'border-[var(--moss-green)]/50 bg-[var(--moss-green)]/10'
                  : isBackInRange
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-amber-500/50 bg-amber-500/10';

              const titleColor = isSkyComplete
                ? 'text-[var(--monad-purple)]'
                : isCrashComplete
                  ? 'text-[var(--moss-green)]'
                  : isBackInRange
                    ? 'text-emerald-400'
                    : 'text-amber-400';

              return (
                <div key={alert.tokenId} className={`rounded-xl border-2 ${bgClass} p-4 space-y-3`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${titleColor}`}>{alert.message}</p>

                      {/* Strategy-specific guidance - LP positions, not limit orders! */}
                      {isSkyComplete && (
                        <div className="mt-2 space-y-2">
                          <p className="text-xs text-white/70">
                            Your position now holds{' '}
                            <span className="text-[var(--monad-purple)] font-semibold">
                              100% WMON
                            </span>
                            .
                          </p>
                          <div className="bg-black/30 p-2 rounded-lg">
                            <p className="text-[10px] text-white/80 font-semibold mb-1">
                              ⚡ Decision Time:
                            </p>
                            <ul className="text-[10px] text-white/60 space-y-1 list-disc pl-3">
                              <li>
                                <span className="text-[var(--moss-green)]">Remove now</span> → Lock
                                in profits as WMON
                              </li>
                              <li>
                                <span className="text-amber-400">Leave open</span> → If price
                                returns, you&apos;ll accumulate m00n again (could be good or bad)
                              </li>
                            </ul>
                          </div>
                        </div>
                      )}

                      {isCrashComplete && (
                        <div className="mt-2 space-y-2">
                          <p className="text-xs text-white/70">
                            Your position now holds{' '}
                            <span className="text-[var(--moss-green)] font-semibold">
                              100% m00n
                            </span>
                            .
                          </p>
                          <div className="bg-black/30 p-2 rounded-lg">
                            <p className="text-[10px] text-white/80 font-semibold mb-1">
                              ⚡ Decision Time:
                            </p>
                            <ul className="text-[10px] text-white/60 space-y-1 list-disc pl-3">
                              <li>
                                <span className="text-[var(--moss-green)]">Remove now</span> → Keep
                                your m00n, hold for recovery
                              </li>
                              <li>
                                <span className="text-amber-400">Leave open</span> → If price
                                recovers, you&apos;ll sell m00n back (could miss upside)
                              </li>
                            </ul>
                          </div>
                        </div>
                      )}

                      {isBackInRange && (
                        <div className="mt-2">
                          <p className="text-xs text-white/70">
                            You&apos;re earning swap fees again! 💰
                          </p>
                          <p className="text-[10px] text-white/50 mt-1">
                            Price is chopping in your range — this is ideal for fee accumulation.
                          </p>
                        </div>
                      )}

                      {alert.type === 'went_out_of_range' && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs text-white/70">
                            No longer earning fees. Position is idle.
                          </p>
                          <p className="text-[10px] text-white/50">
                            💡 Remove and redeploy at current price, or wait for price to return.
                          </p>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPositionAlerts((prev) =>
                          prev.filter((a) => a.tokenId !== alert.tokenId)
                        );
                      }}
                      className="text-xs text-white/30 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Action buttons for completed bands */}
                  {(isSkyComplete || isCrashComplete || alert.type === 'went_out_of_range') && (
                    <div className="flex gap-2">
                      {/* Primary action: Remove liquidity to realize gains */}
                      <button
                        type="button"
                        onClick={() => handleRemoveLiquidity(alert.tokenId)}
                        className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
                          isSkyComplete
                            ? 'bg-[var(--monad-purple)] text-white hover:bg-[var(--monad-purple)]/80'
                            : isCrashComplete
                              ? 'bg-[var(--moss-green)] text-black hover:bg-[var(--moss-green)]/80'
                              : 'bg-red-500/80 text-white hover:bg-red-500'
                        }`}
                      >
                        {isSkyComplete
                          ? '💰 Remove & Lock Profits'
                          : isCrashComplete
                            ? '💎 Remove & Keep m00n'
                            : '🔄 Remove Liquidity'}
                      </button>
                      {/* Secondary: View position details */}
                      <button
                        type="button"
                        onClick={() => {
                          // Scroll to the position card
                          const el = document.getElementById(`position-${alert.tokenId}`);
                          el?.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="px-3 py-2 text-xs text-white/70 border border-white/20 rounded-lg hover:bg-white/10 transition"
                      >
                        View
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {positionAlerts.length > 3 && (
              <p className="text-xs text-white/50 text-center">
                +{positionAlerts.length - 3} more position updates
              </p>
            )}

            {/* Dismiss all button */}
            <button
              type="button"
              onClick={() => setAlertsDismissed(true)}
              className="w-full py-2 text-xs text-white/50 hover:text-white border border-white/10 rounded-lg"
            >
              Dismiss All
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="pixel-font text-xl glow-purple">LP Positions</h2>
            <p className="text-xs opacity-60">
              {positions.length} active position{positions.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenAdvancedLp}
            className="px-4 py-2 bg-[var(--monad-purple)] text-white rounded-xl text-xs font-semibold hover:bg-[var(--monad-purple)]/80 transition-colors"
          >
            + New Position
          </button>
        </div>

        {/* Position Cards - High Contrast Dark Theme */}
        {hasPositions ? (
          <div className="space-y-4">
            {positions.map((pos) => {
              const isInRange = pos.rangeStatus === 'in-range';
              const fees = pos.fees;
              const positionValue = getPositionValueUsd(pos);

              // Abbreviate token amounts for readability
              const formatTokenAmt = (val: string | number): string => {
                const n = typeof val === 'string' ? parseFloat(val) : val;
                if (isNaN(n) || n === 0) return '0';
                // Large numbers: abbreviate
                if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
                if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
                if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
                if (n >= 1) return n.toFixed(2);
                if (n >= 0.01) return n.toFixed(3);
                if (n >= 0.0001) return n.toFixed(4);
                // Very tiny: use scientific notation or "<0.0001"
                if (n < 0.0001 && n > 0) return n.toExponential(1);
                return n.toFixed(4);
              };

              // Format USD amounts smartly
              const formatUsdAmt = (val: number | null | undefined): string => {
                if (val === null || val === undefined || isNaN(val)) return '—';
                if (val === 0) return '$0';
                if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
                if (val >= 1) return `$${val.toFixed(2)}`;
                if (val >= 0.01) return `$${val.toFixed(4)}`;
                if (val >= 0.0001) return `$${val.toFixed(6)}`;
                // Super tiny: scientific notation
                if (val < 0.0001 && val > 0) return `$${val.toExponential(2)}`;
                return `$${val.toFixed(4)}`;
              };

              return (
                <div
                  key={pos.tokenId}
                  id={`position-${pos.tokenId}`}
                  className="rounded-xl border-2 border-white/20 bg-black/80 overflow-hidden"
                >
                  {/* Header: Token ID + Band Type - High contrast bar */}
                  <div className="flex justify-between items-center px-4 py-2 bg-[var(--monad-purple)]/30 border-b border-white/20">
                    <span className="font-mono text-white font-bold text-sm">#{pos.tokenId}</span>
                    <span className="uppercase tracking-[0.2em] text-[10px] font-bold text-[var(--moss-green)] bg-black/40 px-2 py-0.5 rounded">
                      {getBandLabel(pos.bandType)}
                    </span>
                  </div>

                  {/* Main info section */}
                  <div className="px-4 py-3 space-y-2">
                    {/* Range + Status Row */}
                    <div className="flex justify-between items-center">
                      <div className="text-white/60 text-xs">
                        <span className="text-white/40">Range:</span> {pos.tickLower ?? '?'} →{' '}
                        {pos.tickUpper ?? '?'}
                      </div>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded ${
                          isInRange
                            ? 'bg-[var(--moss-green)]/20 text-[var(--moss-green)]'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {isInRange ? '✓ IN RANGE' : '✗ OUT'}
                      </span>
                    </div>

                    {/* Position Value - Prominent */}
                    <div className="flex justify-between items-center py-2 px-3 bg-white/5 rounded-lg">
                      <span className="text-white/80 text-xs font-medium">Position Value</span>
                      <span className="text-[var(--monad-purple)] font-bold text-base">
                        {formatUsdAmt(positionValue)}
                      </span>
                    </div>
                  </div>

                  {/* Fees Section - Distinct background */}
                  {pos.feesStatus === 'loaded' && fees ? (
                    <div className="px-4 py-3 bg-[var(--moss-green)]/5 border-t border-white/10 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-white/60">Unclaimed</span>
                        <span className="text-white font-mono text-[10px]">
                          {formatTokenAmt(fees.token0Formatted)} m00n /{' '}
                          {formatTokenAmt(fees.token1Formatted)} WMON
                        </span>
                      </div>
                      {fees.unclaimedUsd !== null && fees.unclaimedUsd !== undefined && (
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-white/60">Unclaimed (USD)</span>
                          <span className="text-[var(--moss-green)] font-semibold">
                            ~{formatUsdAmt(fees.unclaimedUsd)}
                          </span>
                        </div>
                      )}
                      {fees.lifetimeUsd !== null && fees.lifetimeUsd !== undefined && (
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-white/60">Lifetime fees</span>
                          <span className="text-[var(--moss-green)] font-semibold">
                            {formatUsdAmt(fees.lifetimeUsd)}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : pos.feesStatus === 'loading' ? (
                    <div className="px-4 py-3 bg-white/5 border-t border-white/10">
                      <div className="flex justify-between items-center text-xs text-white/50">
                        <span>Fees</span>
                        <span className="animate-pulse">Loading...</span>
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-3 bg-white/5 border-t border-white/10">
                      <div className="flex justify-between items-center text-xs text-white/40">
                        <span>Unclaimed</span>
                        <span>—</span>
                      </div>
                    </div>
                  )}

                  {/* Analytics & Rebalance Suggestion */}
                  {(() => {
                    const lifetimeFees = fees?.lifetimeUsd ?? 0;
                    const posAgeSeconds = pos.createdAtTimestamp
                      ? Math.floor(Date.now() / 1000) - pos.createdAtTimestamp
                      : 86400 * 7; // Default 7 days if unknown

                    const analyticsInput: PositionInput = {
                      currentTick,
                      tickLower: pos.tickLower ?? 0,
                      tickUpper: pos.tickUpper ?? 0,
                      rangeStatus:
                        (pos.rangeStatus as 'below-range' | 'in-range' | 'above-range') ??
                        'in-range',
                      token0Amount: pos.token0?.amountWei
                        ? Number(
                            formatUnits(BigInt(pos.token0.amountWei), pos.token0.decimals ?? 18)
                          )
                        : 0,
                      token1Amount: pos.token1?.amountWei
                        ? Number(
                            formatUnits(BigInt(pos.token1.amountWei), pos.token1.decimals ?? 18)
                          )
                        : 0,
                      moonPriceUsd,
                      wmonPriceUsd: wmonPrice,
                      lifetimeFeesUsd: lifetimeFees,
                      positionAgeSeconds: posAgeSeconds
                    };

                    const analytics = analyzePosition(analyticsInput);
                    const { ilText, aprText, vsHodlText, rebalanceText } =
                      formatAnalyticsForDisplay(analytics);

                    return (
                      <div className="px-4 py-3 bg-[var(--monad-purple)]/10 border-t border-white/10">
                        {/* Analytics Grid - 3 columns for contrast */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          {/* APR */}
                          <div className="bg-black/40 rounded-lg py-2 px-1">
                            <p className="text-[9px] text-white/50 uppercase tracking-wider mb-0.5">
                              APR
                            </p>
                            <p
                              className={`text-xs font-bold ${
                                analytics.feesApr.percentage > 0
                                  ? 'text-[var(--moss-green)]'
                                  : 'text-white/60'
                              }`}
                            >
                              {analytics.feesApr.percentage > 0
                                ? `${analytics.feesApr.percentage.toFixed(1)}%`
                                : '—'}
                            </p>
                          </div>
                          {/* IL */}
                          <div className="bg-black/40 rounded-lg py-2 px-1">
                            <p className="text-[9px] text-white/50 uppercase tracking-wider mb-0.5">
                              IL
                            </p>
                            <p
                              className={`text-xs font-bold ${
                                analytics.impermanentLoss.percentage < -1
                                  ? 'text-red-400'
                                  : 'text-[var(--moss-green)]'
                              }`}
                            >
                              {analytics.impermanentLoss.percentage < 0
                                ? `${Math.abs(analytics.impermanentLoss.percentage).toFixed(1)}%`
                                : '0%'}
                            </p>
                          </div>
                          {/* vs HODL */}
                          <div className="bg-black/40 rounded-lg py-2 px-1">
                            <p className="text-[9px] text-white/50 uppercase tracking-wider mb-0.5">
                              vs HODL
                            </p>
                            <p
                              className={`text-xs font-bold ${
                                analytics.vsHodl.winner === 'LP'
                                  ? 'text-[var(--moss-green)]'
                                  : analytics.vsHodl.winner === 'HODL'
                                    ? 'text-red-400'
                                    : 'text-white/60'
                              }`}
                            >
                              {analytics.vsHodl.winner === 'LP'
                                ? `+$${analytics.vsHodl.differenceUsd.toFixed(2)}`
                                : analytics.vsHodl.winner === 'HODL'
                                  ? `-$${Math.abs(analytics.vsHodl.differenceUsd).toFixed(2)}`
                                  : 'Even'}
                            </p>
                          </div>
                        </div>
                        {/* Rebalance Suggestion - Full width alert */}
                        {rebalanceText && (
                          <div className="mt-3 p-2 rounded-lg bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 text-[10px] font-medium">
                            ⚠️ {rebalanceText.replace('⚠️ ', '')}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Buttons row - High contrast footer */}
                  <div className="flex items-center gap-2 px-4 py-3 bg-black/60 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => handleCollectLpFees(pos.tokenId)}
                      disabled={pos.collectStatus === 'loading'}
                      className="px-4 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white font-semibold text-xs hover:bg-white/20 transition disabled:opacity-50"
                    >
                      {pos.collectStatus === 'loading' ? '...' : 'Collect'}
                    </button>
                    {(() => {
                      const hasToken0 = BigInt(pos.fees?.token0Wei || '0') > BigInt(0);
                      const hasToken1 = BigInt(pos.fees?.token1Wei || '0') > BigInt(0);
                      const isInRange = pos.rangeStatus === 'in-range';
                      const canCompound = pos.fees && ((hasToken0 && hasToken1) || !isInRange);
                      const isCompounding = pos.compoundStatus && pos.compoundStatus !== 'idle';
                      const isSuccess = pos.compoundStatus === 'success';
                      const isError = pos.compoundStatus === 'error';

                      return (
                        <div className="flex flex-col items-center">
                          <button
                            type="button"
                            onClick={() => handleCompoundLpFees(pos.tokenId)}
                            disabled={
                              pos.collectStatus === 'loading' || isCompounding || !canCompound
                            }
                            title={
                              isInRange && !canCompound
                                ? 'In-range positions need both tokens'
                                : undefined
                            }
                            className={`px-4 py-1.5 rounded-lg font-semibold text-xs transition disabled:opacity-50 ${
                              isSuccess
                                ? 'bg-[var(--moss-green)] text-black border border-[var(--moss-green)]'
                                : isError
                                  ? 'bg-red-500/20 border border-red-500/50 text-red-400'
                                  : 'bg-[var(--moss-green)]/20 border border-[var(--moss-green)]/50 text-[var(--moss-green)] hover:bg-[var(--moss-green)] hover:text-black'
                            }`}
                          >
                            {isCompounding && !isSuccess && !isError
                              ? '...'
                              : isSuccess
                                ? '✓ Done'
                                : 'Compound ↻'}
                          </button>
                          {pos.compoundStep && (
                            <span
                              className={`text-[9px] mt-1 ${isError ? 'text-red-400' : isSuccess ? 'text-[var(--moss-green)]' : 'text-white/50'}`}
                            >
                              {pos.compoundStep}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => handleRemoveLiquidity(pos.tokenId)}
                      disabled={pos.removeStatus === 'loading'}
                      className="px-4 py-1.5 rounded-lg bg-red-500/20 border border-red-500/50 text-red-400 font-semibold text-xs hover:bg-red-500 hover:text-white transition disabled:opacity-50"
                    >
                      {pos.removeStatus === 'loading' ? '...' : 'Remove'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSharePosition(pos)}
                      className="ml-auto px-4 py-1.5 rounded-lg bg-[var(--monad-purple)]/20 border border-[var(--monad-purple)]/50 text-[var(--monad-purple)] font-semibold text-xs hover:bg-[var(--monad-purple)] hover:text-white transition"
                    >
                      Share
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={`${PANEL_CLASS} text-center space-y-4`}>
            <div className="text-4xl">💧</div>
            <p className="text-lg font-semibold">No LP positions yet</p>
            <p className="text-sm opacity-70">
              Provide liquidity to earn fees and qualify for full moon rewards!
            </p>
            <button
              type="button"
              onClick={handleOpenAdvancedLp}
              className="px-6 py-3 bg-[var(--monad-purple)] text-white rounded-xl font-semibold hover:bg-[var(--monad-purple)]/80 transition-colors"
            >
              Deploy Your First Position
            </button>
            <div className="pt-2 border-t border-white/10">
              <p className="text-xs opacity-50 mb-2">Need tokens first?</p>
              <div className="flex gap-2 justify-center">
                <button
                  type="button"
                  onClick={() => handleSwapMonToToken('moon')}
                  disabled={swapInFlight === 'moon'}
                  className="px-3 py-2 text-xs border border-[var(--moss-green)]/50 text-[var(--moss-green)] rounded-lg hover:bg-[var(--moss-green)]/10 transition-colors disabled:opacity-50"
                >
                  {swapInFlight === 'moon' ? '...' : 'Buy m00n'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSwapMonToToken('wmon')}
                  disabled={swapInFlight === 'wmon'}
                  className="px-3 py-2 text-xs border border-[var(--monad-purple)]/50 text-[var(--monad-purple)] rounded-lg hover:bg-[var(--monad-purple)]/10 transition-colors disabled:opacity-50"
                >
                  {swapInFlight === 'wmon' ? '...' : 'Buy WMON'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* LP Guide Link */}
        <div className="text-center">
          <button
            type="button"
            onClick={handleOpenLpHelp}
            className="text-xs text-[var(--monad-purple)] hover:underline"
          >
            📖 LP Guide & Requirements
          </button>
        </div>
      </div>
    );
  };

  // Qualification Requirements Card with Progress (legacy, kept for reference)
  const renderQualificationCard = () => {
    // Get user's current status
    const positions = lpGateState.lpPositions ?? [];
    const hasPositions = positions.length > 0;

    // Calculate m00n balance (use mini wallet balance)
    const moonBalance = moonBalanceWei ? Number(moonBalanceWei / BigInt(10 ** 18)) : 0;
    const requiredMoonBalance = 1_000_000;
    const moonProgress = Math.min((moonBalance / requiredMoonBalance) * 100, 100);
    const hasMoonBalance = moonBalance >= requiredMoonBalance;

    // Calculate LP value
    const totalLpValueUsd = positions.reduce((sum, pos) => {
      const token0Value =
        pos.token0?.amountFormatted && lpGateState.poolWmonUsdPrice
          ? Number(pos.token0.amountFormatted) *
            (pos.token0.symbol === 'WMON' ? lpGateState.poolWmonUsdPrice : 0)
          : 0;
      const token1Value =
        pos.token1?.amountFormatted && lpGateState.poolWmonUsdPrice
          ? Number(pos.token1.amountFormatted) *
            (pos.token1.symbol === 'WMON' ? lpGateState.poolWmonUsdPrice : 0)
          : 0;
      return sum + token0Value + token1Value;
    }, 0);
    const requiredLpValue = 5;
    const lpValueProgress = Math.min((totalLpValueUsd / requiredLpValue) * 100, 100);
    const hasLpValue = totalLpValueUsd >= requiredLpValue;

    // Calculate oldest position age
    const now = Date.now();
    const oldestPositionAgeDays = positions.reduce((oldest, pos) => {
      if (!pos.createdAtTimestamp) return oldest;
      const ageDays = (now - pos.createdAtTimestamp * 1000) / (1000 * 60 * 60 * 24);
      return Math.max(oldest, ageDays);
    }, 0);
    const requiredAgeDays = 7;
    const ageProgress = Math.min((oldestPositionAgeDays / requiredAgeDays) * 100, 100);
    const hasPositionAge = oldestPositionAgeDays >= requiredAgeDays;
    const daysUntilQualified = Math.max(0, Math.ceil(requiredAgeDays - oldestPositionAgeDays));

    // Check if any position is in range
    const inRangeCount = positions.filter((p) => p.rangeStatus === 'in-range').length;
    const hasInRange = inRangeCount > 0;

    // Overall qualification status
    const isFullyQualified = hasMoonBalance && hasLpValue && hasPositionAge;

    // Generate actionable tips
    const getActionableTips = (): {
      icon: string;
      text: string;
      priority: 'high' | 'medium' | 'low';
    }[] => {
      const tips: { icon: string; text: string; priority: 'high' | 'medium' | 'low' }[] = [];

      // High priority - blocking issues
      if (!hasPositions) {
        tips.push({
          icon: '🚨',
          text: 'Deploy an LP position to start earning points!',
          priority: 'high'
        });
      } else if (!hasMoonBalance) {
        const needed = requiredMoonBalance - moonBalance;
        tips.push({
          icon: '💰',
          text: `Get ${formatCompactNumber(needed)} more m00n to qualify`,
          priority: 'high'
        });
      } else if (!hasLpValue) {
        tips.push({
          icon: '💵',
          text: `Add $${(requiredLpValue - totalLpValueUsd).toFixed(2)} more to your LP`,
          priority: 'high'
        });
      } else if (!hasPositionAge) {
        tips.push({
          icon: '⏳',
          text: `${daysUntilQualified} day${daysUntilQualified !== 1 ? 's' : ''} until your position qualifies`,
          priority: 'high'
        });
      }

      // Medium priority - optimization tips
      if (hasPositions && !hasInRange) {
        tips.push({
          icon: '🎯',
          text: 'Rebalance to get in-range for +20% bonus!',
          priority: 'medium'
        });
      }

      if (yapMultiplier && yapMultiplier.multiplier < 2) {
        tips.push({
          icon: '📣',
          text: 'Post about $m00n to boost your yap multiplier',
          priority: 'medium'
        });
      }

      if (!appAddedData?.added) {
        tips.push({
          icon: '📲',
          text: 'Add the app for permanent +10% bonus',
          priority: 'medium'
        });
      }

      if (checkInData?.canCheckIn) {
        tips.push({
          icon: '🎵',
          text: 'Tune in daily to build your streak bonus!',
          priority: 'medium'
        });
      }

      // Low priority - nice to have
      if (isFullyQualified && hasInRange) {
        tips.push({
          icon: '✨',
          text: "You're earning points! Keep positions in-range.",
          priority: 'low'
        });
      }

      return tips.slice(0, 3); // Max 3 tips
    };

    const tips = getActionableTips();

    return (
      <div className={`${PANEL_CLASS} p-3 bg-black/60`}>
        {/* Header with status */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold">📋 Qualification Status</p>
          {isFullyQualified ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--moss-green)]/20 text-[var(--moss-green)] font-semibold">
              ✓ Qualified
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 font-semibold">
              In Progress
            </span>
          )}
        </div>

        {/* Progress bars */}
        <div className="space-y-2 mb-3">
          {/* m00n Balance */}
          <div>
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className={hasMoonBalance ? 'text-[var(--moss-green)]' : 'opacity-70'}>
                {hasMoonBalance ? '✓' : '○'} 💰 m00n Balance
              </span>
              <span className={hasMoonBalance ? 'text-[var(--moss-green)]' : 'opacity-50'}>
                {formatCompactNumber(moonBalance)} / 1M
              </span>
            </div>
            <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${hasMoonBalance ? 'bg-[var(--moss-green)]' : 'bg-yellow-500'}`}
                style={{ width: `${moonProgress}%` }}
              />
            </div>
          </div>

          {/* LP Value */}
          <div>
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className={hasLpValue ? 'text-[var(--moss-green)]' : 'opacity-70'}>
                {hasLpValue ? '✓' : '○'} 💵 LP Value
              </span>
              <span className={hasLpValue ? 'text-[var(--moss-green)]' : 'opacity-50'}>
                ${totalLpValueUsd.toFixed(2)} / $5
              </span>
            </div>
            <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${hasLpValue ? 'bg-[var(--moss-green)]' : 'bg-yellow-500'}`}
                style={{ width: `${lpValueProgress}%` }}
              />
            </div>
          </div>

          {/* Position Age */}
          <div>
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className={hasPositionAge ? 'text-[var(--moss-green)]' : 'opacity-70'}>
                {hasPositionAge ? '✓' : '○'} ⏳ Position Age
              </span>
              <span className={hasPositionAge ? 'text-[var(--moss-green)]' : 'opacity-50'}>
                {oldestPositionAgeDays.toFixed(1)}d / 7d
              </span>
            </div>
            <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${hasPositionAge ? 'bg-[var(--moss-green)]' : 'bg-yellow-500'}`}
                style={{ width: `${ageProgress}%` }}
              />
            </div>
          </div>

          {/* In-Range Bonus (optional) */}
          <div>
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className={hasInRange ? 'text-[var(--moss-green)]' : 'opacity-70'}>
                {hasInRange ? '✓' : '○'} 🎯 In-Range Bonus
              </span>
              <span className={hasInRange ? 'text-[var(--moss-green)]' : 'opacity-50'}>
                {hasInRange
                  ? `${inRangeCount} position${inRangeCount !== 1 ? 's' : ''} (+20%)`
                  : 'Not active'}
              </span>
            </div>
            <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${hasInRange ? 'bg-[var(--moss-green)]' : 'bg-gray-600'}`}
                style={{ width: hasInRange ? '100%' : '0%' }}
              />
            </div>
          </div>
        </div>

        {/* Actionable Tips */}
        {tips.length > 0 && (
          <div className="border-t border-white/10 pt-2 space-y-1.5">
            <p className="text-[9px] opacity-50 uppercase tracking-wider">What to do next:</p>
            {tips.map((tip, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-2 text-[10px] p-1.5 rounded-lg ${
                  tip.priority === 'high'
                    ? 'bg-yellow-500/10 border border-yellow-500/30'
                    : tip.priority === 'medium'
                      ? 'bg-[var(--monad-purple)]/10 border border-[var(--monad-purple)]/30'
                      : 'bg-[var(--moss-green)]/10 border border-[var(--moss-green)]/30'
                }`}
              >
                <span>{tip.icon}</span>
                <span
                  className={
                    tip.priority === 'high'
                      ? 'text-yellow-400'
                      : tip.priority === 'medium'
                        ? 'text-[var(--monad-purple)]'
                        : 'text-[var(--moss-green)]'
                  }
                >
                  {tip.text}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-[9px] opacity-40 mt-2 text-center">🌕 Snapshots taken each full moon</p>
      </div>
    );
  };

  // Rewards Tab - Simplified & Consolidated
  const renderRewardsTab = () => {
    // Calculate combined multiplier
    const yapMult = yapMultiplier?.multiplier ?? 1;
    const tuneMult = checkInData?.multiplier ?? 1; // Renamed from checkIn
    const appMult = appAddedData?.added ? 1.1 : 1;
    const houseMult = houseTier?.harvestMultiplier ?? 1;
    const combinedMult = yapMult * tuneMult * appMult * houseMult;

    // Qualification checks - use best available balance source
    const positions = lpGateState.lpPositions ?? [];
    const bestBalanceWei = moonBalanceWei ?? primaryAddressMoonBalanceWei;
    const moonBal = bestBalanceWei ? Number(bestBalanceWei / BigInt(10 ** 18)) : 0;

    // Calculate oldest position age in days
    const now = Date.now();
    const oldestAgeDays = positions.reduce((oldest, pos) => {
      if (!pos.createdAtTimestamp) return oldest;
      const ageDays = (now - pos.createdAtTimestamp * 1000) / (1000 * 60 * 60 * 24);
      return Math.max(oldest, ageDays);
    }, 0);

    // Calculate total LP value from token amounts
    const wmonPrice = lpGateState.poolWmonUsdPrice ?? 0;
    const totalLpValue = positions.reduce((sum, pos) => {
      const t0Val =
        pos.token0?.amountFormatted && pos.token0.symbol === 'WMON'
          ? Number(pos.token0.amountFormatted) * wmonPrice
          : 0;
      const t1Val =
        pos.token1?.amountFormatted && pos.token1.symbol === 'WMON'
          ? Number(pos.token1.amountFormatted) * wmonPrice
          : 0;
      return sum + t0Val + t1Val;
    }, 0);

    // Full qualification: 1M m00n + 7d age + $5 value
    const hasMoonBal = moonBal >= 1_000_000;
    const hasPosition = positions.length > 0;
    const hasAge = oldestAgeDays >= 7;
    const hasValue = totalLpValue >= 5;
    const isQualified = hasMoonBal && hasPosition && hasAge && hasValue;

    // Copy referral link
    const copyReferralLink = () => {
      if (referralData?.referralLink) {
        navigator.clipboard.writeText(referralData.referralLink);
        showToast('success', 'Referral link copied!');
      }
    };

    return (
      <div className="space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>
        {/* Header: House Tier + Combined Multiplier */}
        <div
          className={`${PANEL_CLASS} p-4 bg-gradient-to-r from-[var(--monad-purple)]/20 to-[var(--moss-green)]/20`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-lg"
                  style={{
                    textShadow:
                      houseTier?.tier !== 'wanderer'
                        ? `0 0 8px ${houseTier?.tier === 'celestial' ? '#b9f2ff' : houseTier?.tier === 'luminary' ? '#ffd700' : houseTier?.tier === 'guardian' ? '#c0c0c0' : '#cd7f32'}`
                        : 'none'
                  }}
                >
                  {houseTier?.emoji ?? '◌'}
                </span>
                <span className="text-xs opacity-70">{houseTier?.name ?? 'Wanderer'} House</span>
                {houseTier?.totalBurnedFormatted && houseTier.totalBurnedFormatted !== '0' && (
                  <span className="text-[10px] text-orange-400">
                    🔥 {houseTier.totalBurnedFormatted}
                  </span>
                )}
              </div>
              <p
                className={`text-2xl font-bold ${combinedMult >= 2 ? 'text-[#ffd700]' : combinedMult > 1 ? 'text-[var(--moss-green)]' : 'opacity-50'}`}
              >
                {combinedMult.toFixed(2)}x
              </p>
              <p className="text-[10px] opacity-40">Total Boost</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] opacity-50">Season 1 • Genesis</p>
              <p
                className={`text-xs ${isQualified ? 'text-[var(--moss-green)]' : 'text-yellow-400'}`}
              >
                {isQualified ? '✓ Qualified' : '⚠ Not qualified'}
              </p>
              {harvestStats && harvestStats.totalPoints > 0 && (
                <p className="text-[10px] text-[var(--moss-green)] mt-1">
                  🌾 {harvestStats.totalPoints.toLocaleString()} pts
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Boost Actions */}
        <div className={`${PANEL_CLASS} p-3 space-y-2`}>
          <p className="text-[10px] opacity-50 uppercase tracking-wider mb-2">Boosts</p>

          {/* App Added */}
          <div className="flex items-center justify-between py-1.5 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span>📲</span>
              <span className={`text-sm ${appAddedData?.added ? 'line-through opacity-50' : ''}`}>
                Add App
              </span>
            </div>
            {appAddedData?.added ? (
              <span className="text-[var(--moss-green)] text-sm font-bold">1.1x ✓</span>
            ) : (
              <button
                onClick={handleAddApp}
                disabled={appAddedStatus === 'adding'}
                className="px-3 py-1 text-xs bg-[var(--monad-purple)]/20 border border-[var(--monad-purple)]/50 text-[var(--monad-purple)] rounded-lg hover:bg-[var(--monad-purple)] hover:text-white transition"
              >
                {appAddedStatus === 'adding' ? '...' : '+10%'}
              </button>
            )}
          </div>

          {/* Tune (auto via harvest) - Expanded Section */}
          <div className="py-2 border-b border-white/10">
            {/* Main row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>🎵</span>
                <span className="text-sm">Tune</span>
                {checkInData && checkInData.currentStreak > 0 && (
                  <span className="text-[10px] text-white/50">
                    {checkInData.currentStreak}d streak
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {checkInData?.canCheckIn ? (
                  <button
                    onClick={() => setActiveTab('lp')}
                    className="px-2 py-0.5 text-[10px] text-yellow-400 hover:text-yellow-300 bg-yellow-400/10 border border-yellow-400/30 rounded-full transition animate-pulse"
                  >
                    🎵 harvest to tune →
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--moss-green)]/10 border border-[var(--moss-green)]/30 rounded-full">
                    <span className="text-[var(--moss-green)] text-sm font-bold">
                      {tuneMult}x ✓
                    </span>
                    <span className="text-[10px] text-[var(--moss-green)]/70">tuned!</span>
                  </div>
                )}
              </div>
            </div>

            {/* Tier & Stats row */}
            {checkInData && (
              <div className="mt-1.5 flex items-center justify-between text-[10px]">
                {/* Tier name */}
                <div className="flex items-center gap-2">
                  {checkInData.multiplierTier && checkInData.multiplierTier !== '—' && (
                    <span className="text-white/70">{checkInData.multiplierTier}</span>
                  )}
                  {checkInData.longestStreak && checkInData.longestStreak > 0 && (
                    <span className="text-white/40">best: {checkInData.longestStreak}d</span>
                  )}
                  {checkInData.totalCheckIns && checkInData.totalCheckIns > 0 && (
                    <span className="text-white/40">total: {checkInData.totalCheckIns}</span>
                  )}
                </div>

                {/* Countdown when already tuned */}
                {!checkInData.canCheckIn && checkInData.hoursUntilAvailable && (
                  <span className="text-white/40">next in {checkInData.hoursUntilAvailable}h</span>
                )}
              </div>
            )}

            {/* Streak progress bar */}
            {checkInData && checkInData.currentStreak > 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-1 text-[8px] text-white/40 mb-1">
                  <span>1d</span>
                  <div className="flex-1" />
                  <span>7d</span>
                  <div className="flex-1" />
                  <span>14d</span>
                  <div className="flex-1" />
                  <span>30d 🌙</span>
                </div>
                <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--monad-purple)] to-[var(--moss-green)] transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (checkInData.currentStreak / 30) * 100)}%`
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Yap */}
          <div className="flex items-center justify-between py-1.5 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span>📣</span>
              <span className="text-sm">Yap</span>
              {yapMultiplier && yapMultiplier.castCount > 0 && (
                <span className="text-[10px] text-white/50">{yapMultiplier.castCount} casts</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-sm font-bold ${yapMult > 1 ? 'text-[var(--moss-green)]' : 'opacity-50'}`}
              >
                {yapMult}x
              </span>
              {yapMult < 5 && (
                <button
                  onClick={() => {
                    try {
                      sdk?.actions?.openUrl('https://warpcast.com/~/compose?text=%24m00n%20');
                    } catch {
                      window.open('https://warpcast.com', '_blank');
                    }
                  }}
                  className="px-2 py-0.5 text-[10px] bg-[var(--monad-purple)]/20 border border-[var(--monad-purple)]/50 text-[var(--monad-purple)] rounded hover:bg-[var(--monad-purple)]/30 transition"
                >
                  Cast
                </button>
              )}
            </div>
          </div>

          {/* House (Burn Tier) */}
          <div className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2">
              <span>🔥</span>
              <span className="text-sm">House</span>
              {houseTier && houseTier.totalBurnedFormatted !== '0' && (
                <span className="text-[10px] text-white/50">
                  {houseTier.totalBurnedFormatted} burned
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-sm font-bold ${houseMult > 1 ? 'text-[var(--moss-green)]' : 'opacity-50'}`}
              >
                {houseMult}x
              </span>
              <button
                onClick={() => setShowBurnModal(true)}
                className="px-2 py-0.5 text-[10px] bg-orange-500/20 border border-orange-500/50 text-orange-400 rounded hover:bg-orange-500/30 transition"
              >
                {houseTier?.nextTier ? 'Ascend' : '🔥 Burn'}
              </button>
            </div>
          </div>
        </div>

        {/* Burn Modal */}
        {showBurnModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className={`${PANEL_CLASS} p-4 max-w-sm w-full space-y-4`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">🔥 Ascend House</h3>
                <button
                  onClick={() => setShowBurnModal(false)}
                  className="text-white/50 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="text-center py-3">
                <p
                  className="text-3xl mb-1"
                  style={{
                    textShadow:
                      houseTier?.tier !== 'wanderer'
                        ? `0 0 12px ${houseTier?.tier === 'celestial' ? '#b9f2ff' : houseTier?.tier === 'luminary' ? '#ffd700' : houseTier?.tier === 'guardian' ? '#c0c0c0' : '#cd7f32'}`
                        : 'none'
                  }}
                >
                  {houseTier?.emoji ?? '◌'}
                </p>
                <p className="font-bold">{houseTier?.name ?? 'Wanderer'} House</p>
                <p className="text-xs opacity-50">
                  {houseTier?.totalBurnedFormatted ?? '0'} burned
                </p>
              </div>

              {houseTier?.nextTier ? (
                <div className="bg-black/40 rounded-lg p-3 text-center">
                  <p className="text-xs opacity-50">Next tier</p>
                  <p className="font-bold text-orange-400">{houseTier.nextTier.tier.name} House</p>
                  <p className="text-xs">Burn {houseTier.nextTier.burnNeededFormatted} more m00n</p>
                  <p className="text-[10px] text-[var(--moss-green)]">
                    Unlock higher harvest bonus!
                  </p>
                </div>
              ) : (
                <div className="bg-black/40 rounded-lg p-3 text-center">
                  <p className="text-xs opacity-50">You&apos;ve reached the highest tier!</p>
                  <p className="font-bold text-[var(--moss-green)]">Keep burning for glory 🔥</p>
                </div>
              )}

              <div>
                <label className="text-xs opacity-50 block mb-1">Burn amount</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={burnAmount}
                    onChange={(e) => setBurnAmount(e.target.value)}
                    placeholder="100000"
                    className="flex-1 bg-black/40 border border-white/20 rounded-lg px-3 py-2 text-sm"
                  />
                  <span className="text-sm opacity-50 self-center">m00n</span>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => setBurnAmount('100000')}
                    className="flex-1 text-[10px] py-1 bg-white/10 rounded hover:bg-white/20"
                  >
                    100K
                  </button>
                  <button
                    onClick={() => setBurnAmount('500000')}
                    className="flex-1 text-[10px] py-1 bg-white/10 rounded hover:bg-white/20"
                  >
                    500K
                  </button>
                  <button
                    onClick={() => setBurnAmount('1000000')}
                    className="flex-1 text-[10px] py-1 bg-white/10 rounded hover:bg-white/20"
                  >
                    1M
                  </button>
                </div>
                <p className="text-[10px] opacity-40 mt-1">
                  Balance:{' '}
                  {moonBalanceWei ? (Number(moonBalanceWei) / 10 ** 18).toLocaleString() : '—'} m00n
                </p>
              </div>

              <button
                onClick={() => handleBurnMoon(burnAmount)}
                disabled={burnStatus !== 'idle' || !burnAmount}
                className="w-full py-3 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 font-bold text-white disabled:opacity-50 hover:from-orange-600 hover:to-red-600 transition"
              >
                {burnStatus === 'burning'
                  ? 'Burning...'
                  : burnStatus === 'recording'
                    ? 'Recording...'
                    : `🔥 Burn ${burnAmount || '0'} m00n`}
              </button>

              <p className="text-[9px] opacity-40 text-center">
                Burned tokens are sent to 0xdead and cannot be recovered.
              </p>
            </div>
          </div>
        )}

        {/* Referral Link */}
        <div className={`${PANEL_CLASS} p-3`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] opacity-50 uppercase tracking-wider">Share & Earn</p>
              <p className="text-xs mt-1">
                {referralData?.directReferrals ?? 0} referrals
                {referralData && referralData.totalReferralPoints > 0 && (
                  <span className="text-[var(--moss-green)] ml-2">
                    +{referralData.totalReferralPoints.toLocaleString()} pts
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={copyReferralLink}
              className="px-3 py-1.5 text-xs bg-[var(--monad-purple)]/20 border border-[var(--monad-purple)]/50 text-[var(--monad-purple)] rounded-lg hover:bg-[var(--monad-purple)] hover:text-white transition flex items-center gap-1"
            >
              🔗 Copy Link
            </button>
          </div>
          <p className="text-[9px] opacity-40 mt-2">
            Earn 5% of your referrals&apos; points forever
          </p>
        </div>

        {/* Qualification - Only show if not qualified */}
        {!isQualified && (
          <div className={`${PANEL_CLASS} p-3 border-l-2 border-yellow-500`}>
            <p className="text-xs text-yellow-400 mb-1">To qualify:</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/60">
              <span className={hasMoonBal ? 'text-[var(--moss-green)]' : ''}>
                {hasMoonBal ? '✓' : '○'} 1M m00n
              </span>
              <span className={hasPosition ? 'text-[var(--moss-green)]' : ''}>
                {hasPosition ? '✓' : '○'} LP
              </span>
              <span className={hasAge ? 'text-[var(--moss-green)]' : ''}>
                {hasAge ? '✓' : '○'} 7d age{' '}
                {!hasAge && oldestAgeDays > 0 ? `(${oldestAgeDays.toFixed(1)}d)` : ''}
              </span>
              <span className={hasValue ? 'text-[var(--moss-green)]' : ''}>
                {hasValue ? '✓' : '○'} $5+ value
              </span>
            </div>
          </div>
        )}

        {/* Streak Leaderboard */}
        {renderStreakLeaderboard()}
      </div>
    );
  };

  // Advanced Tab - Just shows loading while redirect happens
  const renderAdvancedTab = () => (
    <div className="text-center py-12">
      <p className="opacity-60">Loading Advanced LP...</p>
    </div>
  );

  // Main tabbed content router
  const renderTabContent = () => {
    // Show observation deck if open
    if (isObservationDeckOpen) {
      return renderObservationDeckContent();
    }

    switch (activeTab) {
      case 'home':
        return renderHomeTab();
      case 'lp':
        return renderLpTab();
      case 'advanced':
        return renderAdvancedTab();
      case 'rewards':
        return renderRewardsTab();
      default:
        return renderHomeTab();
    }
  };

  // Observation Deck content (simplified for modal display)
  const renderObservationDeckContent = () => {
    const updatedStamp =
      solarSystemStatus === 'loaded' && solarSystemData?.updatedAt
        ? new Date(solarSystemData.updatedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })
        : null;

    return (
      <div
        className="min-h-[80vh] relative overflow-hidden"
        style={{
          background: 'radial-gradient(ellipse at center, #0d0d1a 0%, #000005 50%, #000000 100%)'
        }}
      >
        {/* Starfield effect */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* Static stars */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `
              radial-gradient(1px 1px at 20px 30px, white, transparent),
              radial-gradient(1px 1px at 40px 70px, rgba(255,255,255,0.8), transparent),
              radial-gradient(1px 1px at 90px 40px, rgba(255,255,255,0.6), transparent),
              radial-gradient(2px 2px at 160px 120px, rgba(200,180,255,0.9), transparent),
              radial-gradient(1px 1px at 230px 80px, white, transparent),
              radial-gradient(1px 1px at 300px 200px, rgba(255,255,255,0.7), transparent),
              radial-gradient(1.5px 1.5px at 50px 160px, rgba(180,200,255,0.8), transparent),
              radial-gradient(1px 1px at 180px 220px, white, transparent),
              radial-gradient(1px 1px at 280px 50px, rgba(255,255,255,0.5), transparent),
              radial-gradient(2px 2px at 350px 150px, rgba(200,150,255,0.7), transparent)
            `,
              backgroundSize: '400px 300px'
            }}
          />
          {/* Nebula glow */}
          <div
            className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full opacity-20"
            style={{
              background:
                'radial-gradient(ellipse, rgba(138,43,226,0.4) 0%, rgba(75,0,130,0.2) 40%, transparent 70%)',
              filter: 'blur(60px)'
            }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 px-4 py-6 space-y-6">
          {/* Header with close button */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="pixel-font text-2xl text-white drop-shadow-lg">
                <span className="mr-2">🔭</span>Observation Deck
              </h2>
              <p className="text-xs text-white/50 mt-1">LP Solar System • Live Telemetry</p>
            </div>
            <button
              type="button"
              onClick={() => setIsObservationDeckOpen(false)}
              className="px-4 py-2 bg-white/5 border border-white/20 rounded-full text-xs text-white/70 hover:bg-white/10 hover:text-white transition backdrop-blur-sm"
            >
              ✕ Close
            </button>
          </div>

          {/* Status */}
          {updatedStamp && (
            <p className="text-xs text-center text-white/40">Last updated: {updatedStamp}</p>
          )}

          {/* Solar System Visualization - with glow frame */}
          <div className="flex justify-center">
            <div
              className="relative rounded-2xl overflow-hidden"
              style={{
                boxShadow: '0 0 60px rgba(138,43,226,0.3), 0 0 120px rgba(138,43,226,0.1)'
              }}
            >
              {/* Inner glow border */}
              <div
                className="absolute inset-0 rounded-2xl pointer-events-none"
                style={{
                  border: '1px solid rgba(138,43,226,0.3)',
                  boxShadow: 'inset 0 0 30px rgba(138,43,226,0.2)'
                }}
              />
              {solarSystemStatus === 'loaded' && activeSolarPositions.length > 0 ? (
                <M00nSolarSystem
                  positions={activeSolarPositions}
                  width={solarCanvasSize}
                  height={solarCanvasSize}
                />
              ) : solarSystemStatus === 'loading' ? (
                <div className="w-[300px] h-[300px] flex items-center justify-center bg-black/50">
                  <p className="text-sm text-white/70 animate-pulse">Scanning orbital tracks...</p>
                </div>
              ) : solarSystemStatus === 'empty' ? (
                <div className="w-[300px] h-[300px] flex items-center justify-center bg-black/50">
                  <p className="text-sm text-white/50">No positions detected</p>
                </div>
              ) : solarSystemStatus === 'error' ? (
                <div className="w-[300px] h-[300px] flex items-center justify-center bg-black/50">
                  <p className="text-sm text-red-300/70">Telemetry offline</p>
                </div>
              ) : (
                <div className="w-[300px] h-[300px] flex items-center justify-center bg-black/50">
                  <p className="text-sm text-white/50 animate-pulse">Calibrating...</p>
                </div>
              )}
            </div>
          </div>

          {/* Refresh button */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setSolarSystemRefreshNonce((n) => n + 1)}
              disabled={solarSystemStatus === 'loading'}
              className="px-6 py-3 bg-[var(--monad-purple)]/20 border border-[var(--monad-purple)]/50 text-[var(--monad-purple)] rounded-full text-sm font-medium hover:bg-[var(--monad-purple)]/30 transition disabled:opacity-50 backdrop-blur-sm"
            >
              {solarSystemStatus === 'loading' ? '⏳ Scanning...' : '↻ Refresh Telemetry'}
            </button>
          </div>

          {/* Position count */}
          {activeSolarPositions.length > 0 && (
            <p className="text-center text-sm text-white/40">
              <span className="text-[var(--monad-purple)]">{activeSolarPositions.length}</span>{' '}
              positions orbiting the m00n
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderContractCard = (options?: { showClaimButton?: boolean }) => {
    const showClaimButton = options?.showClaimButton ?? true;
    return (
      <div className={`${PANEL_CLASS} space-y-4`}>
        <div>
          <p className="lunar-heading mb-2">m00n contract</p>
          <p className="font-mono text-sm text-white/80 break-all">{TOKEN_ADDRESS}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={handleCopyContract} className="cta-ghost text-[10px] tracking-[0.3em]">
            {copiedContract ? 'COPIED' : 'COPY CA'}
          </button>
          {showClaimButton && (
            <button
              onClick={handleOpenClaimSite}
              className="cta-primary text-[10px] tracking-[0.3em]"
            >
              OPEN CLAIM SITE
            </button>
          )}
        </div>
      </div>
    );
  };

  const statusState = useMemo(() => {
    if (isMiniApp === false) {
      return {
        label: 'OPEN IN WARPCAST',
        detail: 'This portal only unlocks inside the Warpcast mini app shell.',
        actionable: false
      };
    }
    if (!isSdkReady) {
      return {
        label: 'SYNCING SDK…',
        detail: 'Bridging to the Farcaster relay.',
        actionable: false
      };
    }
    if (scanPhase === 'authenticating') {
      return {
        label: 'AUTHENTICATING…',
        detail: 'Awaiting approval from your Farcaster wallet.',
        actionable: false
      };
    }
    if (scanPhase === 'addresses') {
      return {
        label: 'SYNCING ADDRESSES…',
        detail: 'Pulling verified wallets from Neynar.',
        actionable: false
      };
    }
    if (scanPhase === 'fetching') {
      return {
        label: 'CALCULATING DROP…',
        detail: 'Crunching the $m00n ledger entries.',
        actionable: false
      };
    }
    if (scanPhase === 'idle') {
      return {
        label: 'SCAN FID',
        detail: 'Tap to connect and fetch your drop.',
        actionable: true
      };
    }
    if (error || scanPhase === 'error') {
      return {
        label: 'RETRY SCAN',
        detail: error ?? 'Tap to try again.',
        actionable: true
      };
    }
    if (airdropData) {
      return {
        label: 'DROP READY',
        detail: airdropData.eligible
          ? 'Scroll to reveal your allocation.'
          : 'No cabal allotment this round.',
        actionable: !airdropData.eligible
      };
    }
    return {
      label: 'SCAN AGAIN',
      detail: 'Tap to re-link your wallet and fetch the ledger.',
      actionable: true
    };
  }, [isMiniApp, isSdkReady, airdropData, error, scanPhase]);

  if (!userData) {
    // Show special message for users with 0 points
    if (hasZeroPoints) {
      return renderShell(
        <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
          <div className="max-w-2xl w-full text-center">
            <h1 className="pixel-font text-3xl text-red-400 glow-red">
              You don&apos;t have to go home but can&apos;t stay here
            </h1>
          </div>
        </div>
      );
    }

    // If we're in the mini app and have viewerContext, auto-sign-in is in progress
    // Show a clean loading state instead of the "SCAN FID" screen
    if (isMiniApp && viewerContext && scanPhase !== 'idle') {
      return renderShell(
        <div className="min-h-screen flex items-center justify-center relative z-10">
          <div className="text-center space-y-4">
            <div className="pixel-font text-xl glow-purple animate-pulse">
              {scanPhase === 'authenticating' && '🔐 Authenticating...'}
              {scanPhase === 'addresses' && '📡 Syncing wallets...'}
              {scanPhase === 'fetching' && '🌙 Loading...'}
              {scanPhase === 'error' && '⚠️ Retrying...'}
            </div>
          </div>
        </div>
      );
    }

    // If we're in mini app with viewerContext but idle, trigger sign-in immediately
    // The useEffect will handle this, just show loading briefly
    if (isMiniApp && viewerContext && scanPhase === 'idle') {
      return renderShell(
        <div className="min-h-screen flex items-center justify-center relative z-10">
          <div className="text-center space-y-4">
            <div className="pixel-font text-xl glow-purple animate-pulse">🌙 Connecting...</div>
          </div>
        </div>
      );
    }

    // Only show the full scan screen for non-mini-app or no viewerContext
    return renderShell(
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
        <div className="w-full max-w-sm space-y-8 text-center">
          <div className={`${PANEL_CLASS} space-y-4`}>
            <h1 className="pixel-font text-2xl glow-purple">$m00n</h1>
            <p className="text-sm opacity-80 px-2">Open in Warpcast to continue.</p>
          </div>

          {!isMiniApp && (
            <a
              href="https://warpcast.com/~/add-mini-app?domain=m00nad.vercel.app"
              className="pixel-font inline-block px-6 py-2 bg-[var(--monad-purple)] text-white rounded hover:bg-opacity-90 transition-all text-[11px] tracking-[0.4em]"
            >
              OPEN IN WARPCAST
            </a>
          )}

          {isMiniApp && !viewerContext && (
            <div className="text-center space-y-3">
              <button
                onClick={handleSignIn}
                className="pixel-font w-full px-6 py-3 bg-[var(--monad-purple)] text-white rounded-lg hover:bg-opacity-90 transition-all disabled:opacity-40 text-xs tracking-[0.4em]"
                disabled={!statusState.actionable}
              >
                {statusState.label}
              </button>
              <p className="text-xs opacity-70 px-2">{statusState.detail}</p>
              {error && <p className="text-red-400 px-2">{error}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return renderShell(
      <div className="min-h-screen flex items-center justify-center relative z-10">
        <div className="text-center space-y-4 crt-flicker">
          <div className="pixel-font text-xl glow-purple">LOADING...</div>
          <div className="w-64 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--monad-purple)] animate-pulse"
              style={{ width: '60%' }}
            />
          </div>
        </div>
      </div>
    );
  }

  // LP Claim Modal overlay (can be triggered from any tab)
  if (isLpClaimModalOpen) {
    return renderShell(renderTabContent(), true);
  }

  // Admin portal override for testing different views
  if (isAdmin && adminPortalView !== 'default') {
    switch (adminPortalView) {
      case 'claimed_sold':
        return renderClaimedSoldPortal();
      case 'claimed_held':
        return renderClaimedHeldPortal();
      case 'claimed_bought_more':
        return renderClaimedBoughtMorePortal();
      case 'lp_gate':
        return renderLpGatePanel();
      case 'eligible_holder':
        return renderEligibleHolderPanel();
      case 'locked_out':
        return renderLockedOutPanel();
      default:
        break;
    }
  }

  // Main tab-based navigation for all authenticated users
  return renderShell(renderTabContent(), true);
}

export default function MiniAppPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiConfig config={wagmiConfig}>
        <Suspense fallback={null}>
          <MiniAppPageInner />
        </Suspense>
      </WagmiConfig>
    </QueryClientProvider>
  );
}
