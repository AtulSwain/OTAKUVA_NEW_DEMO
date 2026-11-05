import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuthUserFromCookies } from '../../lib/auth';
import { getLandingPosters } from '../../lib/landing/landingPosters';
import { WelcomeClient } from './WelcomeClient';
import { SiteJsonLd } from '../../components/seo/SiteJsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'OTAKUVA — Track, rate and talk anime' },
  description: 'Track what you watch, rate every episode and talk anime with people who love it.',
  alternates: { canonical: '/' },
};

/**
 * Landing page (2026-10-28, owner): what signed-out visitors see first.
 * Real catalog posters drift behind a centred sign-in card; signing in goes
 * to the homepage. Signed-in visitors skip it.
 */
export default async function WelcomePage({ searchParams }: { searchParams: { signup?: string; mode?: string; dev?: string } }) {
  const user = await getAuthUserFromCookies();
  if (user) redirect('/');
  const posters = await getLandingPosters(120).catch(() => []);
  // Back from "Continue with Gmail" (2026-11-05): open Create Account on the code box.
  const gmail =
    searchParams?.signup === 'gmail'
      ? {
          mode: searchParams.mode === 'creator' ? ('creator' as const) : ('register' as const),
          devCode: process.env.NODE_ENV !== 'production' && /^\d{6}$/.test(searchParams.dev ?? '') ? searchParams.dev! : null,
        }
      : null;
  return (
    <>
      <SiteJsonLd />
      <WelcomeClient posters={posters} gmailSignup={gmail} />
    </>
  );
}
