'use client';

import React, { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { AuthForm, type AuthMode } from '../../components/auth/AuthForm';
import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE } from '../../lib/landing/guest';
import type { LandingPoster } from '../../lib/landing/landingPosters';
import styles from './welcome.module.css';

/** Enough columns × posters to cover any screen corner-to-corner once the wall is tilted. */
const COLUMNS = 18;
const PER_COLUMN = 14;

const HEADINGS: Record<AuthMode, { title: string; lede: string }> = {
  login: { title: 'Welcome back', lede: 'Track what you watch, rate every episode and talk anime.' },
  register: { title: 'Join OTAKUVA', lede: 'Your anime library, ratings and community in one place.' },
  creator: { title: 'Join as a creator', lede: 'Bring your channel: reviews, members-only communities and followers.' },
};

/**
 * Landing page: a slowly moving wall of real catalog posters (columns
 * alternate up / down at different speeds) behind a centred card with the
 * site's own sign-in form — Sign In, Create Account, or Creator (normal
 * sign-up + the existing creator upgrade). Signing in → homepage.
 */
export function WelcomeClient({ posters }: { posters: LandingPoster[] }) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [leaving, setLeaving] = useState(false);

  // Every column gets PER_COLUMN posters (cycling through the list from a
  // different start, so neighbours don't repeat), rendered twice in a row so
  // the loop is seamless.
  const columns = useMemo(() => {
    if (posters.length === 0) return [];
    return Array.from({ length: COLUMNS }, (_, c) =>
      Array.from({ length: PER_COLUMN }, (_, i) => posters[(c * 7 + i * COLUMNS + c) % posters.length]),
    );
  }, [posters]);

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
    <main className={`${styles.landing} ${leaving ? styles.leaving : ''}`}>
      <div className={styles.wall} aria-hidden="true">
        <div className={styles.wallTilt}>
          {columns.map((col, c) => (
            <div key={c} className={`${styles.column} ${c % 2 ? styles.down : styles.up}`} style={{ ['--speed' as string]: `${90 + ((c * 13) % 5) * 12}s` }}>
              <div className={styles.track}>
                {[0, 1].map((copy) =>
                  col.map((p, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${copy}-${i}-${p.id}`}
                      src={p.src}
                      alt=""
                      className={styles.poster}
                      loading={copy === 0 && i < 6 ? 'eager' : 'lazy'}
                      decoding="async"
                      draggable={false}
                    />
                  )),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.shade} aria-hidden="true" />

      <section className={styles.card} aria-labelledby="welcome-title">
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/otakuva-mark.png" alt="" width={44} height={34} />
          <span>OTAKUVA</span>
        </div>
        <h1 id="welcome-title" className={styles.title}>
          {head.title}
        </h1>
        <p className={styles.lede}>{head.lede}</p>

        <div className={styles.form}>
          <AuthForm mode={mode} onModeChange={setMode} onSignedIn={goHome} modes={['login', 'register', 'creator']} segmented />
        </div>

        <button type="button" className={styles.guest} onClick={browseAsGuest}>
          Browse without signing in <ArrowRight size={14} aria-hidden="true" />
        </button>
      </section>
    </main>
  );
}
