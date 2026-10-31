import { getHomeData } from '../lib/home/getHomeData';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthUserFromCookies } from '../lib/auth';
import { GUEST_COOKIE } from '../lib/landing/guest';
import { getBrowseItemById, getBrowseList, getGenreArtwork } from '../lib/browseService';
import { getTodayPick } from '@control/lib/dailyPicks';
import { HomeClient } from './HomeClient';
import { getCachedCreatorDirectory, getFollowedCreatorUsernames } from '../lib/creator/creatorDirectory';

// Server component: every query behind the homepage runs here, at request
// time, so the response HTML already contains the content — no client-side
// fetch-after-hydrate waterfall. HomeClient (a client component) only owns
// the interactive bits (search, local times, auth-aware CTAs).
export default async function HomePage() {
  const authUser = await getAuthUserFromCookies();
  // Signed-out visitors see the landing page first, unless they chose to
  // browse as a guest there (cookie set by /welcome).
  if (!authUser && !cookies().get(GUEST_COOKIE)) redirect('/welcome');
  const [homeData, genreArt, choice, todayPick, creatorData, followedCreatorUsernames] = await Promise.all([
    getHomeData(authUser),
    getGenreArtwork().catch(() => []),
    getBrowseList('choice', {}).catch(() => []),
    getTodayPick(),
    getCachedCreatorDirectory({ feedLimit: 8 }),
    authUser ? getFollowedCreatorUsernames(authUser.id) : Promise.resolve([]),
  ]);

  // OTAKUVA Choice spotlight: today's pick from the control center when one
  // is set (its note replaces the synopsis); otherwise one title per day
  // (UTC) from the OTAKUVA Choice list, preferring wide banner art.
  const picked = todayPick
    ? await getBrowseItemById(todayPick.animeId, todayPick.note ? { synopsis: todayPick.note } : {}).catch(() => null)
    : null;
  const withArt = choice.filter((c) => c.bannerUrl);
  const pool = withArt.length ? withArt : choice;
  const day = Math.floor(Date.now() / 86_400_000);
  const spotlight = picked ?? (pool.length ? pool[day % pool.length] : null);

  // getHomeData()'s return type is inferred from the raw Prisma mapping
  // (mapAnime), which is looser than HomeClient's HomeData shape.
  const initialSections = homeData.sections as any;

  return (
    <HomeClient
      initialSections={initialSections}
      genreArt={genreArt}
      spotlight={spotlight}
      creatorData={creatorData}
      initialFollowedCreators={followedCreatorUsernames}
      initialFollowedUsername={authUser?.username ?? null}
    />
  );
}
