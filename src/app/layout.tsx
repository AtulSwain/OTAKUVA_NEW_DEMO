import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import '../styles/globals.css';
import { AppShell } from '../components/shell/AppShell';
import { inter } from './fonts';
import { THEME_INIT_SCRIPT } from '../lib/theme/themes';
import { ScrollReset } from '../components/shell/ScrollReset';
import { SCROLL_INIT_SCRIPT } from '../lib/scroll/scrollInit';
import { DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL } from '../lib/seo/site';

const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined;
const bingVerification = process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION || undefined;

export const metadata: Metadata = {
  // SEO (2026-11-02): every relative canonical / share-image URL resolves
  // against the site address; page titles read "<page> · OTAKUVA".
  metadataBase: new URL(SITE_URL),
  title: { default: 'OTAKUVA — Track what you watch.', template: '%s · OTAKUVA' },
  description: DEFAULT_DESCRIPTION,
  keywords: ['anime', 'anime tracker', 'anime database', 'otakuva', 'anime list', 'seasonal anime', 'anime schedule', 'anime reviews', 'episode ratings'],
  authors: [{ name: 'OTAKUVA' }],
  openGraph: {
    title: 'OTAKUVA — Track what you watch.',
    description: DEFAULT_DESCRIPTION,
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_US',
    images: [{ url: '/app-icons/512.png', width: 512, height: 512, alt: 'OTAKUVA' }],
  },
  twitter: { card: 'summary', title: 'OTAKUVA — Track what you watch.', description: DEFAULT_DESCRIPTION, images: ['/app-icons/512.png'] },
  // Search Console / Bing Webmaster ownership checks (set the env vars in Vercel).
  verification: { google: googleVerification, other: bingVerification ? { 'msvalidate.01': bingVerification } : undefined },
  applicationName: 'OTAKUVA',
  // Installed to the home screen (and the basis for a store wrapper later).
  appleWebApp: { capable: true, title: 'OTAKUVA', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: '#141416',
  width: 'device-width',
  initialScale: 1,
  // Draw under the notch / home bar; safe-area padding keeps content clear of them.
  viewportFit: 'cover',
  // On-screen keyboards resize the page instead of covering docked UI
  // such as the mobile reply composer.
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the theme script may set data-theme before React loads.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Applies a saved colour theme before first paint (fixed list only). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Pages open at the top: no restored scroll position on refresh (ScrollReset.tsx). */}
        <script dangerouslySetInnerHTML={{ __html: SCROLL_INIT_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <ScrollReset />
        <AppShell>{children}</AppShell>
        {/* Vercel Web Analytics: page views only, no cookies. Sends nothing outside Vercel deployments. */}
        <Analytics />
      </body>
    </html>
  );
}
