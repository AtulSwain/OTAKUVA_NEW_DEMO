import React from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { advertiseMailto } from '../../lib/support';
import styles from './Footer.module.css';

// Footer (2026-11-03, owner: "a simple line"): brand, "Made with ♥ from
// India", one line of links, copyright. No link columns, no support box.
// Data credits stay in the brand note — AniList's terms ask for the credit.
const LINKS: { href: string; label: string; external?: boolean }[] = [
  { href: '/about', label: 'About Us' },
  { href: advertiseMailto(), label: 'Advertise with us', external: true },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms & Conditions' },
  { href: '/report-content', label: 'Report' },
  { href: '/support#contact', label: 'Contact Us' },
];

export const Footer: React.FC = () => {
  return (
    <footer className={styles.footer} role="contentinfo">
      <div className={styles.footerInner}>
        <div className={styles.brandCol}>
          <span className={styles.brandTitle}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/otakuva-mark.png" alt="" width={40} height={31} className={styles.brandMark} />
            OTAKUVA
          </span>
          <p className={styles.brandDesc}>Track what you watch, rate what you love, and find what&apos;s next.</p>
          <p className={styles.brandNote}>
            Not a streaming platform. Anime data from AniList and MyAnimeList (via Jikan) — see <Link href="/credits">data credits</Link>.
          </p>
        </div>

        <div className={styles.madeIn}>
          <span className={styles.madeInKicker}>Made in India</span>
          <span className={styles.madeWith}>
            Made with <Heart size={13} fill="currentColor" aria-label="love" className={styles.heart} /> from India
          </span>
        </div>

        <nav className={styles.lineNav} aria-label="Footer">
          {LINKS.map((link) =>
            link.external ? (
              <a key={link.label} href={link.href} className={styles.lineLink}>
                {link.label}
              </a>
            ) : (
              <Link key={link.label} href={link.href} className={styles.lineLink}>
                {link.label}
              </Link>
            )
          )}
        </nav>

        <div className={styles.bottomRow}>
          <span>&copy; {new Date().getFullYear()} Copyright OTAKUVA. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
};
