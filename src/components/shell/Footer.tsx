import React from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { SupportContact } from './SupportContact';
import styles from './Footer.module.css';

// Owner, 2026-10-25: the link columns (Explore / Community / Studios &
// people / Account) are gone — the header and phone menu already cover them.
// Privacy, Terms and Data credits stay as small links: AniList's terms ask
// for the data credit, and app stores / SMS providers need a privacy policy.
const LEGAL = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/credits', label: 'Data credits' },
];

export const Footer: React.FC = () => {
  return (
    <footer className={styles.footer} role="contentinfo">
      <div className={styles.footerInner}>
        {/* Brand, then support right under "Track what you watch…" (phones: stacked;
            laptops: side by side so the footer's right half isn't empty). */}
        <div className={styles.topRow}>
        <div className={styles.brandCol}>
          <span className={styles.brandTitle}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/otakuva-mark.png" alt="" width={40} height={31} className={styles.brandMark} />
            OTAKUVA
          </span>
          <p className={styles.brandDesc}>Track what you watch, rate what you love, and find what&apos;s next.</p>
          <p className={styles.brandNote}>
            Not a streaming platform. Anime data from AniList and MyAnimeList (via Jikan) — see{' '}
            <Link href="/credits">data credits</Link>.
          </p>
        </div>
        <SupportContact />
        </div>

        <div className={styles.madeIn}>
          <span className={styles.madeInKicker}>Made in India</span>
          <span className={styles.madeWith}>
            Made with <Heart size={13} fill="currentColor" aria-label="love" className={styles.heart} /> from India
          </span>
        </div>

        <div className={styles.bottomRow}>
          <span>&copy; {new Date().getFullYear()} Copyright OTAKUVA</span>
          <nav className={styles.legalNav} aria-label="Legal">
            {LEGAL.map((link) => (
              <Link key={link.href} href={link.href} className={styles.legalLink}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
};
