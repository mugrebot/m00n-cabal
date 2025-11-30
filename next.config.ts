import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@envio-dev/hypersync-client']
  }
};

export default nextConfig;
