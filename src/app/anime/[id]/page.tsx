import { notFound } from 'next/navigation';
import { getRequestOrigin, getForwardedCookieHeader } from '../../../lib/server/requestContext';
import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { GET as animeGET } from '../../api/anime/[id]/route';
import { GET as charactersGET } from '../../api/anime/[id]/characters/route';
import { GET as staffGET } from '../../api/anime/[id]/staff/route';
import { GET as relationsGET } from '../../api/anime/[id]/relations/route';
import { GET as ratingSummaryGET } from '../../api/anime/[id]/rating-summary/route';
import { GET as ratingGET } from '../../api/anime/[id]/rating/route';
import { GET as discussionsGET } from '../../api/discussions/route';
import { GET as reviewsGET } from '../../api/reviews/route';
import { GET as newsGET } from '../../api/anime/[id]/news/route';
import { GET as seasonsGET } from '../../api/anime/[id]/seasons/route';
import { GET as episodesGET } from '../../api/anime/[id]/episodes/route';
import AnimeDetailClient from './AnimeDetailClient';
import { getSeasonSeries } from '../../../lib/catalog/seasonSeries';
import { getAnimeFacts } from '../../../lib/anime/animeFacts';
import { ViewBeacon } from '../../../components/analytics/ViewBeacon';
import type { Metadata } from 'next';
import { animeJsonLd, animeMetadata, getAnimeSeo } from '../../../lib/seo/animeSeo';
import { JsonLd } from '../../../components/seo/JsonLd';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  let seo: Awaited<ReturnType<typeof getAnimeSeo>> | undefined;
  try {
    seo = await getAnimeSeo(params.id);
  } catch {
    return animeMetadata(null); // DB hiccup: don't claim the page is missing
  }
  // notFound() here (not only in the page): metadata resolves before the
  // loading skeleton streams, so the response is a real 404, not a 200.
  if (!seo) notFound();
  return animeMetadata(seo);
}

// Server component: fetches everything the detail view needs at request
// time (via the same Route Handlers the client used to call after mount),
// so the response HTML already has content — no client fetch-after-hydrate
// waterfall. AnimeDetailClient (a client component) owns the interactive
// bits (modals, rating sync, refetch-after-mutation).
function flattenRelations(raw: any[]): any[] {
  return raw
    .map((r) => (r?.relatedAnime ? { ...r.relatedAnime, relationType: r.relationType } : r))
    .filter((r) => r && (r.slug || r.id));
}

async function safeJson(res: PromiseSettledResult<Response | undefined | null>): Promise<any | null> {
  if (res.status !== 'fulfilled' || !res.value || !res.value.ok) return null;
  try {
    return await res.value.json();
  } catch {
    return null;
  }
}

export default async function AnimeDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const origin = getRequestOrigin();
  const cookie = getForwardedCookieHeader();
  // Same Route Handlers as before, called in-process (2026-11-06) instead of
  // over HTTP back to this server: identical logic and JSON, without 11
  // network round trips — which were slow and, on a cold server, could time
  // out and render the page as "not found".
  const forwardedFor = headers().get('x-forwarded-for') || headers().get('x-real-ip') || '';
  const req = (path: string) =>
    new NextRequest(new URL(path, origin), { headers: { cookie, ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}) } });
  const ctx = { params: { id } };
  const call = (run: () => Promise<Response> | Response) => Promise.resolve().then(run);

  const [
    animeRes,
    charRes,
    staffRes,
    relRes,
    ratingSumRes,
    userRateRes,
    discRes,
    revRes,
    newsRes,
    seasonsRes,
    episodesRes,
  ] = await Promise.allSettled([
    call(() => animeGET(req(`/api/anime/${id}`), ctx)),
    call(() => charactersGET(req(`/api/anime/${id}/characters`), ctx)),
    call(() => staffGET(req(`/api/anime/${id}/staff`), ctx)),
    call(() => relationsGET(req(`/api/anime/${id}/relations`), ctx)),
    call(() => ratingSummaryGET(req(`/api/anime/${id}/rating-summary`), ctx)),
    call(() => ratingGET(req(`/api/anime/${id}/rating`), ctx)),
    call(() => discussionsGET(req(`/api/discussions?animeId=${encodeURIComponent(id)}`))),
    call(() => reviewsGET(req(`/api/reviews?animeId=${encodeURIComponent(id)}`))),
    call(() => newsGET(req(`/api/anime/${id}/news`), ctx)),
    call(() => seasonsGET(req(`/api/anime/${id}/seasons`), ctx)),
    call(() => episodesGET(req(`/api/anime/${id}/episodes`), ctx)),
  ]);

  const animeData = await safeJson(animeRes);
  const charData = await safeJson(charRes);
  const staffData = await safeJson(staffRes);
  const relData = await safeJson(relRes);
  const ratingSumData = await safeJson(ratingSumRes);
  const userRateData = await safeJson(userRateRes);
  const discData = await safeJson(discRes);
  const revData = await safeJson(revRes);
  const newsData = await safeJson(newsRes);
  const seasonsData = await safeJson(seasonsRes);
  const episodesData = await safeJson(episodesRes);

  const anime = animeData?.anime ?? animeData?.data?.anime ?? animeData?.data ?? null;

  let characters = anime?.characters || [];
  if (Array.isArray(charData?.characters)) characters = charData.characters;

  let staff = anime?.staff || [];
  if (Array.isArray(staffData?.staff)) staff = staffData.staff;

  let relations = Array.isArray(anime?.relations) ? flattenRelations(anime.relations) : [];
  if (Array.isArray(relData?.relations)) relations = flattenRelations(relData.relations);

  let discussions = anime?.discussions || [];
  if (Array.isArray(discData?.discussions)) discussions = discData.discussions;

  const reviews = Array.isArray(revData?.reviews) ? revData.reviews : [];
  const userReview = revData?.userReview ?? null;
  const pinnedReviews = Array.isArray(revData?.pinned) ? revData.pinned : [];
  const canPinReviews = Boolean(revData?.canPin);
  const communityTags = Array.isArray(revData?.communityTags) ? revData.communityTags : [];
  // Read directly (no HTTP hop); a failure just hides the bar.
  const canonicalId = anime?.id || animeData?.data?.id || animeData?.id;
  const [seasonSeries, facts] = canonicalId
    ? await Promise.all([getSeasonSeries(canonicalId).catch(() => null), getAnimeFacts(canonicalId).catch(() => null)])
    : [null, null];

  const news = Array.isArray(newsData?.articles) ? newsData.articles : [];

  let seasons: any[] = [];
  if (Array.isArray(seasonsData?.directSeasons) && seasonsData.directSeasons.length > 0) {
    seasons = seasonsData.directSeasons;
  } else if (Array.isArray(seasonsData?.seasons)) {
    seasons = seasonsData.seasons;
  }

  const episodes = Array.isArray(episodesData?.episodes) ? episodesData.episodes : [];
  const nextEpisodeNumber = episodesData?.progress?.nextUnwatchedEpisodeNumber ?? null;
  if (seasons.length === 0 && Array.isArray(episodesData?.seasons) && episodesData.seasons.length > 0) {
    seasons = episodesData.seasons;
  }

  // Recommendations are fetched by the client (personalized per signed-in
  // viewer, and cheap), so no need to duplicate that call here — the client
  // component starts with an empty list and fills it in immediately on mount.

  const seo = await getAnimeSeo(id).catch(() => null);

  return (
    <>
    {seo && !seo.isAdult && <JsonLd data={animeJsonLd(seo)} />}
    <ViewBeacon kind="anime" id={canonicalId} />
    <AnimeDetailClient
      id={id}
      initialAnime={anime}
      initialCharacters={characters}
      initialStaff={staff}
      initialRelations={relations}
      initialRatingSummary={ratingSumData}
      initialUserRatingData={userRateData}
      initialDiscussions={discussions}
      initialReviews={reviews}
      initialPinnedReviews={pinnedReviews}
      initialCanPinReviews={canPinReviews}
      initialUserReview={userReview}
      initialCommunityTags={communityTags}
      seasonSeries={seasonSeries}
      facts={facts}
      initialNews={news}
      initialSeasons={seasons}
      initialEpisodes={episodes}
      initialNextEpisodeNumber={nextEpisodeNumber}
      initialRecommendationsRaw={[]}
    />
    </>
  );
}
