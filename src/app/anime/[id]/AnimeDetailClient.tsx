'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { notifyCommunityScoresChanged } from '../../../lib/rating/useCommunityScore';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Anime } from '../../../types/anime';
import { AnimeHero } from '../../../components/anime/AnimeHero';
import { WhereToWatch } from '../../../components/anime/WhereToWatch';
import { OtakuvaVibe } from '../../../components/anime/OtakuvaVibe';
import { VibeModal } from '../../../components/anime/VibeModal';
import type { VibeSummary } from '../../../lib/rating/vibeGrades';
import { CharacterPreview } from '../../../components/anime/CharacterPreview';
import { EpisodeQuickList } from '../../../components/anime/EpisodeQuickList';
import { StaffRail } from '../../../components/anime/StaffRail';
import { ProductionTimeline, buildTimelineEvents } from '../../../components/anime/ProductionTimeline';
import { PersonalizedRecommendations, RecommendationItem } from '../../../components/anime/PersonalizedRecommendations';
import { AnimeNewsList } from '../../../components/anime/AnimeNewsList';
import { AnimeCreators } from '../../../components/anime/AnimeCreators';
import { AnimeReviewsCard } from '../../../components/anime/AnimeReviewsCard';
import type { CommunityTag } from '../../../lib/reviews/reviewSocial';
import type { SeasonSeries } from '../../../lib/catalog/seasonSeries';
import { SeasonBar } from '../../../components/anime/SeasonBar';
import type { AnimeFacts } from '../../../lib/anime/animeFacts';
import { AnimeDetails } from '../../../components/anime/AnimeDetails';
import { promptPhoneVerification } from '../../../components/auth/VerifyPhonePrompt';
import { ReviewBadgeHighlights } from '../../../components/anime/ReviewBadgeHighlights';
import { AnimeCommunityHub } from '../../../components/anime/AnimeCommunityHub';
import { UserActivityCard } from '../../../components/anime/UserActivityCard';
import { AnimeImage } from '../../../components/anime/AnimeImage';
import { AnimeStickyActionBar } from '../../../components/anime/AnimeStickyActionBar';
import { AnimeSectionNav, type SectionLink } from '../../../components/anime/AnimeSectionNav';
import { RatingModal } from '../../../components/rating/RatingModal';
import { EpisodeRetentionModal, type EpisodeRetentionSummary } from '../../../components/rating/EpisodeRetentionModal';
import { PremiereCountdown } from '../../../components/anime/PremiereCountdown';
import { RetentionSummary } from '../../../components/anime/RetentionSummary';
import { HypeMeter } from '../../../components/hype/HypeMeter';
import { CommissionProducts } from '../../../components/monetization/CommissionProducts';
import { SponsorAdRail } from '../../../components/monetization/SponsorAdRail';
import { WriteReviewModal } from '../../../components/review/WriteReviewModal';
import { TrailerModal } from '../../../components/ui/TrailerModal';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { useLibrary } from '../../../context/LibraryContext';
import { RatingSummaryResult, RatingCategoryType } from '../../../lib/rating/ratingEngine';
import { getAnimeDisplayTitle } from '../../../lib/animeTitleResolver';
import { hasAnimePremiered } from '../../../lib/anime/premiereStatus';
import styles from './anime.module.css';

// Fixed locale + UTC, same reasoning as timelineEvents.ts: this renders on a
// server-rendered page, so a runtime-default locale/timezone would render
// differently on the server vs. the browser and fail hydration.
function formatPremiereDate(value?: string | null, precision?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (precision === 'YEAR') return String(d.getUTCFullYear());
  if (precision === 'MONTH') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function toRecommendationItems(raw: any[]): RecommendationItem[] {
  return raw
    .filter((r) => r && r.slug && r.canonicalTitle)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.canonicalTitle,
      posterImage: r.posterUrl || null,
      score: typeof r.score === 'number' ? r.score : null,
      genre: Array.isArray(r.genres) && r.genres.length > 0 ? r.genres.slice(0, 2).join(' • ') : null,
      reason: r.explanation || null,
      bannerUrl: r.bannerUrl || null,
      type: r.type || null,
      year: typeof r.year === 'number' ? r.year : null,
      genres: Array.isArray(r.genres) ? r.genres.filter((g: unknown) => typeof g === 'string') : [],
      studios: Array.isArray(r.studios) ? r.studios.filter((s: unknown) => typeof s === 'string') : [],
      matchReasons: Array.isArray(r.matchReasons) ? r.matchReasons.filter((m: unknown) => typeof m === 'string') : [],
    }));
}

interface AnimeDetailClientProps {
  id: string;
  initialAnime: Anime | null;
  initialCharacters: any[];
  initialStaff: any[];
  initialRelations: any[];
  initialRatingSummary: RatingSummaryResult | null;
  initialUserRatingData: {
    authenticated?: boolean;
    hasRated: boolean;
    yourRating: number | null;
    yourCategoryRatings?: Partial<Record<RatingCategoryType, number>>;
  } | null;
  initialDiscussions: any[];
  initialReviews: any[];
  initialUserReview: any;
  /** Reviews a moderator pinned to the top. */
  initialPinnedReviews?: any[];
  /** Viewer may pin/unpin reviews (moderators and admins). */
  initialCanPinReviews?: boolean;
  initialNews: any[];
  initialSeasons: any[];
  initialEpisodes: any[];
  initialNextEpisodeNumber: number | null;
  initialRecommendationsRaw: any[];
  initialCommunityTags?: CommunityTag[];
  seasonSeries?: SeasonSeries | null;
  facts?: AnimeFacts | null;
}

export default function AnimeDetailClient({
  id,
  initialAnime,
  initialCharacters,
  initialStaff,
  initialRelations,
  initialRatingSummary,
  initialUserRatingData,
  initialDiscussions,
  initialReviews,
  initialUserReview,
  initialPinnedReviews = [],
  initialCanPinReviews = false,
  initialNews,
  initialSeasons,
  initialEpisodes,
  initialNextEpisodeNumber,
  initialRecommendationsRaw,
  initialCommunityTags = [],
  seasonSeries = null,
  facts = null,
}: AnimeDetailClientProps) {
  const { user, openAuthModal, openAuthModalWithIntent, consumePendingIntent, pendingIntent } = useAuth();
  const { showToast } = useToast();
  const { getItem: getLibraryItem } = useLibrary();

  const [anime] = useState<Anime | null>(initialAnime);
  const [characters] = useState<any[]>(initialCharacters);
  const [staff] = useState<any[]>(initialStaff);
  const [relations] = useState<any[]>(initialRelations);
  const [ratingSummary, setRatingSummary] = useState<RatingSummaryResult | null>(initialRatingSummary);
  const [userRatingData, setUserRatingData] = useState<{
    authenticated?: boolean;
    hasRated: boolean;
    yourRating: number | null;
    yourCategoryRatings?: Partial<Record<RatingCategoryType, number>>;
  } | null>(initialUserRatingData);
  const [guestRating, setGuestRating] = useState<{
    score: number;
    categoryScores?: Partial<Record<RatingCategoryType, number>>;
  } | null>(null);
  const [reviews, setReviews] = useState<any[]>(initialReviews);
  const [userReview, setUserReview] = useState<any>(initialUserReview);
  const [pinnedReviews, setPinnedReviews] = useState<any[]>(initialPinnedReviews);
  const [canPinReviews, setCanPinReviews] = useState<boolean>(initialCanPinReviews);
  const [communityTags, setCommunityTags] = useState<CommunityTag[]>(initialCommunityTags);
  const [reviewToEdit, setReviewToEdit] = useState<any>(null);
  const [news] = useState<any[]>(initialNews);
  const [seasons] = useState<any[]>(initialSeasons);
  const [episodes] = useState<any[]>(initialEpisodes);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>(toRecommendationItems(initialRecommendationsRaw));
  // Server-computed "lowest unwatched released episode" for the viewer.
  const [nextEpisodeNumber, setNextEpisodeNumber] = useState<number | null>(initialNextEpisodeNumber);

  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [isTrailerOpen, setIsTrailerOpen] = useState(false);
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  // Episodes are rated separately from the anime: retention % per aired
  // episode, opened by clicking it in the episode guide.
  const [episodeSummary, setEpisodeSummary] = useState<EpisodeRetentionSummary | null>(null);
  // OTAKUVA Vibe (grades per aspect) + its "What's your vibe?" window.
  const [vibe, setVibe] = useState<VibeSummary | null>(null);
  const [isVibeOpen, setIsVibeOpen] = useState(false);
  const [ratingEpisode, setRatingEpisode] = useState<number | null>(null);
  // Set when episode 1 airs while the page is open (countdown reached zero).
  const [justPremiered, setJustPremiered] = useState(false);

  // Sync guest rating from localStorage if unauthenticated
  useEffect(() => {
    if (typeof window !== 'undefined' && !user) {
      try {
        const storedKey = anime?.id ? `otakuva_guest_rating_${anime.id}` : `otakuva_guest_rating_${id}`;
        const stored = localStorage.getItem(storedKey) || localStorage.getItem(`otakuva_guest_rating_${id}`);
        if (stored) {
          setGuestRating(JSON.parse(stored));
        } else {
          setGuestRating(null);
        }
      } catch {
        // ignore
      }
    } else if (user) {
      setGuestRating(null);
    }
  }, [user, id, anime?.id]);

  // Compute effective user rating considering guest fallback
  const effectiveUserRating = userRatingData?.yourRating ?? guestRating?.score ?? null;
  const effectiveCategoryRatings = userRatingData?.yourCategoryRatings ?? guestRating?.categoryScores ?? {};

  const loadVibe = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/anime/${encodeURIComponent(id)}/vibe`, { cache: 'no-store' });
      if (res.ok) setVibe(await res.json());
    } catch {
      /* the chart just stays as it was */
    }
  }, [id]);
  useEffect(() => {
    loadVibe();
  }, [loadVibe, user?.id]);

  const fetchRatingSummary = async () => {
    // Aspect scores from the 1–10 window feed the Vibe too.
    loadVibe();
    try {
      const [sumRes, userRateRes] = await Promise.allSettled([
        fetch(`/api/anime/${id}/rating-summary`, { cache: 'no-store' }),
        fetch(`/api/anime/${id}/rating`, { cache: 'no-store' }),
      ]);
      if (sumRes.status === 'fulfilled' && sumRes.value.ok) {
        const sumData = await sumRes.value.json();
        setRatingSummary(sumData);
      }
      if (userRateRes.status === 'fulfilled' && userRateRes.value.ok) {
        const userData = await userRateRes.value.json();
        setUserRatingData(userData);
      }
    } catch (e) {
      console.error('Error fetching rating summary:', e);
    }
  };

  // Re-fetch ratings when auth state hydrates or user logs in (the initial
  // render already has server-fetched data seeded above, so this settles to
  // the same values for a returning visitor and only actually changes
  // anything right after a client-side login).
  useEffect(() => {
    if (id) {
      fetchRatingSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  // Aired episodes + retention for the episode guide (and the viewer's own).
  // Also loaded before the premiere: it carries the next episode's air time
  // for the countdown, and says (server-side) when rating has opened.
  const episodeAnimeId = anime?.id;
  const loadEpisodeSummary = React.useCallback(async (): Promise<EpisodeRetentionSummary | null> => {
    if (!episodeAnimeId) return null;
    try {
      const res = await fetch(`/api/anime/${encodeURIComponent(episodeAnimeId)}/episode-ratings`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = (await res.json()) as EpisodeRetentionSummary;
      setEpisodeSummary(data);
      return data;
    } catch {
      return null; /* the guide falls back to its progress counter */
    }
  }, [episodeAnimeId]);
  useEffect(() => {
    loadEpisodeSummary();
  }, [user?.id, loadEpisodeSummary]);

  // Countdown hit zero: ask the server (it decides when rating opens) and
  // unlock right away; retry a few times in case the clocks are a bit apart.
  const handlePremiereArrived = React.useCallback(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const data = await loadEpisodeSummary();
      if (data?.isOpen) {
        setJustPremiered(true);
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }, [loadEpisodeSummary]);

  // Resume pending action intent after login. Rating/review intents are
  // only honored once the title has actually aired — a pending intent
  // captured before that (shouldn't normally happen, since the buttons
  // that create one are already hidden pre-premiere, but a stale/replayed
  // intent is possible) must not silently open the rating flow anyway.
  // Premiered by status, or — before the provider status catches up — because
  // the server says episode 1's air time has passed.
  const hasPremiered = hasAnimePremiered(anime?.status) || Boolean(episodeSummary?.isOpen);
  useEffect(() => {
    if (user && pendingIntent) {
      const intent = consumePendingIntent();
      const isRatingOrReviewIntent =
        intent && (intent.type === 'RATE_ANIME' || intent.type === 'OPEN_RATING_MODAL' || intent.type === 'WRITE_REVIEW');
      if (isRatingOrReviewIntent && !hasPremiered) {
        showToast("Ratings and reviews open once this title has premiered.", 'info');
      } else if (
        intent &&
        (intent.animeId === id ||
          intent.animeId === anime?.slug ||
          intent.animeId === anime?.id)
      ) {
        if (intent.type === 'RATE_ANIME') {
          const targetScore = intent.score;
          if (typeof targetScore === 'number') {
            let catScores = (intent as any).categoryScores;
            if (!catScores && typeof window !== 'undefined') {
              try {
                const stored =
                  localStorage.getItem(`otakuva_guest_rating_${anime?.id || id}`) ||
                  localStorage.getItem(`otakuva_guest_rating_${id}`);
                if (stored) catScores = JSON.parse(stored)?.categoryScores;
              } catch {}
            }

            fetch(`/api/anime/${anime?.id || id}/rating`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                score: targetScore,
                categoryScores: catScores,
              }),
            })
              .then(async (res) => {
                if (res.ok) {
                  if (typeof window !== 'undefined') {
                    localStorage.removeItem(`otakuva_guest_rating_${id}`);
                    if (anime?.id) localStorage.removeItem(`otakuva_guest_rating_${anime.id}`);
                  }
                  setGuestRating(null);
                  notifyCommunityScoresChanged();
                  showToast(`★ ${targetScore.toFixed(1)} rating synced to your account!`, 'success');
                  await fetchRatingSummary();
                } else {
                  // Keep the local rating so nothing is lost, and tell the user why it didn't sync.
                  const body = await res.json().catch(() => ({} as { error?: string }));
                  showToast(body.error || 'Your rating could not be saved to your account. Please try again.', 'error', 6000);
                }
              })
              .catch((err) => {
                console.error('Error syncing pending rating after login:', err);
                showToast('Could not reach the server to save your rating. Please try again.', 'error', 6000);
              });
          } else {
            setIsRatingModalOpen(true);
          }
        } else if (intent.type === 'OPEN_RATING_MODAL') {
          setIsRatingModalOpen(true);
        } else if (intent.type === 'WRITE_REVIEW') {
          setIsReviewModalOpen(true);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pendingIntent, id, anime, consumePendingIntent, showToast]);

  // Recommendations are personalised for a signed-in viewer, so they reload
  // when auth changes. No results means no section — never a stock list.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`/api/anime/${id}/recommendations`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setRecommendations(toRecommendationItems(Array.isArray(data?.items) ? data.items : []));
      })
      .catch(() => {
        if (!cancelled) setRecommendations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id, user]);

  // Keep "next episode" in step with the library: when the watched count
  // changes (an episode marked from the guide), ask the server again.
  const watchedCount = anime ? getLibraryItem(anime.id)?.episodesWatched : undefined;
  useEffect(() => {
    if (!user || !anime?.id) {
      setNextEpisodeNumber(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/anime/${anime.id}/episodes?limit=1`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setNextEpisodeNumber(data.progress?.nextUnwatchedEpisodeNumber ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, anime?.id, watchedCount]);

  const timelineEvents = useMemo(() => buildTimelineEvents(anime, relations), [anime, relations]);

  // Only genuine, resolved relations. Padding this with arbitrary titles
  // would assert a relationship between anime that does not exist.
  // A relation stored in both directions comes back twice; show each title once.
  const relatedAnimes = useMemo(() => {
    const seen = new Set<string>();
    return (relations || []).filter((r: any) => {
      const key = r?.id || r?.slug;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [relations]);

  // Related Anime filter chips (Sequel / Prequel / …), only offered when
  // the titles carry 2+ different relation types.
  const [relFilter, setRelFilter] = useState<string>('ALL');
  // Providers send "ADAPTATION" / "SIDE_STORY" / "Side story" — one display form.
  const relLabel = (t?: string | null) => {
    const raw = (t || 'Related').replace(/_/g, ' ').trim();
    return raw === raw.toUpperCase() ? raw.charAt(0) + raw.slice(1).toLowerCase() : raw;
  };
  const relationTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of relatedAnimes as any[]) {
      const t = relLabel(r.relationType);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [relatedAnimes]);
  const visibleRelated = relFilter === 'ALL'
    ? relatedAnimes
    : (relatedAnimes as any[]).filter((r) => relLabel(r.relationType) === relFilter);

  // Deep link from the "you finished it, write a review?" prompt.
  useEffect(() => {
    if (typeof window === 'undefined' || !anime?.id || !user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('write') === '1') {
      setIsReviewModalOpen(true);
      window.history.replaceState(null, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anime?.id, user?.id]);

  if (!anime) {
    return (
      <div className={styles.notFoundContainer}>
        <h2 className={styles.notFoundTitle}>Anime Not Found</h2>
        <p className={styles.notFoundDesc}>The requested anime record could not be found in the database.</p>
        <Link href="/anime" className={styles.backHomeBtn}>
          Back to Anime Catalog
        </Link>
      </div>
    );
  }

  // Only the trailer recorded on the canonical anime. A hardcoded
  // slug→YouTube map used to fill gaps with unverified links.
  const activeTrailerUrl = anime.trailerUrl || null;
  const openTrailer = activeTrailerUrl ? () => setIsTrailerOpen(true) : undefined;

  const totalEp = anime.episodes ?? undefined;
  const displayTitle = getAnimeDisplayTitle(anime);

  // The OTAKUVA score shown on this page is the plain average of OTAKUVA
  // members' ratings, with its rating count — so a rating someone gives shows
  // up as given. (The Bayesian-smoothed figure in RatingAggregate is for
  // ranking, where one early rating shouldn't top a chart; shown here it made
  // a single 9 read as ~7.6.) ratingSummary is refetched after every rating
  // submit/delete, so every surface below updates together.
  const otakuvaRatingCount = ratingSummary?.ratingCount ?? 0;
  const otakuvaScore = otakuvaRatingCount > 0 ? ratingSummary?.rawAverage ?? null : null;

  // Signed-in but unverified accounts can't rate or review (the server
  // enforces this too); say why up front instead of failing on submit.
  const blockedByVerification = (reason: 'rate' | 'review') => {
    if (user && user.phoneVerified === false && user.phoneVerificationRequired !== false) {
      promptPhoneVerification(reason);
      return true;
    }
    return false;
  };

  // The 1–10 star rating is gone (owner, 2026-10-25): members rate each
  // episode's retention instead. "Rate" now takes you to the Episode Guide.
  const handleDetailedRateClick = () => {
    if (!hasPremiered) {
      showToast("Ratings open once this title has premiered.", 'info');
      return;
    }
    document.getElementById('episodes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const fetchReviews = async () => {
    try {
      const revRes = await fetch(`/api/reviews?animeId=${anime?.id || id}`);
      if (revRes.ok) {
        const data = await revRes.json();
        if (data.reviews) setReviews(data.reviews);
        setUserReview(data.userReview ?? null);
        setPinnedReviews(Array.isArray(data.pinned) ? data.pinned : []);
        setCanPinReviews(Boolean(data.canPin));
        if (Array.isArray(data.communityTags)) setCommunityTags(data.communityTags);
      }
    } catch (e) {
      console.error('Failed to reload reviews:', e);
    }
  };

  const handleWriteReviewClick = () => {
    if (!hasPremiered) {
      showToast("Reviews open once this title has premiered.", 'info');
      return;
    }
    if (!user) {
      openAuthModalWithIntent(
        { type: 'WRITE_REVIEW', animeId: anime?.id || id, animeTitle: displayTitle },
        `Sign in to write a community review for ${displayTitle}`
      );
      return;
    }
    if (blockedByVerification('review')) return;
    setIsReviewModalOpen(true);
  };

  // No studio or genre on record means none is shown — these used to fall
  // back to "WIT Studio" and a fixed five-genre list for any anime.
  const rawStudio = (anime as any).studio || (Array.isArray(anime.studios) && anime.studios.length > 0 ? anime.studios[0] : null);
  const mainStudioName: string | undefined = typeof rawStudio === 'string'
    ? rawStudio
    : rawStudio?.name || undefined;
  const studioSlug = typeof rawStudio === 'object' && rawStudio?.slug
    ? rawStudio.slug
    : mainStudioName?.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const genresList = Array.isArray(anime.genres) ? anime.genres : [];

  // "On this page" jump bar — only sections that are actually rendered.
  const sectionLinks: SectionLink[] = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'details', label: 'Details', show: Boolean(facts) },
    { id: 'retention', label: 'Retention', show: hasPremiered },
    { id: 'vibe', label: 'Vibe', show: hasPremiered },
    { id: 'watch', label: 'Watch', show: hasPremiered },
    { id: 'episodes', label: 'Episodes', show: hasPremiered },
    { id: 'reviews', label: 'Reviews', show: hasPremiered },
    { id: 'characters', label: 'Characters', show: characters.length > 0 },
    { id: 'staff', label: 'Staff', show: staff.length > 0 },
    { id: 'related', label: 'Related', show: relatedAnimes.length > 0 },
    { id: 'recommendations', label: 'You might like', show: recommendations.length > 0 },
    { id: 'discussion', label: 'Discussion', show: true },
    { id: 'news', label: 'News', show: Boolean(news && news.length > 0) },
  ].filter((l) => l.show).map(({ id: sid, label }) => ({ id: sid, label }));

  return (
    <div className={styles.page}>
      {/* 1. CINEMATIC HERO (Backdrop, Poster, Title, Title-Side Score, Genre Chips, Actions, Watch Progress) */}
      <AnimeHero
        anime={anime}
        userRating={effectiveUserRating}
        onOpenTrailer={openTrailer}
        onOpenRatingModal={hasPremiered ? handleDetailedRateClick : undefined}
        onOpenReviewDialog={hasPremiered ? handleWriteReviewClick : undefined}
        studioName={mainStudioName}
        studioSlug={studioSlug}
        nextEpisodeNumber={nextEpisodeNumber}
        retention={episodeSummary?.retention ?? null}
        hasPremiered={hasPremiered}
        belowLibrary={
          // Not out yet: the Hype button sits right under Add to Library (2026-10-27, owner).
          !hasPremiered ? <HypeMeter compact animeId={anime.id} animeTitle={displayTitle} /> : undefined
        }
      />

      <main className={styles.mainContainer}>
        <AnimeSectionNav sections={sectionLinks} />
        <div className={styles.layoutGrid}>
          {/* LEFT / MAIN COLUMN: Story, Episodes, Characters, Staff, Timeline, Franchise, Reviews */}
          <div className={styles.mainCol}>
            <SponsorAdRail placement="ANIME_PAGE" />
            {/* 0. NOT OUT YET — the hype meter and premiere countdown lead the page,
                 above the season bar. Ratings, reviews and the episode guide
                 open once it premieres. */}
            {!hasPremiered && (
              <section className={styles.contentSection} aria-label="Premiere status">
                <div className={styles.premiereNotice}>
                  <strong className={styles.premiereNoticeTitle}>Not premiered yet</strong>
                  <p className={styles.premiereNoticeText}>
                    {(() => {
                      const dateStr = formatPremiereDate((anime as any).startDate, (anime as any).datePrecision);
                      return dateStr
                        ? `Ratings, reviews, and the episode guide open once ${displayTitle} premieres on ${dateStr}.`
                        : `Ratings, reviews, and the episode guide open once ${displayTitle} has premiered.`;
                    })()}
                  </p>
                  {episodeSummary?.next && (
                    <PremiereCountdown
                      airingAt={episodeSummary.next.airingAt}
                      episodeNumber={episodeSummary.next.number}
                      onArrived={handlePremiereArrived}
                    />
                  )}
                </div>
              </section>
            )}

            {/* SEASONS — only when the show has 2+ seasons in the catalog */}
            {seasonSeries && seasonSeries.seasons.length > 1 && (
              <section className={styles.contentSection} aria-label="Seasons">
                <SeasonBar series={seasonSeries} />
              </section>
            )}

            {/* 1. OVERVIEW & STORY SYNOPSIS */}
            <section id="overview" className={styles.contentSection} aria-label="Story Overview">
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Overview</h2>
                <span className={styles.sectionSubtitle}>
                  {anime.year ? `${anime.season || ''} ${anime.year}` : 'Official Synopsis'}
                </span>
              </div>
              <p className={`${styles.desc} ${!isSynopsisExpanded ? styles.descCollapsed : ''}`}>
                {anime.synopsis ||
                  'No synopsis available for this title.'}
              </p>
              <button
                type="button"
                className={styles.showMoreBtn}
                onClick={() => setIsSynopsisExpanded((prev) => !prev)}
              >
                <span>{isSynopsisExpanded ? 'Show Less' : 'Show More'}</span>
                {isSynopsisExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </section>


            {/* 1a. DETAILS — every stored fact not already in the hero/overview */}
            {facts && (
              <section id="details" className={styles.contentSection} aria-label="Details">
                <AnimeDetails facts={facts} />
              </section>
            )}

            {/* 1b. RATINGS, AVAILABILITY & YOUR PROGRESS — one open band, no cards.
                 Before premiere there's nothing to rate, stream, or track progress
                 on yet, so this is a single honest notice instead. */}
            {hasPremiered && justPremiered && (
              <section className={styles.contentSection} aria-label="Just premiered">
                <div className={styles.premiereNotice}>
                  <strong className={styles.premiereNoticeTitle}>Episode 1 is out now</strong>
                  <p className={styles.premiereNoticeText}>Rating is open — tell everyone what you thought.</p>
                  <div className={styles.premiereActions}>
                    <button type="button" className={styles.premiereBtnPrimary} onClick={() => setRatingEpisode(1)}>
                      Rate episode 1
                    </button>
                  </div>
                </div>
              </section>
            )}

            {hasPremiered && (
              <section id="retention" className={`${styles.contentSection} ${styles.band}`} aria-label="Retention and your progress">
                <div className={styles.bandCol}>
                  {/* Retention replaced the 1–10 "Community Rating" block here
                      (2026-10-25, owner). The 1–10 rating itself is still
                      given through Rate and feeds OTAKUVA Vibe. */}
                  <RetentionSummary
                    community={episodeSummary?.retention}
                    mine={episodeSummary?.myRetention}
                    released={episodeSummary?.released ?? 0}
                    episodes={episodeSummary?.episodes ?? []}
                    signedIn={Boolean(user)}
                    onRate={() => {
                      const s = episodeSummary;
                      if (!s || s.released < 1) return;
                      // The latest aired episode you haven't rated, else the latest.
                      let n = s.released;
                      for (let i = s.released; i >= 1; i--) if (s.mine[i]?.retention == null) { n = i; break; }
                      setRatingEpisode(n);
                    }}
                  />
                </div>
                <div className={styles.bandCol}>
                  <UserActivityCard
                    animeId={anime.id}
                    totalEpisodes={totalEp}
                    myRetention={episodeSummary?.myRetention?.value ?? null}
                  />
                </div>
              </section>
            )}

            {/* 1d. OTAKUVA VIBE DIMENSIONS & PERCEPTION — an aggregate of
                 members' ratings, so it's meaningless before anyone could
                 have rated the show. */}
            {hasPremiered && (
              <section id="vibe" className={styles.contentSection} aria-label="OTAKUVA Vibe & Perception">
                <OtakuvaVibe
                  vibe={vibe}
                  onOpenVibe={() => {
                    if (!user) return openAuthModal('login');
                    if (blockedByVerification('rate')) return;
                    setIsVibeOpen(true);
                  }}
                />
              </section>
            )}

            {/* 1e. WHERE TO WATCH */}
            {hasPremiered && (
              <section id="watch" className={styles.contentSection} aria-label="Where to Watch">
                <WhereToWatch streamingPlatforms={(anime as any).streaming} />
              </section>
            )}

            {/* CREATORS ON THIS ANIME — who rated / reviewed / is hyped (owner,
                2026-10-24). Shown to everyone; renders nothing if none. */}
            <section className={styles.contentSection} aria-label="Creators">
              <AnimeCreators animeId={anime.id} animeTitle={displayTitle} />
            </section>

            {/* 7. COMPACT SEASON-AWARE EPISODE GUIDE — nothing to guide before
                 the first episode has actually aired. */}
            {hasPremiered && (
              <section id="episodes" className={styles.contentSection} aria-label="Episode Guide">
                <EpisodeQuickList
                  animeId={anime.id}
                  totalEpisodes={totalEp}
                  episodesList={episodes}
                  seasonsList={seasons}
                  animeTitle={displayTitle}
                  onOpenTrailer={openTrailer}
                  ratingSummary={episodeSummary}
                  onSummaryChange={setEpisodeSummary}
                />
              </section>
            )}

            {/* 7a. COMMUNITY REVIEWS — below the Episode Guide (owner, 2026-10-26) — reviews require
                 having watched the show, which isn't possible pre-premiere. */}
            {hasPremiered && (
              <section id="reviews" className={styles.contentSection} aria-label="Community Reviews">
                <ReviewBadgeHighlights animeId={anime.id} animeTitle={displayTitle} />
                <AnimeReviewsCard
                  animeId={anime.id}
                  animeTitle={displayTitle}
                  reviews={reviews}
                  pinned={pinnedReviews}
                  canPin={canPinReviews}
                  userReview={userReview}
                  communityTags={communityTags}
                  onWriteReview={handleWriteReviewClick}
                  onEditReview={(rev) => {
                    setReviewToEdit(rev);
                    setIsReviewModalOpen(true);
                  }}
                  onReviewsChanged={fetchReviews}
                />
              </section>
            )}

            {/* 7b. CHARACTERS & VOICE CAST */}
            <section id="characters" className={styles.contentSection} aria-label="Characters & Voice Cast">
              <CharacterPreview
                characters={characters}
                animeFallbackPoster={anime.posterImage}
              />
            </section>

            {/* 7c. STAFF & KEY CREATORS */}
            <section id="staff" className={styles.contentSection} aria-label="Staff & Creators">
              <StaffRail staff={staff} />
            </section>

            {/* 7d. TIMELINE — always shown; renders its own empty state when
                 there are no recorded dates, rather than fabricating any. */}
            <section className={styles.contentSection} aria-label="Timeline">
              <ProductionTimeline events={timelineEvents} />
            </section>

            {/* 8. RELATED ANIME GRAPH */}
            {relatedAnimes.length > 0 && (
              <section id="related" className={styles.contentSection} aria-label="Related Anime">
                <div className={styles.sectionHead}>
                  <h2 className={styles.sectionTitle}>Related Anime</h2>
                  <span className={styles.sectionSubtitle}>{relatedAnimes.length} titles</span>
                </div>

                {relationTypes.length > 1 && (
                  <div className={styles.relFilters} role="group" aria-label="Filter by relation">
                    {[['ALL', relatedAnimes.length] as [string, number], ...relationTypes].map(([t, c]) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={relFilter === t}
                        className={`${styles.relFilter} ${relFilter === t ? styles.relFilterActive : ''}`}
                        onClick={() => setRelFilter(t)}
                      >
                        {t === 'ALL' ? 'All' : t}
                        <span className={styles.relFilterCount}>{c}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className={styles.relatedCardsGrid}>
                  {visibleRelated.map((rel: any, idx: number) => {
                    const relTitle = rel.title || rel.canonicalTitle || 'Untitled';
                    const relRole = relLabel(rel.relationType);
                    return (
                      <Link
                        key={rel.id || idx}
                        href={`/anime/${rel.slug || rel.id}`}
                        className={styles.relatedCard}
                      >
                        <div className={styles.relatedThumb}>
                          <AnimeImage
                            src={rel.posterImage || rel.posterUrl}
                            alt={relTitle}
                            fill
                            sizes="(max-width: 600px) 50vw, 20vw"
                          />
                        </div>
                        <div className={styles.relatedBody}>
                          <strong className={styles.relatedTitle}>{relTitle}</strong>
                          <div className={styles.relatedMeta}>
                            {rel.type && <span>{rel.type}</span>}
                            {typeof rel.year === 'number' && <span>{rel.type ? '• ' : ''}{rel.year}</span>}
                          </div>
                          <span className={styles.relationChip}>{relRole}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 9. RECOMMENDATIONS — from the recommendation engine; absent when empty */}
            {recommendations.length > 0 && (
              <section id="recommendations" className={styles.contentSection} aria-label="Recommendations">
                <PersonalizedRecommendations recommendations={recommendations} personalized={Boolean(user)} />
              </section>
            )}

            {/* 10. DISCUSSION — threads about this anime (and same-genre ones), communities, member articles */}
            <section className={styles.contentSection} aria-label="Discussion" id="discussion">
              <AnimeCommunityHub animeId={anime.id || id} animeTitle={displayTitle} />
            </section>

            {/* 11. LATEST NEWS ABOUT THIS TITLE */}
            {news && news.length > 0 && (
              <section id="news" className={styles.contentSection} aria-label="Latest News">
                <AnimeNewsList news={news} />
              </section>
            )}

            <CommissionProducts animeId={anime.id} />
          </div>

        </div>
      </main>

      {/* 16. MOBILE/TABLET STICKY ACTION BAR */}
      <AnimeStickyActionBar
        anime={anime}
        userRating={effectiveUserRating}
        onOpenRatingModal={handleDetailedRateClick}
        onOpenTrailer={openTrailer}
        retention={episodeSummary?.retention ?? null}
        hasPremiered={hasPremiered}
      />

      <VibeModal
        isOpen={isVibeOpen}
        onClose={() => setIsVibeOpen(false)}
        animeId={anime.id}
        animeTitle={displayTitle}
        mine={vibe?.mine ?? {}}
        onSaved={setVibe}
      />

      {/* 17. TRAILER MODAL */}
      <TrailerModal
        isOpen={isTrailerOpen}
        onClose={() => setIsTrailerOpen(false)}
        trailerUrl={activeTrailerUrl}
        title={`${displayTitle} - Official Trailer`}
      />

      {/* 18. DETAILED RATING MODAL — isOpen is gated on hasPremiered as a
           second guard, on top of every trigger already being hidden/no-op
           pre-premiere. */}
      <RatingModal
        isOpen={hasPremiered && isRatingModalOpen}
        onClose={() => setIsRatingModalOpen(false)}
        animeId={anime.id}
        animeTitle={displayTitle}
        currentRating={effectiveUserRating}
        currentCategoryRatings={effectiveCategoryRatings}
        onRatingSaved={async (score, categoryScores) => {
          setUserRatingData({
            authenticated: Boolean(user),
            hasRated: true,
            yourRating: score,
            yourCategoryRatings: categoryScores,
          });
          if (!user) {
            setGuestRating({ score, categoryScores });
          }
          await fetchRatingSummary();
        }}
        onRatingDeleted={async () => {
          setUserRatingData({
            authenticated: Boolean(user),
            hasRated: false,
            yourRating: null,
            yourCategoryRatings: {},
          });
          setGuestRating(null);
          if (typeof window !== 'undefined') {
            localStorage.removeItem(`otakuva_guest_rating_${id}`);
            if (anime?.id) localStorage.removeItem(`otakuva_guest_rating_${anime.id}`);
          }
          await fetchRatingSummary();
        }}
      />

      {/* 18b. EPISODE RATING — retention % for one aired episode, separate
           from the anime's own rating above. */}
      <EpisodeRetentionModal
        isOpen={hasPremiered && ratingEpisode !== null}
        onClose={() => setRatingEpisode(null)}
        animeId={anime.id}
        animeTitle={displayTitle}
        episodeNumber={ratingEpisode}
        onChanged={setEpisodeSummary}
      />

      {/* 19. WRITE REVIEW MODAL — same second guard as the rating modal above. */}
      <WriteReviewModal
        isOpen={hasPremiered && isReviewModalOpen}
        onClose={() => {
          setIsReviewModalOpen(false);
          setReviewToEdit(null);
        }}
        animeId={anime.id}
        animeTitle={displayTitle}
        initialReview={reviewToEdit}
        onSuccess={() => {
          fetchReviews();
          fetchRatingSummary();
        }}
      />
    </div>
  );
}
