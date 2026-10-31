'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Folder } from 'lucide-react';
import { Anime } from '../types/anime';
import type { ReleaseScheduleItem } from '../components/home/ReleaseSchedule';
import { AnimeImage } from '../components/anime/AnimeImage';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { getAnimeDisplayTitle } from '../lib/animeTitleResolver';
import type { FrontPageData } from '../lib/home/frontPage';
import type { GenreArtwork } from '../lib/browseService';
import type { BrowseItem } from '../lib/browse';
import { EditorsPickFeature } from '../components/home/EditorsPickFeature';
import { PeopleRail } from '../components/entity/PeopleRail';
import {
  CommunitiesToJoin,
  LatestReviews,
  Masthead,
  MemberArticles,
  NewsDesk,
  OnAir,
  OnThisDay,
  Rankings,
  SectionHead,
  StudiosToExplore,
  ThisSeason,
  TrendingDiscussions,
} from '../components/home/FrontPage';
import styles from './page.module.css';
import front from '../components/home/FrontPage.module.css';
import { HypeBoard, UpcomingRail } from '../components/hype/HypeBoard';
import { CreatorsSpotlight } from '../components/home/CreatorsSpotlight';
import { MemberCollectionsRail } from '../components/collections/MemberCollectionsRail';
import { CommunityScoreBadge } from '../components/rating/CommunityScoreBadge';
import { VerdictCount } from '../components/rating/VerdictCount';
import { StudioCardGrid } from '../components/studios/StudiosDirectory';
import { SponsorAdRail } from '../components/monetization/SponsorAdRail';
import type { CreatorDirectoryData } from '../lib/creator/creatorDirectory';

type HomeAnime = Anime & { posterUrl?: string };

type TrackingItem = {
  id: string;
  anime: HomeAnime;
  status: string;
  episodesWatched: number;
  totalEpisodes: number | null;
  lists: { id: string; name: string }[];
};

const TRACK_STATUS_LABEL: Record<string, string> = {
  WATCHING: 'Watching',
  PLAN_TO_WATCH: 'Plan to watch',
  COMPLETED: 'Completed',
  ON_HOLD: 'On hold',
  DROPPED: 'Dropped',
};

type CreatorItem = {
  id: string;
  slug: string;
  name: string;
  role?: string;
  imageUrl?: string | null;
  knownFor: HomeAnime[];
  /** Titles in the catalog they have a creative credit on. */
  titleCount?: number;
};

type StudioItem = {
  id: string;
  slug: string;
  name: string;
  imageUrl?: string | null;
  logoUrl?: string | null;
  nativeName?: string | null;
  foundedYear?: number | null;
  city?: string | null;
  closed?: boolean;
  projectCount?: number;
  knownFor: HomeAnime[];
};

type NewsItem = { id: string; slug: string; title: string; summary?: string; imageUrl?: string | null; source: string; date: string; category: string };

type HomeData = {
  tracking?: TrackingItem[];
  /** Released shows by provider score (≥10k votes), highest first. */
  topRated?: HomeAnime[];
  releaseSchedule?: ReleaseScheduleItem[];
  news: NewsItem[];
  creators?: CreatorItem[];
  studios?: StudioItem[];
  frontPage: FrontPageData | null;
};

/**
 * The homepage as a front page (2026-10-19), top to bottom: masthead (search,
 * platform numbers), on air, your library, latest reviews, rankings, this
 * season, browse by genre, the OTAKUVA Choice spotlight, studios, creators,
 * news — then the community corner (talk, member articles, communities,
 * anime history, studio index).
 */
export function HomeClient({
  initialSections,
  genreArt = [],
  spotlight = null,
  creatorData,
  initialFollowedCreators = [],
  initialFollowedUsername = null,
}: {
  initialSections: HomeData;
  genreArt?: GenreArtwork[];
  spotlight?: BrowseItem | null;
  creatorData: CreatorDirectoryData;
  initialFollowedCreators?: string[];
  initialFollowedUsername?: string | null;
}) {
  const { user, openAuthModal } = useAuth();
  const { getItem: getLibraryItem } = useLibrary();
  const data = initialSections;
  const fp = data.frontPage;
  const trackingList = data.tracking || [];
  const creatorsList = data.creators || [];
  const studiosList = data.studios || [];

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        {fp && <Masthead data={fp} username={user?.username ?? null} displayName={user?.displayName ?? null} onJoin={() => openAuthModal('register')} />}

        <SponsorAdRail />

        {/* Hype board: upcoming shows by how members feel — right under the Welcome back masthead. */}
        <div className={front.block}>
          <HypeBoard />
        </div>

        <OnAir items={data.releaseSchedule || []} />

        {/* The viewer's own library, most recently updated first; tags name their own lists. */}
        {user && (
          <section className={front.block} aria-labelledby="tracking">
            <SectionHead kicker="For you" title="You are tracking" id="tracking" href="/library" linkLabel="Library" />
            {trackingList.length > 0 ? (
              <div className={styles.rail}>
                {trackingList.map((item) => {
                  const animeTitle = getAnimeDisplayTitle(item.anime);
                  // Live values from the library (instant after changes on this page).
                  const live = getLibraryItem(item.anime.id);
                  const statusKey = (live?.status || item.status || '').toUpperCase();
                  const statusLabel = TRACK_STATUS_LABEL[statusKey];
                  const watched = live?.episodesWatched ?? item.episodesWatched;
                  const total = item.totalEpisodes && item.totalEpisodes > 0 ? item.totalEpisodes : null;
                  const extraLists = item.lists.length - 2;
                  return (
                    <Link key={item.id} href={`/anime/${item.anime.slug || item.anime.id}`} className={styles.card}>
                      <div className={styles.posterWrapper}>
                        <AnimeImage src={item.anime.posterImage || item.anime.posterUrl} alt={animeTitle} fill sizes="180px" />
                        <CommunityScoreBadge animeId={item.anime.id} variant="overlay" />
                        {statusLabel && <span className={styles.trackStatus}>{statusLabel}</span>}
                      </div>
                      <div className={styles.cardBody}>
                        <strong className={styles.cardTitle}>{animeTitle}</strong>
                        {statusKey === 'WATCHING' && watched > 0 && (
                          <span className={styles.cardMeta}>{total ? `Episode ${watched} of ${total}` : `Episode ${watched}`}</span>
                        )}
                        {item.lists.length > 0 && (
                          <span className={styles.listTags}>
                            {item.lists.slice(0, 2).map((l) => (
                              <span key={l.id} className={styles.listTag} title={`In your list “${l.name}”`}>
                                <Folder size={10} aria-hidden="true" />
                                {l.name}
                              </span>
                            ))}
                            {extraLists > 0 && <span className={styles.listTag}>+{extraLists}</span>}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className={styles.guestOnboardingCard}>
                <div>
                  <h3 className={styles.guestHeading}>Nothing tracked yet</h3>
                  <p className={styles.guestText}>Add anime to your library from any anime page and they’ll show up here.</p>
                </div>
                <Link href="/anime" className={styles.guestBtn}>
                  Find anime <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            )}
          </section>
        )}

        {fp && <LatestReviews reviews={fp.reviews} episodeNotes={fp.creatorEpisodeNotes ?? []} />}
        <CreatorsSpotlight
          initialData={creatorData}
          initialFollowedCreators={initialFollowedCreators}
          initialFollowedUsername={initialFollowedUsername}
        />

        {fp && (
          <>
            {(data.topRated?.length ?? 0) > 0 && (
              <section className={front.block} aria-labelledby="top-rated">
                <SectionHead kicker="Already out · ranked" title="Top Rated" id="top-rated" href="/rankings" linkLabel="All rankings" />
                <div className={styles.rail}>
                  {(data.topRated || []).map((anime, idx) => {
                    const title = getAnimeDisplayTitle(anime);
                    const medal = idx === 0 ? styles.medalGold : idx === 1 ? styles.medalSilver : idx === 2 ? styles.medalBronze : '';
                    return (
                      <Link key={anime.id} href={`/anime/${anime.slug || anime.id}`} className={styles.card}>
                        <div className={styles.posterWrapper}>
                          <AnimeImage src={anime.posterImage || anime.posterUrl} alt={title} fill sizes="180px" />
                          {/* How many members rated or reviewed it (owner, 2026-10-26) — not the % here. */}
                          <VerdictCount animeId={anime.id} className={styles.verdictSmall} />
                          <span className={`${styles.rankNumeral} ${medal}`} aria-label={`Rank ${idx + 1}`}>
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                        </div>
                        <div className={styles.cardBody}>
                          <strong className={styles.cardTitle}>{title}</strong>
                          <span className={styles.cardMeta}>
                            {[anime.type, anime.year].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
            <Rankings rankings={fp.rankings} />
            <div className={front.block}>
              <UpcomingRail />
            </div>
            <ThisSeason season={fp.season} />
          </>
        )}

        {/* Browse by genre: artwork tiles, back in their old place. */}
        {genreArt.length > 0 && (
          <section className={front.block} aria-labelledby="home-genres">
            <SectionHead kicker="Find your next favourite" title="Browse by Genre" id="home-genres" href="/browse" linkLabel="All categories" />
            <div className={`${styles.rail} ${styles.genreRail}`}>
              {genreArt.map((g) => {
                const shade = 18 + ([...g.genre].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % 10);
                return (
                  <Link
                    key={g.genre}
                    href={`/anime?genre=${encodeURIComponent(g.genre)}`}
                    className={styles.genreTile}
                    style={g.imageUrl ? undefined : { background: `linear-gradient(135deg, hsl(0 0% ${shade}%), hsl(0 0% 6%))` }}
                  >
                    {g.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.imageUrl} alt={g.fromTitle ? `Artwork from ${g.fromTitle}` : ''} loading="lazy" decoding="async" className={styles.genreImg} />
                    )}
                    <span className={styles.genreShade} aria-hidden="true" />
                    <span className={styles.genreSheen} aria-hidden="true" />
                    <span className={styles.genreText}>
                      <span className={styles.genreName}>{g.genre}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* OTAKUVA Choice: one title a day from the team's curated list. */}
        {spotlight && (
          <EditorsPickFeature
            anime={{
              id: spotlight.id,
              slug: spotlight.slug,
              title: spotlight.title,
              synopsis: spotlight.synopsis,
              bannerImage: spotlight.bannerUrl,
              posterImage: spotlight.posterUrl,
              genres: spotlight.genres,
            }}
            kicker={`OTAKUVA Choice${spotlight.genres.length ? ` · ${spotlight.genres.slice(0, 2).join(' · ')}` : ''}`}
            more={{ href: '/top-picks?tab=choice', label: 'All OTAKUVA Choice' }}
          />
        )}

        {/* Studios: the studios with the most catalogued work, and what they made. */}
        {studiosList.length > 0 && (
          <section className={front.block} aria-labelledby="home-studios">
            <SectionHead kicker="Production" title="Animation Studios" id="home-studios" href="/studios" linkLabel="Explore production" />
            <StudioCardGrid
              studios={studiosList.map((studio) => ({
                id: studio.id,
                slug: studio.slug || studio.id,
                name: studio.name,
                nativeName: studio.nativeName && studio.nativeName !== studio.name ? studio.nativeName : null,
                logoUrl: studio.logoUrl ?? null,
                foundedYear: studio.foundedYear ?? null,
                closed: Boolean(studio.closed),
                city: studio.city ?? null,
                works: studio.projectCount ?? 0,
                firstYear: null,
                latestYear: null,
                posters: studio.knownFor.map((a) => a.posterImage || a.posterUrl).filter((p): p is string => typeof p === 'string' && p.length > 0).slice(0, 3),
                knownFor: studio.knownFor[0] ? getAnimeDisplayTitle(studio.knownFor[0]) : null,
              }))}
            />
          </section>
        )}

        {/* Creators: directors, writers, designers and composers, by creative credits. */}
        {creatorsList.length > 0 && (
          <section className={front.block} aria-labelledby="home-creators">
            <SectionHead kicker="The people behind the stories" title="Creators and Directors" id="home-creators" href="/artists" linkLabel="Directors · Writers · Artists" />
            <PeopleRail
              people={creatorsList.map((c) => ({
                id: c.id,
                slug: c.slug,
                name: c.name,
                imageUrl: c.imageUrl,
                role: c.role,
                note: [
                  typeof c.titleCount === 'number' && c.titleCount > 0 ? `${c.titleCount} ${c.titleCount === 1 ? 'title' : 'titles'}` : null,
                  c.knownFor[0] ? getAnimeDisplayTitle(c.knownFor[0]) : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || null,
              }))}
            />
          </section>
        )}

        <NewsDesk news={data.news || []} />

        {/* Members' public collections (2026-10-22); hidden until there's one. */}
        <MemberCollectionsRail />

        {/* Community corner: moved down from the old sidebar. */}
        {fp && (
          <section className={front.block} aria-label="Community and history">
            <div className={front.corner}>
              <TrendingDiscussions items={fp.discussions} />
              <MemberArticles items={fp.articles} />
              <CommunitiesToJoin items={fp.communities} />
              <OnThisDay items={fp.onThisDay} />
              <StudiosToExplore items={fp.studios} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
