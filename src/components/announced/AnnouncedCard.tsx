import React from 'react';
import Link from 'next/link';
import { CalendarDays, Clapperboard, Newspaper, PlayCircle, Sparkles } from 'lucide-react';
import type { AnnouncedAnime } from '../../lib/announcements/announcedAnime';
import { StudioLogo } from '../entity/StudioLogo';
import { isWideBanner } from '../../lib/media/heroArt';
import styles from './Announced.module.css';

const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const SOURCE_LABEL: Record<string, string> = {
  MANGA: 'Manga',
  LIGHT_NOVEL: 'Light novel',
  NOVEL: 'Novel',
  ORIGINAL: 'Original',
  VIDEO_GAME: 'Video game',
  GAME: 'Game',
  WEB_NOVEL: 'Web novel',
  VISUAL_NOVEL: 'Visual novel',
  WEB_MANGA: 'Web manga',
  ANIME: 'Anime',
  OTHER: '',
};

export function sourceLabel(raw: string | null): string | null {
  if (!raw) return null;
  const key = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (key in SOURCE_LABEL) return SOURCE_LABEL[key] || null;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase().replace(/_/g, ' ');
}

function facts(a: AnnouncedAnime): string[] {
  const src = sourceLabel(a.source);
  return [
    a.type,
    src ? `${src} adaptation`.replace('Original adaptation', 'Original') : null,
    a.episodes ? `${a.episodes} episode${a.episodes === 1 ? '' : 's'}` : null,
  ].filter((x): x is string => Boolean(x));
}

/** One announcement: poster + everything stored about the anime and who makes it. */
export function AnnouncedCard({ anime: a, compact = false, hideStudios = false }: { anime: AnnouncedAnime; compact?: boolean; hideStudios?: boolean }) {
  const href = `/anime/${a.slug}`;
  return (
    <article className={`${styles.card} ${compact ? styles.cardCompact : ''}`}>
      <Link href={href} className={styles.poster} aria-label={a.title} tabIndex={-1}>
        {a.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.posterUrl} alt="" loading="lazy" />
        ) : (
          <span className={styles.posterEmpty}>{a.title.slice(0, 1)}</span>
        )}
        {a.isNew && (
          <span className={styles.newTag}>
            <Sparkles size={11} aria-hidden="true" /> New
          </span>
        )}
      </Link>

      <div className={styles.body}>
        <p className={styles.kicker}>{facts(a).join(' · ')}</p>
        <h3 className={styles.title}>
          <Link href={href}>{a.title}</Link>
        </h3>
        {(a.englishTitle || a.nativeTitle) && (
          <p className={styles.alt}>
            {a.englishTitle}
            {a.englishTitle && a.nativeTitle && ' · '}
            {a.nativeTitle && <span lang="ja">{a.nativeTitle}</span>}
          </p>
        )}
        {a.continues && (
          <p className={styles.continues}>
            {a.continues.label} <Link href={`/anime/${a.continues.slug}`}>{a.continues.title}</Link>
          </p>
        )}

        <p className={styles.premiere}>
          <CalendarDays size={14} aria-hidden="true" />
          {a.premiere ? (
            <>
              Premieres <strong>{a.premiere}</strong>
            </>
          ) : (
            <span className={styles.muted}>Premiere date not announced yet</span>
          )}
        </p>

        {!hideStudios && a.studios.length > 0 && (
          <ul className={styles.studios} aria-label="Studios">
            {a.studios.slice(0, compact ? 2 : 3).map((s) => (
              <li key={s.id}>
                <Link href={`/studio/${s.slug || s.id}`} className={styles.studio}>
                  <StudioLogo name={s.name} src={s.logoUrl} size="sm" />
                  <span>{s.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {a.genres.length > 0 && (
          <ul className={styles.genres}>
            {a.genres.slice(0, 3).map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        )}

        {!compact && a.synopsis && <p className={styles.synopsis}>{a.synopsis}</p>}

        <div className={styles.foot}>
          {a.news.latest ? (
            <Link href={`/news/${a.news.latest.slug}`} className={styles.news} title={a.news.latest.title}>
              <Newspaper size={13} aria-hidden="true" />
              <span>
                {a.news.latest.sourceName} · {SHORT.format(new Date(a.news.latest.publishedAt))}
                {a.news.count > 1 && ` · ${a.news.count} stories`}
              </span>
            </Link>
          ) : null}
          {a.trailerUrl && (
            <a href={a.trailerUrl} target="_blank" rel="noopener noreferrer" className={styles.footLink}>
              <PlayCircle size={13} aria-hidden="true" /> Trailer
            </a>
          )}
          {a.hyped > 0 && (
            <span className={styles.hyped}>
              <Sparkles size={13} aria-hidden="true" /> {a.hyped.toLocaleString('en-US')} hyped
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/** The latest announcement with wide art, shown big at the top of /announced. */
export function AnnouncedLead({ anime: a }: { anime: AnnouncedAnime }) {
  const banner = isWideBanner(a.bannerUrl) ? a.bannerUrl : null;
  return (
    <article className={styles.lead}>
      <div className={styles.leadArt} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {banner ? <img src={banner} alt="" /> : a.posterUrl ? <img src={a.posterUrl} alt="" className={styles.leadBlur} /> : null}
      </div>
      <div className={styles.leadInner}>
        <Link href={`/anime/${a.slug}`} className={styles.leadPoster} tabIndex={-1} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {a.posterUrl && <img src={a.posterUrl} alt="" />}
        </Link>
        <div className={styles.leadText}>
          <p className={styles.leadKicker}>
            <Clapperboard size={13} aria-hidden="true" /> Latest announcement
          </p>
          <h2 className={styles.leadTitle}>
            <Link href={`/anime/${a.slug}`}>{a.title}</Link>
          </h2>
          {a.englishTitle && <p className={styles.alt}>{a.englishTitle}</p>}
          <p className={styles.leadFacts}>
            {[...facts(a), a.premiere ? `Premieres ${a.premiere}` : 'Date not announced'].join(' · ')}
          </p>
          {a.continues && (
            <p className={styles.continues}>
              {a.continues.label} <Link href={`/anime/${a.continues.slug}`}>{a.continues.title}</Link>
            </p>
          )}
          {a.studios.length > 0 && (
            <ul className={styles.studios} aria-label="Studios">
              {a.studios.slice(0, 3).map((s) => (
                <li key={s.id}>
                  <Link href={`/studio/${s.slug || s.id}`} className={styles.studio}>
                    <StudioLogo name={s.name} src={s.logoUrl} size="sm" />
                    <span>{s.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {a.synopsis && <p className={styles.leadSynopsis}>{a.synopsis}</p>}
          <div className={styles.leadActions}>
            <Link href={`/anime/${a.slug}`} className={styles.primaryBtn}>
              View details
            </Link>
            {a.trailerUrl && (
              <a href={a.trailerUrl} target="_blank" rel="noopener noreferrer" className={styles.ghostBtn}>
                <PlayCircle size={15} aria-hidden="true" /> Watch trailer
              </a>
            )}
            {a.news.latest && (
              <Link href={`/news/${a.news.latest.slug}`} className={styles.ghostBtn}>
                <Newspaper size={15} aria-hidden="true" /> Read the news
              </Link>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
