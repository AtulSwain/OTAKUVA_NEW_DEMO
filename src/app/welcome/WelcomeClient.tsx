'use client';

import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { AuthForm, type AuthMode } from '../../components/auth/AuthForm';
import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE } from '../../lib/landing/guest';
import type { LandingPoster } from '../../lib/landing/landingPosters';
import { LandingShell } from './LandingShell';
import styles from './welcome.module.css';

const HEADINGS: Record<AuthMode, { title: string; lede: string }> = {
  login: { title: 'Welcome back', lede: 'Track what you watch, rate every episode and talk anime.' },
  register: { title: 'Join OTAKUVA', lede: 'Your anime library, ratings and community in one place.' },
  creator: { title: 'Join as a creator', lede: 'Bring your channel: reviews, members-only communities and followers.' },
};

/**
 * Landing page: the moving poster wall (LandingShell) behind a centred card
 * with the site's own sign-in form — Sign In, Create Account, or Creator
 * (normal sign-up + the existing creator upgrade). Signing in → homepage.
 */
export function WelcomeClient({
  posters,
  gmailSignup = null,
}: {
  posters: LandingPoster[];
  /** Back from "Continue with Gmail": Create Account opens on the code box. */
  gmailSignup?: { mode: 'register' | 'creator'; devCode: string | null } | null;
}) {
  const [mode, setMode] = useState<AuthMode>(gmailSignup?.mode ?? 'login');
  const [leaving, setLeaving] = useState(false);

  const goHome = () => {
    setLeaving(true);
    // A full page load, not a client-side route change: the homepage is
    // rendered on the server from the session cookie that was just set, and a
    // soft navigation could reuse the signed-out render (or the cached
    // "/ → /welcome" redirect) until the user refreshed by hand.
    window.location.replace('/');
  };

  const browseAsGuest = () => {
    document.cookie = `${GUEST_COOKIE}=1; path=/; max-age=${GUEST_COOKIE_MAX_AGE}; samesite=lax`;
    goHome();
  };

  const head = HEADINGS[mode];

  return (
    <LandingShell posters={posters} leaving={leaving} labelledBy="welcome-title">
      <h1 id="welcome-title" className={styles.title}>
        {head.title}
      </h1>
      <p className={styles.lede}>{head.lede}</p>

      <div className={styles.form}>
        <AuthForm mode={mode} onModeChange={setMode} onSignedIn={goHome} modes={['login', 'register', 'creator']} segmented gmailSignup={gmailSignup} />
      </div>

      <button type="button" className={styles.guest} onClick={browseAsGuest}>
        Browse without signing in <ArrowRight size={14} aria-hidden="true" />
      </button>
    </LandingShell>
  );
}
