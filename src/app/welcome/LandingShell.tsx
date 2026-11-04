'use client';

import React, { useMemo } from 'react';
import type { LandingPoster } from '../../lib/landing/landingPosters';
import styles from './welcome.module.css';

/** Enough columns × posters to cover any screen corner-to-corner once the wall is tilted. */
const COLUMNS = 18;
const PER_COLUMN = 14;

/**
 * The landing look, shared by /welcome and the Google return page
 * (/auth/google): a slowly moving wall of real catalog posters (columns
 * alternate up / down) behind one centred glass card.
 */
export function LandingShell({
  posters,
  leaving = false,
  labelledBy,
  children,
}: {
  posters: LandingPoster[];
  leaving?: boolean;
  labelledBy: string;
  children: React.ReactNode;
}) {
  // Every column gets PER_COLUMN posters (cycling through the list from a
  // different start, so neighbours don't repeat), rendered twice in a row so
  // the loop is seamless.
  const columns = useMemo(() => {
    if (posters.length === 0) return [];
    return Array.from({ length: COLUMNS }, (_, c) =>
      Array.from({ length: PER_COLUMN }, (_, i) => posters[(c * 7 + i * COLUMNS + c) % posters.length]),
    );
  }, [posters]);

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

      <section className={styles.card} aria-labelledby={labelledBy}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/otakuva-mark.png" alt="" width={44} height={34} />
          <span>OTAKUVA</span>
        </div>
        {children}
      </section>
    </main>
  );
}

