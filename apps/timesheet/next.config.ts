import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@scl/db'],
  serverExternalPackages: ['pdfkit'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
