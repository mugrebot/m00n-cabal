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
        token0: { id: string };
        token1: { id: string };
      };
    };

    const pool = data.pool;
    if (!pool) return null;

    const token0Id = pool.token0.id.toLowerCase();
    const token1Id = pool.token1.id.toLowerCase();

    if (token0Id === MON_NATIVE_SENTINEL.toLowerCase() && token1Id === USDC_ADDRESS.toLowerCase()) {
      return Number(pool.token1Price);
    }
    if (token1Id === MON_NATIVE_SENTINEL.toLowerCase() && token0Id === USDC_ADDRESS.toLowerCase()) {
      const price = Number(pool.token0Price);
      if (price === 0) return null;
      return price;
    }

    if (
      token0Id === WMON_WRAPPED_ADDRESS.toLowerCase() &&
      token1Id === USDC_ADDRESS.toLowerCase()
    ) {
      return Number(pool.token0Price);
    }
    if (
      token1Id === WMON_WRAPPED_ADDRESS.toLowerCase() &&
      token0Id === USDC_ADDRESS.toLowerCase()
    ) {
      const price = Number(pool.token1Price);
      if (price === 0) return null;
      return 1 / price;
    }

    return null;
  } catch (error) {
    console.warn('[monadPrices] Failed to fetch WMON/USD price from subgraph', error);
    return null;
  }
}
