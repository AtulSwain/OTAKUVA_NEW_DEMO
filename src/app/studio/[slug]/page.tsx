import React from 'react';
import { CommunityScoreBadge } from '../../../components/rating/CommunityScoreBadge';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Building2, CalendarDays, ExternalLink, Flag, MapPin, Sparkles, Users } from 'lucide-react';
import { getStudioProfile } from '../../../lib/studios/studioProfile';
import { SectionHead } from '../../../components/ui/SectionHead';
import { StudioLogo } from '../../../components/entity/StudioLogo';
import { PeopleRail } from '../../../components/entity/PeopleRail';
import { WorksGrid } from '../../../components/entity/WorksGrid';
import { GenreChips, PosterRow, StatTiles, WorksTimeline } from '../../../components/entity/EntityBlocks';
import { resolveMediaUrl } from '../../../lib/mediaResolver';
import styles from '../../../components/entity/Entity.module.css';
import { ViewBeacon } from '../../../components/analytics/ViewBeacon';
import { countAnnouncedAnime, getAnnouncedAnime } from '../../../lib/announcements/announcedAnime';
import { ensureFreshAnnouncements } from '../../../lib/announcements/announcementSync';
import { AnnouncedCard } from '../../../components/announced/AnnouncedCard';
import announcedStyles from '../../../components/announced/Announced.module.css';

export const dynamic = 'force-dynamic';

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const LONG_DATE = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const listJoin = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const s = await getStudioProfile(params.slug);
  if (!s) return { title: 'Studio not found', robots: { index: false } };
  const known = s.knownFor.slice(0, 3).map((w) => w.title).join(', ');
  return {
    title: `${s.name} — Animation Studio`,
    description: [`${s.stats.works} anime`, known && `Known for ${known}`].filter(Boolean).join(' · '),
  };
}

/**
 * Studio page (2026-10-19 redesign), same design as the homepage and creator
 * pages: hero with the official logo (or a lettered tile until an admin adds
 * one), what the studio is known for, its output over the years, genres, the
 * people behind its work, every work, and the studios it works with.
 */
export default async function StudioPage({ params }: { params: { slug: string } }) {
  const s = await getStudioProfile(params.slug);
  if (!s) notFound();
  ensureFreshAnnouncements();
  // This studio's announced, not-yet-premiered anime — newest announcement first.
  const [announced, announcedTotal] = await Promise.all([
    getAnnouncedAnime({ studioId: s.id, limit: 12 }),
    countAnnouncedAnime({ studioId: s.id }),
  ]);

  const span = s.stats.firstYear && s.stats.latestYear ? (s.stats.firstYear === s.stats.latestYear ? String(s.stats.firstYear) : `${s.stats.firstYear}–${s.stats.latestYear}`) : null;
  const stats = [
    { value: s.stats.works.toLocaleString('en-US'), label: s.stats.works === 1 ? 'anime' : 'anime in the catalog' },
    ...(span ? [{ value: span, label: 'years with credits' }] : []),
    ...(s.stats.airing > 0 ? [{ value: String(s.stats.airing), label: 'airing now' }] : []),
    ...(announcedTotal > 0 ? [{ value: String(announcedTotal), label: 'announced' }] : []),
    ...s.formats.slice(0, 2).map((f) => ({ value: f.count.toLocaleString('en-US'), label: f.type === 'Movie' ? (f.count === 1 ? 'movie' : 'movies') : `${f.type}` })),
    ...(s.stats.averageScore != null ? [{ value: s.stats.averageScore.toFixed(2), label: 'avg. MAL/AniList score' }] : []),
  ];

  return (
    <div className={styles.page}>
      <ViewBeacon kind="studio" id={s.id} />
      <header className={styles.hero}>
        {s.bannerUrl && (
          <div className={styles.heroBanner} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resolveMediaUrl(s.bannerUrl) || s.bannerUrl} alt="" />
          </div>
        )}
        <div className={styles.heroMedia}>
          <StudioLogo name={s.name} src={s.logoUrl ? resolveMediaUrl(s.logoUrl) || s.logoUrl : null} size="lg" />
        </div>
        <div className={styles.heroText}>
          <ul className={styles.badges}>
            <li className={styles.badgeAccent}>Animation studio</li>
            {s.closed && <li>{s.closedYear ? `Closed ${s.closedYear}` : 'Closed'}</li>}
            {s.verified && <li>Verified</li>}
          </ul>
          <h1 className={styles.name}>{s.name}</h1>
          {(s.nativeName || s.aliases.length > 0) && (
            <p className={styles.native}>
              {s.nativeName && <span lang="ja">{s.nativeName}</span>}
              {s.nativeName && s.aliases.length > 0 && ' · '}
              {s.aliases.length > 0 && `Also known as ${s.aliases.join(', ')}`}
            </p>
          )}
          {(s.foundedYear || s.location || s.founders.length > 0 || s.parentCompany) && (
            <ul className={styles.facts}>
              {s.foundedYear && (
                <li>
                  <CalendarDays size={14} aria-hidden="true" /> Founded <strong>{s.foundedDate ? LONG_DATE.format(new Date(s.foundedDate)) : s.foundedYear}</strong>
                </li>
              )}
              {s.location && (
                <li>
                  <MapPin size={14} aria-hidden="true" /> <strong>{s.location}</strong>
                </li>
              )}
              {s.founders.length > 0 && (
                <li>
                  <Flag size={14} aria-hidden="true" /> Founded by <strong>{listJoin(s.founders)}</strong>
                </li>
              )}
              {s.parentCompany && (
                <li>
                  <Building2 size={14} aria-hidden="true" /> Part of <strong>{s.parentCompany}</strong>
                </li>
              )}
            </ul>
          )}
          {s.links.length > 0 && (
            <div className={styles.links}>
              {s.links.map((l) => (
                <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.label} <ExternalLink size={13} aria-hidden="true" />
                </a>
              ))}
            </div>
          )}
          <StatTiles stats={stats} />
        </div>
      </header>

      {announced.length > 0 && (
        <section className={styles.section} aria-labelledby="studio-announced" id="announced">
          <SectionHead kicker="Coming from this studio" title="Announced" id="studio-announced" count={announcedTotal} />
          <div className={announcedStyles.grid}>
            {announced.map((a) => (
              <AnnouncedCard key={a.id} anime={a} />
            ))}
          </div>
        </section>
      )}

      {s.description && (
        <section className={styles.section} aria-labelledby="studio-about">
          <SectionHead kicker="Profile" title="About" id="studio-about" />
          <div className={styles.prose}>
            {s.description.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {s.descriptionSource === 'wikipedia' && (
            <p className={styles.source}>
              From{' '}
              {s.links.find((l) => l.label === 'Wikipedia') ? (
                <a href={s.links.find((l) => l.label === 'Wikipedia')!.url} target="_blank" rel="noopener noreferrer">
                  Wikipedia
                </a>
              ) : (
                'Wikipedia'
              )}
              , licensed{' '}
              <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">
                CC BY-SA 4.0
              </a>
              .
            </p>
          )}
        </section>
      )}

      {s.history.length > 1 && (
        <section className={styles.section} aria-labelledby="studio-history">
          <SectionHead kicker="Timeline" title="History" id="studio-history" />
          <ol className={styles.history}>
            {s.history.map((h) => (
              <li key={h.key} className={`${styles.historyItem} ${h.kind === 'company' ? styles.historyCompany : h.kind === 'upcoming' ? styles.historyUpcoming : ''}`}>
                <span className={styles.historyYear}>{h.year}</span>
                <span className={styles.historyDot} aria-hidden="true" />
                <div className={styles.historyBody}>
                  {h.anime ? (
                    <Link href={`/anime/${h.anime.slug}`} className={styles.historyCard}>
                      <span className={styles.historyThumb}>
                        {h.anime.posterUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={h.anime.posterUrl} alt="" loading="lazy" />
                        )}
                      </span>
                      <span className={styles.historyText}>
                        <span className={styles.historyLabel}>{h.title}</span>
                        <strong>{h.detail}</strong>
                        <span>{[h.anime.type, h.anime.year].filter(Boolean).join(' · ')}</span>
                      </span>
                    </Link>
                  ) : (
                    <div className={styles.historyCard}>
                      <span className={styles.historyText}>
                        <span className={styles.historyLabel}>
                          {h.date ? LONG_DATE.format(new Date(h.date)) : h.kind === 'company' ? 'Company' : 'Output'}
                        </span>
                        <strong>{h.title}</strong>
                        {h.detail && <span>{h.detail}</span>}
                      </span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {s.history.some((h) => h.source === 'Wikidata') && <p className={styles.source}>Company dates from Wikidata; work milestones from the OTAKUVA catalog.</p>}
        </section>
      )}

      {s.knownFor.length > 0 && (
        <section className={styles.section} aria-labelledby="studio-known">
          <SectionHead kicker="Signature work" title="Known for" id="studio-known" />
          <PosterRow items={s.knownFor.map((w) => ({ ...w, note: [w.type, w.year].filter(Boolean).join(' · ') }))} />
        </section>
      )}

      {(s.timeline.length > 1 || s.topRated.length > 0) && (
        <section className={styles.section}>
          <div className={styles.duo}>
            {s.timeline.length > 1 && (
              <div className={styles.panel} aria-labelledby="studio-timeline">
                <SectionHead kicker="Output" title="Works over the years" id="studio-timeline" />
                <WorksTimeline timeline={s.timeline} />
              </div>
            )}
            {s.topRated.length > 0 && (
              <div className={styles.panel} aria-labelledby="studio-top">
                <SectionHead kicker="Charts" title="Highest rated" id="studio-top" />
                <ol className={styles.rankList}>
                  {s.topRated.map((w, i) => (
                    <li key={w.id}>
                      <Link href={`/anime/${w.slug}`} className={styles.rankRow}>
                        <span className={styles.rankNo}>{i + 1}</span>
                        <span className={styles.rankThumb}>
                          {w.posterUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={w.posterUrl} alt="" loading="lazy" />
                          )}
                        </span>
                        <span className={styles.rankText}>
                          <strong>{w.title}</strong>
                          <span>{[w.type, w.year].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className={styles.rankScore}>
                          <CommunityScoreBadge animeId={w.id} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
                <p className={styles.source}>Scores from MyAnimeList and AniList.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {s.genres.length > 0 && (
        <section className={styles.section} aria-labelledby="studio-genres">
          <SectionHead kicker="Style" title="Genres they work in" id="studio-genres" />
          <GenreChips genres={s.genres} />
        </section>
      )}

      {s.people.length > 0 && (
        <section className={styles.section} aria-labelledby="studio-people">
          <SectionHead kicker="The people behind the work" title="Directors, writers & artists" id="studio-people" href="/artists" linkLabel="All creators" />
          <PeopleRail
            people={s.people.map((p) => ({ ...p, note: `${p.works} ${p.works === 1 ? 'work' : 'works'} with ${s.name}` }))}
          />
        </section>
      )}

      {s.works.length > 0 && (
        <section className={styles.section} aria-labelledby="studio-works">
          <SectionHead kicker="Filmography" title="All works" id="studio-works" count={s.works.length} />
          <WorksGrid
            works={s.works.map((w) => ({ ...w, tags: w.credit === 'Main studio' ? [] : [w.credit] }))}
            filters={s.formats.map((f) => ({ value: f.type, count: f.count }))}
            filterBy="type"
            filterLabel="Filter by format"
          />
        </section>
      )}

      {(s.partners.length > 0 || s.communities.length > 0 || s.news.length > 0) && (
        <section className={styles.section}>
          <div className={styles.duo}>
            {s.partners.length > 0 && (
              <div className={styles.panel} aria-labelledby="studio-partners">
                <SectionHead kicker="Co-productions" title="Often works with" id="studio-partners" href="/studios" linkLabel="All studios" />
                <div className={styles.studioGrid}>
                  {s.partners.map((p) => (
                    <Link key={p.id} href={`/studio/${p.slug || p.id}`} className={styles.studioCard}>
                      <StudioLogo name={p.name} src={p.logoUrl} size="sm" />
                      <span className={styles.studioText}>
                        <strong>{p.name}</strong>
                        <span>
                          {p.shared} shared {p.shared === 1 ? 'work' : 'works'}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {(s.communities.length > 0 || s.news.length > 0) && (
              <div className={styles.panel}>
                {s.communities.length > 0 && (
                  <>
                    <SectionHead kicker="Find your people" title="Communities" href="/community" linkLabel="All" />
                    <ul className={styles.list}>
                      {s.communities.map((c) => (
                        <li key={c.id}>
                          <Link href={`/community/${c.slug}`}>
                            <strong>{c.name}</strong>
                            <span>
                              <Users size={11} aria-hidden="true" /> {c.memberCount.toLocaleString('en-US')} {c.memberCount === 1 ? 'member' : 'members'}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {s.news.length > 0 && (
                  <>
                    <SectionHead kicker="Newsroom" title={`${s.name} in the news`} href="/news" linkLabel="All news" />
                    <ul className={styles.list}>
                      {s.news.map((n) => (
                        <li key={n.id}>
                          <Link href={`/news/${n.slug || n.id}`}>
                            <strong>{n.title}</strong>
                            <span>
                              {n.source} · {DATE.format(new Date(n.date))}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {!s.description && (
        <p className={`${styles.note} ${styles.section}`}>
          <Sparkles size={14} aria-hidden="true" /> Everything on this page comes from {s.name}&apos;s works in the OTAKUVA catalog. The official logo and
          profile are added by the OTAKUVA team.
        </p>
      )}
    </div>
  );
}
