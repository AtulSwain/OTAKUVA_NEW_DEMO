/**
 * OTAKUVA — clear all member data before a testing round (2026-11-01, owner).
 *
 *   DATABASE_URL="<target db>" npx tsx scripts/clear_user_data.ts                       # dry run: counts only
 *   DATABASE_URL="<target db>" npx tsx scripts/clear_user_data.ts --apply --confirm-host=<db host>
 *
 * Deletes every account except ADMIN / SUPER_ADMIN. Deleting a User cascades
 * to everything it owns (ratings, episode ratings, reviews + replies, library,
 * ticks, hype, vibes, favorites, lists/collections, articles, communities and
 * their channels/messages, discussions, comments, follows, notifications,
 * badges, reports, recommendations, taste profiles, sessions/tokens…).
 *
 * Kept:
 *   - the anime catalog and everything provider/editorial (anime, studios,
 *     people, characters, news, schedules, relations, streaming, overrides);
 *   - admin accounts and their editorial work (collections, articles, charts,
 *     daily picks, sponsor ads); their *personal* activity (ratings, reviews,
 *     library, hype, vibes, follows, notifications) is cleared like everyone's;
 *   - AuditLog (already anonymised on delete) and anonymous page-view counts.
 * Reset (derived only from member activity, rebuilt as people rate again):
 *   RatingAggregate, RatingCategoryAggregate, AnimeCommunityOpinion,
 *   AnimeBadgeAggregate, AnimeTrendMetric; moderation actions/reports.
 *
 * --apply needs --confirm-host matching the database host, so it can't be
 * pointed at the wrong database by accident. Take a pg_dump backup first.
 * Uploaded files (avatars, banners, covers) stay in storage, unreferenced.
 */
import { prisma } from '../src/lib/prisma';

const APPLY = process.argv.includes('--apply');
const CONFIRM = process.argv.find((a) => a.startsWith('--confirm-host='))?.split('=')[1] ?? '';
const KEEP_ROLES = ['ADMIN', 'SUPER_ADMIN'];

function dbHost(): string {
  try {
    const u = new URL(process.env.DATABASE_URL || '');
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function counts() {
  const notKept = { role: { notIn: KEEP_ROLES } };
  return {
    accountsToDelete: await prisma.user.count({ where: notKept }),
    adminAccountsKept: await prisma.user.count({ where: { role: { in: KEEP_ROLES } } }),
    reviews: await prisma.review.count(),
    ratings: await prisma.animeRating.count(),
    episodeRatings: await prisma.episodeRating.count(),
    libraryEntries: await prisma.userAnime.count(),
    episodeTicks: await prisma.userEpisodeWatch.count(),
    hypeVotes: await prisma.animeHype.count(),
    listsAndCollections: await prisma.userList.count(),
    articles: await prisma.userArticle.count(),
    communities: await prisma.community.count(),
    discussions: await prisma.discussion.count(),
    follows: await prisma.follow.count(),
    notifications: await prisma.notification.count(),
    ratingAggregates: await prisma.ratingAggregate.count(),
    animeCatalog_untouched: await prisma.anime.count(),
  };
}

async function main() {
  const host = dbHost();
  console.log(`Database: ${host}`);
  const admins = await prisma.user.findMany({ where: { role: { in: KEEP_ROLES } }, select: { id: true, username: true, role: true } });
  console.log(`Admin accounts kept: ${admins.map((a) => `${a.username} (${a.role})`).join(', ') || 'none'}`);
  console.log('Before:', await counts());

  if (!APPLY) {
    console.log('\nDry run — nothing deleted. Re-run with --apply --confirm-host=<host shown above, without the /dbname>.');
    return;
  }
  if (!CONFIRM || !host.startsWith(CONFIRM + '/')) {
    console.error(`\nRefusing: --confirm-host must equal this database host (${host.split('/')[0]}).`);
    process.exitCode = 1;
    return;
  }

  const adminIds = admins.map((a) => a.id);
  const mine = { userId: { in: adminIds } };

  // 1. Admins' personal activity (their editorial work is kept).
  if (adminIds.length) {
    await prisma.$transaction([
      prisma.animeRating.deleteMany({ where: mine }),
      prisma.episodeRating.deleteMany({ where: mine }),
      prisma.review.deleteMany({ where: mine }),
      prisma.userAnime.deleteMany({ where: mine }),
      prisma.userEpisodeWatch.deleteMany({ where: mine }),
      prisma.userEpisodeProgress.deleteMany({ where: mine }),
      prisma.animeHype.deleteMany({ where: mine }),
      prisma.favorite.deleteMany({ where: mine }),
      prisma.scheduleReminder.deleteMany({ where: mine }),
      prisma.notification.deleteMany({ where: mine }),
      prisma.activity.deleteMany({ where: mine }),
      prisma.follow.deleteMany({ where: { OR: [{ followerId: { in: adminIds } }, { followingId: { in: adminIds } }] } }),
      prisma.$executeRaw`DELETE FROM "AnimeVibe" WHERE "userId" = ANY(${adminIds})`,
    ]);
    console.log('Cleared admin personal activity.');
  }

  // 2. Every other account — cascades to all of its data.
  const deleted = await prisma.user.deleteMany({ where: { role: { notIn: KEEP_ROLES } } });
  console.log(`Deleted ${deleted.count} accounts (and everything they owned).`);

  // 3. Moderation records and member-derived aggregates.
  await prisma.$transaction([
    prisma.moderationAction.deleteMany({}),
    prisma.report.deleteMany({}),
    prisma.ratingAggregate.deleteMany({}),
    prisma.ratingCategoryAggregate.deleteMany({}),
    prisma.animeCommunityOpinion.deleteMany({}),
    prisma.animeBadgeAggregate.deleteMany({}),
    prisma.animeTrendMetric.deleteMany({}),
  ]);
  console.log('Reset moderation records and community aggregates.');

  console.log('\nAfter:', await counts());
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
