import { GraphQLClient, gql } from 'graphql-request';

const UNISWAP_V4_SUBGRAPH_ID = '3kaAG19ytkGfu8xD7YAAZ3qAQ3UDJRkmKH2kHUuyGHah';
const THE_GRAPH_API_KEY =
  (typeof process !== 'undefined' && process.env.THE_GRAPH_API_KEY) ||
  (typeof process !== 'undefined' && process.env.THEGRAPH_API_KEY) ||
  '';

const FALLBACK_SUBGRAPH_URL = THE_GRAPH_API_KEY
  ? `https://gateway.thegraph.com/api/${THE_GRAPH_API_KEY}/subgraphs/id/${UNISWAP_V4_SUBGRAPH_ID}`
  : `https://gateway.thegraph.com/api/subgraphs/id/${UNISWAP_V4_SUBGRAPH_ID}`;

const UNISWAP_V4_SUBGRAPH_URL =
  (typeof process !== 'undefined' && process.env.UNISWAP_V4_SUBGRAPH_URL?.trim()) ||
  FALLBACK_SUBGRAPH_URL;

const graphClient =
  typeof UNISWAP_V4_SUBGRAPH_URL === 'string' && UNISWAP_V4_SUBGRAPH_URL.length
    ? new GraphQLClient(UNISWAP_V4_SUBGRAPH_URL)
    : null;

const WMON_WRAPPED_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const MON_NATIVE_SENTINEL = '0x0000000000000000000000000000000000000000';
const USDC_ADDRESS = '0x754704bc059f8c67012fed69bc8a327a5aafb603';
export const WMON_USDC_POOL_ID =
  '0x18a9fc874581f3ba12b7898f80a683c66fd5877fd74b26a85ba9a3a79c549954';

const GET_WMON_USDC_POOL = gql`
  query GetWmonUsdcPool($id: ID!) {
    pool(id: $id) {
      id
      feeTier
      token0Price
      token1Price
      token0 {
        id
        symbol
      }
      token1 {
        id
        symbol
      }
    }
  }
`;

export async function getWmonUsdPriceFromSubgraph(): Promise<number | null> {
  if (!graphClient) return null;
  try {
    const data = (await graphClient.request(GET_WMON_USDC_POOL, {
      id: WMON_USDC_POOL_ID.toLowerCase()
    })) as {
      pool?: {
        token0Price: string;
        token1Price: string;
        token0: { id: string; symbol?: string };
        token1: { id: string; symbol?: string };
      };
    };

    const pool = data.pool;
    if (!pool) {
      console.warn('[monadPrices] Pool not found for ID:', WMON_USDC_POOL_ID);
      return null;
    }

    const token0Id = pool.token0.id.toLowerCase();
    const token1Id = pool.token1.id.toLowerCase();

    // Log raw subgraph data for debugging
    console.log('[monadPrices] Raw pool data:', {
      poolId: WMON_USDC_POOL_ID,
      token0: { id: token0Id, symbol: pool.token0.symbol },
      token1: { id: token1Id, symbol: pool.token1.symbol },
      token0Price: pool.token0Price,
      token1Price: pool.token1Price
    });

    // In Uniswap subgraph:
    // - token0Price = token0 per token1 (how many token0 for 1 token1) = INVERSE of token0's USD price
    // - token1Price = token1 per token0 (how many token1 for 1 token0) = token0's USD price if token1=USDC
    //
    // We want "USDC per MON/WMON" (USD price of MON/WMON)

    let price: number | null = null;
    let caseUsed = '';

    // Case 1: token0=native_MON, token1=USDC
    // token1Price = USDC per MON (what we want!)
    // token0Price = MON per USDC (inverse)
    if (token0Id === MON_NATIVE_SENTINEL.toLowerCase() && token1Id === USDC_ADDRESS.toLowerCase()) {
      price = Number(pool.token1Price);
      caseUsed = 'Case 1: token0=MON, token1=USDC, using token1Price';
    }

    // Case 2: token0=USDC, token1=native_MON
    // token0Price = USDC per MON (what we want!)
    // token1Price = MON per USDC (inverse)
    else if (
      token1Id === MON_NATIVE_SENTINEL.toLowerCase() &&
      token0Id === USDC_ADDRESS.toLowerCase()
    ) {
      price = Number(pool.token0Price);
      caseUsed = 'Case 2: token0=USDC, token1=MON, using token0Price';
    }

    // Case 3: token0=WMON, token1=USDC
    // token1Price = USDC per WMON (what we want!)
    // token0Price = WMON per USDC (inverse)
    else if (
      token0Id === WMON_WRAPPED_ADDRESS.toLowerCase() &&
      token1Id === USDC_ADDRESS.toLowerCase()
    ) {
      price = Number(pool.token1Price);
      caseUsed = 'Case 3: token0=WMON, token1=USDC, using token1Price';
    }

    // Case 4: token0=USDC, token1=WMON
    // token0Price = USDC per WMON (what we want!)
    // token1Price = WMON per USDC (inverse)
    else if (
      token1Id === WMON_WRAPPED_ADDRESS.toLowerCase() &&
      token0Id === USDC_ADDRESS.toLowerCase()
    ) {
      price = Number(pool.token0Price);
      caseUsed = 'Case 4: token0=USDC, token1=WMON, using token0Price';
    }

    if (price === null || price === 0) {
      console.warn('[monadPrices] Unknown token ordering or zero price:', { token0Id, token1Id });
      return null;
    }

    console.log(`[monadPrices] ${caseUsed}:`, price);

    // Sanity check: MON/WMON price should be in a reasonable range
    if (price < 0.001 || price > 100) {
      console.warn('[monadPrices] MON/WMON price seems unusual:', {
        price,
        caseUsed,
        rawToken0Price: pool.token0Price,
        rawToken1Price: pool.token1Price,
        hint: 'Expected MON price around $0.01-$1 currently'
      });
    }

    return price;
  } catch (error) {
    console.warn('[monadPrices] Failed to fetch WMON/USD price from subgraph', error);
    return null;
  }
}
