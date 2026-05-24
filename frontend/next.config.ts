import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Standalone output bundles the server + its dependencies into
   * .next/standalone so the Docker runtime stage only needs to copy
   * that directory — no node_modules required in the final image.
   *
   * DEMO MODE NOTE: changed to 'export' for Vercel static export.
   * Revert to 'standalone' when re-enabling Docker / backend proxy.
   */
  // output: 'standalone',   // ← re-enable for Docker deployment

  /**
   * DEMO MODE: API proxy rewrites are disabled.
   * All forecast data is served from precomputed static files in src/data/.
   * No backend or BACKEND_URL environment variable is required.
   *
   * To restore live API mode:
   *   1. Re-enable the rewrites() block below
   *   2. Set BACKEND_URL (Docker) or NEXT_PUBLIC_API_URL (Vercel) env vars
   *   3. Revert useSofrForecast.ts and useFxForecast.ts to the original versions
   */
  //
  // async rewrites() {
  //   const backendUrl = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000';
  //   return [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }];
  // },
};

export default nextConfig;
