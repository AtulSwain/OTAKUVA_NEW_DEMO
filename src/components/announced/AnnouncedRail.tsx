'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, CalendarDays, ChevronRight, Sparkles } from 'lucide-react';
import type { AnnouncedAnime } from '../../lib/announcements/announcedAnime';
import { isWideBanner, trailerStills } from '../../lib/media/heroArt';
import { SectionHead } from '../ui/SectionHead';
import { sourceLabel } from './AnnouncedCard';
import styles from './Announced.module.css';

const LIST_COUNT = 6;

function metaLine(a: AnnouncedAnime): string {
  const src = sourceLabel(a.source);
  return [a.type, src].filter(Boolean).join(' · ');
}

const mainStudio = (a: AnnouncedAnime) => a.studios[0]?.name ?? null;

/**
 * Homepage "Just Announced" (2026-11-01, reworked same day): front-page
 * layout like the rest of the homepage — one lead announcement with its art,
 * and a hairline list of the next ones. No boxed cards.
 */
export function AnnouncedRail() {
  const [items, setItems] = useState<AnnouncedAnime[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/announced?limit=${LIST_COUNT + 1}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => alive && setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);

  if (items && items.length === 0) return null;

  // Lead = the newest one with wide art among the first few, else the newest.
  const lead = items ? items.slice(0, 4).find((a) => isWideBanner(a.bannerUrl)) ?? items[0] : null;
  const rest = items ? items.filter((a) => a.id !== lead?.id).slice(0, LIST_COUNT) : [];

  return (
    <section className={styles.block} aria-labelledby="home-announced">
      <SectionHead kicker="Studio news" title="Just Announced" id="home-announced" href="/announced" linkLabel="All announcements" />
      {!items || !lead ? (
        <div className={styles.desk} aria-hidden="true">
          <div className={`${styles.skeleton} ${styles.deskLeadSkeleton}`} />
          <div className={styles.deskList}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className={`${styles.skeleton} ${styles.rowSkeleton}`} />
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.desk}>
          <DeskLead anime={lead} />
          <ul className={styles.deskList}>
            {rest.map((a) => (
              <li key={a.id}>
                <Link href={`/anime/${a.slug}`} className={styles.row}>
                  <span className={styles.rowPoster}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {a.posterUrl ? <img src={a.posterUrl} alt="" loading="lazy" /> : null}
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>
                      {a.title}
                      {a.isNew && <span className={styles.rowNew}>New</span>}
                    </span>
                    <span className={styles.rowMeta}>{[metaLine(a), mainStudio(a)].filter(Boolean).join(' · ')}</span>
                    <span className={styles.rowDate}>
                      <CalendarDays size={12} aria-hidden="true" />
                      {a.premiere ? a.premiere : 'Date not announced'}
                    </span>
                  </span>
                  <ChevronRight size={16} className={styles.rowChevron} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DeskLead({ anime: a }: { anime: AnnouncedAnime }) {
  const banner = isWideBanner(a.bannerUrl) ? a.bannerUrl : null;
  const studio = mainStudio(a);
  return (
    <Link href={`/anime/${a.slug}`} className={styles.deskLead}>
      <DeskArt banner={banner} trailerUrl={a.trailerUrl} posterUrl={a.posterUrl} />
      <span className={styles.deskBody}>
        <span className={styles.deskPoster}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {a.posterUrl ? <img src={a.posterUrl} alt="" /> : null}
        </span>
        <span className={styles.deskText}>
          <span className={styles.deskKicker}>
            <Sparkles size={12} aria-hidden="true" /> {a.isNew ? 'New announcement' : 'Latest announcement'}
          </span>
          <span className={styles.deskTitle}>{a.title}</span>
          {a.englishTitle && <span className={styles.deskAlt}>{a.englishTitle}</span>}
          <span className={styles.deskFacts}>
            <span>{metaLine(a)}</span>
            <span>
              <CalendarDays size={13} aria-hidden="true" /> {a.premiere ? `Premieres ${a.premiere}` : 'Date not announced'}
            </span>
            {studio && (
              <span>
                <Building2 size={13} aria-hidden="true" /> {studio}
              </span>
            )}
          </span>
          {a.synopsis && <span className={styles.deskSynopsis}>{a.synopsis}</span>}
          {a.genres.length > 0 && (
            <span className={styles.deskGenres}>
              {a.genres.slice(0, 3).map((g) => (
                <span key={g}>{g}</span>
              ))}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

/**
 * Lead background: the AniList banner, else a still from the anime's own
 * trailer (best quality first, stepping down if YouTube has no such size),
 * else the poster blurred. Same order as the anime page hero.
 */
function DeskArt({ banner, trailerUrl, posterUrl }: { banner: string | null; trailerUrl: string | null; posterUrl: string | null }) {
  const candidates = banner ? [banner] : trailerStills(trailerUrl);
  const [i, setI] = useState(0);
  const src = candidates[i];
  return (
    <span className={styles.deskArt} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          onError={() => setI((n) => n + 1)}
          // YouTube answers a missing size with a 120px grey stand-in, not an error.
          onLoad={(e) => {
            if (!banner && e.currentTarget.naturalWidth < 400) setI((n) => n + 1);
          }}
        />
      ) : posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posterUrl} alt="" className={styles.deskArtBlur} />
      ) : null}
    </span>
  );
}
