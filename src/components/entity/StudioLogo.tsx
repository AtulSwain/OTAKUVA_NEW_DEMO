'use client';

import React, { useState } from 'react';
import styles from './Entity.module.css';

/**
 * Wikidata wordmarks (scripts/enrich_studios_wikidata.ts) are mostly dark
 * text on a transparent background, so they sit on a white plate. A logo an
 * admin uploads is shown exactly as the image — filling the whole tile, no
 * plate and no padding (2026-11-01: the plate drew a white frame around
 * uploaded logos).
 */
export function isPlatedLogo(src: string): boolean {
  return src.includes('/brand/studios/');
}

/**
 * A studio's official logo (added by admins from the dashboard), or a
 * lettered tile until there is one — never a stock image.
 */
export function StudioLogo({ name, src, size = 'md', fill }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg'; fill?: boolean }) {
  const [failed, setFailed] = useState(false);
  const letters = name
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  // Black-and-grey tile (matches the UI); a slightly different shade per name.
  const shade = 18 + ([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 3) % 10);
  const cls = `${styles.logo} ${size === 'lg' ? styles.logoLg : size === 'sm' ? styles.logoSm : ''}`;
  if (src && !failed) {
    return (
      <span className={`${cls} ${styles.logoImage} ${(fill ?? !isPlatedLogo(src)) ? styles.logoFill : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${name} logo`} onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className={cls} style={{ background: `linear-gradient(140deg, hsl(0 0% ${shade}%), hsl(0 0% 6%))` }} aria-hidden="true">
      {letters || '?'}
    </span>
  );
}
