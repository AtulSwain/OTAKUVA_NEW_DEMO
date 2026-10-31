import { getRequestOrigin, getForwardedCookieHeader } from '../../../lib/server/requestContext';
import AnimeDetailClient from './AnimeDetailClient';
import { getSeasonSeries } from '../../../lib/catalog/seasonSeries';
import { getAnimeFacts } from '../../../lib/anime/animeFacts';
import { ViewBeacon } from '../../../components/analytics/ViewBeacon';

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

async function safeJson(res: PromiseSettledResult<Response>): Promise<any | null> {
  if (res.status !== 'fulfilled' || !res.value.ok) return null;
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
  const fetchOpts = { headers: { cookie }, cache: 'no-store' as const };

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
    fetch(`${origin}/api/anime/${id}`, fetchOpts),
    fetch(`${origin}/api/anime/${id}/characters`, fetchOpts),
    fetch(`${origin}/api/anime/${id}/staff`, fetchOpts),
    fetch(`${origin}/api/anime/${id}/relations`, fetchOpts),
    fetch(`${origin}/api/anime/${id}/rating-summary`, fetchOpts),
    fetch(`${origin}/api/anime/${id}/rating`, fetchOpts),
    fetch(`${origin}/api/discussions?animeId=${id}`, fetchOpts),
    fetch(`${origin}/api/reviews?animeId=${id}`, fetchOpts),
    fetch(`${origin}/api/anime/${id}/news`, fetchOpts),
    fetch(`${origin}/api/anime/${id}/seasons`, fetchOpts),
    fetch(`${origin}/api/anime/${id}/episodes`, fetchOpts),
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

  return (
    <>
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
