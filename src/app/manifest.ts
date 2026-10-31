import type { MetadataRoute } from 'next';

/**
 * Web app manifest: lets Android/iOS install OTAKUVA to the home screen as
 * a full-screen app, and is what a Play Store (Trusted Web Activity) or
 * App Store wrapper builds on later.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OTAKUVA',
    short_name: 'OTAKUVA',
    description: 'Track what you watch. Anime discovery, schedules, ratings and community.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // No orientation lock: the installed app runs on phones, tablets and laptops.
    background_color: '#141416',
    theme_color: '#141416',
    categories: ['entertainment', 'lifestyle', 'social'],
    icons: [
      { src: '/app-icons/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Schedule', url: '/schedule', description: "What's airing this week" },
      { name: 'My Library', url: '/library' },
      { name: 'Top Picks', url: '/top-picks' },
    ],
  };
}
