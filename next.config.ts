import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverExternalPackages: ['@envio-dev/hypersync-client']
  }
};

export default nextConfig;
