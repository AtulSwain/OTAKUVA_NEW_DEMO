'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './monetization.module.css';
type Ad = { id: string; title: string | null; imageUrl: string | null; videoUrl: string | null; clickUrl: string | null; altText: string | null };
type Placement = 'HOME_ABOVE_HYPE' | 'ANIME_PAGE';
export function SponsorAdRail({ placement = 'HOME_ABOVE_HYPE' }: { placement?: Placement }) {
  const [ads, setAds] = useState<Ad[]>([]);
  useEffect(() => {
    fetch(`/api/sponsor-ads?placement=${encodeURIComponent(placement)}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setAds(data?.ads || []))
      .catch(() => {});
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
          ) : ad.imageUrl ? (
            <Image src={ad.imageUrl} alt={label} width={1200} height={390} unoptimized />
          ) : null;
          return ad.clickUrl ? (
            <Link href={ad.clickUrl} target="_blank" rel="sponsored noopener noreferrer" key={ad.id} className={styles.adCard}>
              {media}
              {ad.title && <span>{ad.title}</span>}
            </Link>
          ) : (
            <div key={ad.id} className={styles.adCard}>
              {media}
              {ad.title && <span>{ad.title}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
