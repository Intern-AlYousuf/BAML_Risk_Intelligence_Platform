import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Standalone output bundles the server + its dependencies into
   * .next/standalone so the Docker runtime stage only needs to copy
   * that directory — no node_modules required in the final image.
   */
  output: 'standalone',

  /**
   * Rewrites proxy /api/* to the backend service.
   *
   * BACKEND_URL is set at build/runtime in Docker (http://backend:8000).
   * In local dev without Docker it falls back to http://localhost:8000.
   *
   * This means the browser always calls a relative URL (/api/v1/...)
   * which Next.js forwards to the backend — no CORS issues, works
   * identically on local, Docker, and Vercel + Railway.
   */
  async rewrites() {
    const backendUrl =
      process.env.BACKEND_URL ?? 'http://localhost:8000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
