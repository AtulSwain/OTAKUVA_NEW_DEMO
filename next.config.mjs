import { withSentryConfig } from '@sentry/nextjs/config';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets a verification build/run use its own folder (NEXT_DIST_DIR=.next-verify)
  // instead of `.next`, so it never wipes a running `npm run dev`. Default unchanged.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  // One page per job (2026-10-17). These sections used to exist two to five
  // times over, each built separately with its own design and bugs. The old
  // addresses redirect (query strings are carried over, so ?genre=…, ?q=…,
  // ?season=…&year=… keep working); their page files are left in place,
  // unused, until someone deletes them deliberately.
  async redirects() {
    return [
      // Catalog → /anime (search + filters + sort)
      { source: '/explore', destination: '/anime', permanent: true },
      { source: '/discover', destination: '/anime', permanent: true },
      // /search stays as the results page for a typed query; without one it
      // was just a second catalog.
      { source: '/search', missing: [{ type: 'query', key: 'q' }], destination: '/anime', permanent: false },
      // Schedule
      { source: '/airing', destination: '/schedule', permanent: true },
      { source: '/anime/airing', destination: '/schedule', permanent: true },
      // Rankings / seasonal
      { source: '/anime/rankings', destination: '/rankings', permanent: true },
      { source: '/anime/seasonal', destination: '/seasonal', permanent: true },
      // Spaces were communities under a second name
      { source: '/spaces', destination: '/community', permanent: true },
      { source: '/spaces/:slug', destination: '/community/:slug', permanent: true },
      // Footer pointed here; the profile lives at /profile/you (or /profile/<name>)
      { source: '/profile', destination: '/profile/you', permanent: false },
    ];
  },
  experimental: {
    // Required on Next.js 14.x for src/instrumentation.ts (register()/
    // onRequestError) to actually load — default-on from Next.js 15, so
    // this line is a harmless no-op once this repo upgrades past it.
    instrumentationHook: true,
    // Load bullmq from node_modules at runtime instead of bundling it, so
    // the build stops warning about its optional @valkey/valkey-glide
    // add-on (not installed, not used — the queue runs on ioredis).
    serverComponentsExternalPackages: ['bullmq'],
  },
};

// Wraps the build with Sentry's webpack plugin (source map upload on
// build, release/deploy annotations) — safe to apply unconditionally:
// without SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT set (the normal
// case for local dev, and for anyone who hasn't set up Sentry at all)
// the plugin just skips the upload steps rather than failing the build.
// Runtime behavior (whether events actually send) is controlled
// separately by SENTRY_DSN in sentry.server.config.ts/sentry.edge.config.ts/
// src/instrumentation-client.ts, not by anything here.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  widenClientFileUpload: false,
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: false,
  },
});
