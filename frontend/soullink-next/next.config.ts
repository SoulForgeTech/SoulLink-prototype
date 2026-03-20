import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: '*.cloudinary.com' },
    ],
  },
  /**
   * Rewrites proxy: routes /api/* requests through Next.js server
   * to the backend API, avoiding CORS issues during local development.
   * In production (same-origin deployment), rewrites are a no-op.
   */
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    return apiBase
      ? [{ source: '/api/:path*', destination: `${apiBase}/api/:path*` }]
      : [];
  },
};

export default nextConfig;
