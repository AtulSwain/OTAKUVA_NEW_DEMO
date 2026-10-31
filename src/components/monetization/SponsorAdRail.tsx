'use client';

/**
 * Sponsor ads. The banner spans the full width of its section and keeps the
 * creative's own shape (no letterboxing, no cropping), on phones, tablets and
 * laptops alike. Homepage: the newest ads, all shown. Anime pages: one ad per
 * page view, taken in turn from every enabled anime-page ad, so each gets an
 * equal share of views (src/lib/monetization/rotation.ts).
 */
import { useEffect, useState } from 'react';
import { itemsForTurn, nextTurn } from '../../lib/monetization/rotation';
import styles from './monetization.module.css';

type Ad = { id: string; title: string | null; imageUrl: string | null; videoUrl: string | null; clickUrl: string | null; altText: string | null };
type Placement = 'HOME_ABOVE_HYPE' | 'ANIME_PAGE';

export function SponsorAdRail({ placement = 'HOME_ABOVE_HYPE' }: { placement?: Placement }) {
  const [ads, setAds] = useState<Ad[]>([]);
  useEffect(() => {
    let active = true;
    fetch(`/api/sponsor-ads?placement=${encodeURIComponent(placement)}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active) return;
        const list: Ad[] = Array.isArray(data?.ads) ? data.ads.filter((ad: Ad) => ad.imageUrl || ad.videoUrl) : [];
        setAds(data?.rotate ? itemsForTurn(list, nextTurn(`sponsor:${placement}`), 1) : list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [placement]);

  if (!ads.length) return null;
  return (
    <section className={`${styles.adSection} ${placement === 'ANIME_PAGE' ? styles.animeAdSection : ''}`} aria-label="Sponsored">
      <div className={styles.adLabel}>Sponsored</div>
      <div className={styles.adGrid}>
        {ads.map((ad) => {
          const label = ad.altText || ad.title || 'Sponsored content';
          const media = ad.videoUrl ? (
            <video src={ad.videoUrl} poster={ad.imageUrl || undefined} autoPlay muted loop playsInline aria-label={label} />
          ) : (
            // Plain <img>: the creative is shown at its own aspect ratio, full width.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ad.imageUrl!} alt={label} loading={placement === 'HOME_ABOVE_HYPE' ? 'eager' : 'lazy'} decoding="async" />
          );
          const body = (
            <>
              {media}
              {ad.title && <span className={styles.adTitle}>{ad.title}</span>}
            </>
          );
          return ad.clickUrl ? (
            <a href={ad.clickUrl} target="_blank" rel="sponsored noopener noreferrer" key={ad.id} className={styles.adCard}>
              {body}
            </a>
          ) : (
            <div key={ad.id} className={styles.adCard}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
