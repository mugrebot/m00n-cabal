import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Avoid bundling Node-only logging deps pulled in via WalletConnect/Privy
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        pino: false,
        'thread-stream': false
      };
    }
    return config;
  }
};

export default nextConfig;
