import { NextRequest, NextResponse } from 'next/server';
import { hasMinRole } from '../../../lib/roles';
import { currentRating, getReviewerRatings, reviewerRatingFrom } from '../../../lib/reviews/reviewerRatings';
import { getReviewerRetention } from '../../../lib/reviews/reviewerRetention';
import { prisma } from '../../../lib/prisma';
import { getAuthUserFromRequest, requireVerifiedUser } from '../../../lib/auth';
import { createAndAnalyzeReview } from '../../../lib/engine/review/reviewIntelligence';
import { getAnimeDisplayTitle } from '../../../lib/animeTitleResolver';
import { criticUserWhere, getTierBriefs, getUserBadgeSnapshot } from '../../../lib/badges/queries';
import { feedScore } from '../../../lib/badges/ranking';
import { BADGE_RULES } from '../../../lib/badges/config';
import { BADGE_STRINGS } from '../../../lib/badges/strings';
import { sanitizeReviewTags } from '../../../lib/reviews/reviewTags';
import { getCommunityTags, getRepliesForReviews, getTagsForReviews, setReviewTags } from '../../../lib/reviews/reviewSocial';
import { logger } from '../../../lib/logger';
import { getEpisodeReleaseState } from '../../../lib/rating/episodeRatings';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const animeId = searchParams.get('animeId');
    const episodeId = searchParams.get('episodeId');
    const userId = searchParams.get('userId');
    const sort = searchParams.get('sort') || 'recommended';
    const spoilerFilter = searchParams.get('spoilerLevel');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;
    const criticsOnly = searchParams.get('critics') === '1';

    const authUser = await getAuthUserFromRequest(request);

    const where: any = {
      deletedAt: null,
      status: 'PUBLISHED',
    };
    // Critics filter: only counted reviews by critic-eligible reviewers (see badges/config).
    if (criticsOnly) {
      where.countState = 'COUNTED';
      where.user = criticUserWhere();
    }
    // Creator reviews only (Creator Mode): the label is stamped by the server.
    if (searchParams.get('creators') === '1') {
      where.isCreatorReview = true;
    }

    let canonicalAnimeId: string | null = null;
    if (animeId) {
      const anime = await prisma.anime.findFirst({
        where: { OR: [{ id: animeId }, { slug: animeId }] },
        select: { id: true },
      });
      if (anime) {
        canonicalAnimeId = anime.id;
        where.animeId = anime.id;
      } else {
        where.animeId = animeId;
      }
    }

    if (episodeId) {
      where.episodeId = episodeId;
    }

    const username = searchParams.get('username');
    if (username) {
      const targetUser = await prisma.user.findFirst({
        where: { username },
        select: { id: true },
      });
      if (targetUser) {
        where.userId = targetUser.id;
      } else {
        where.userId = 'no_such_user_found';
      }
    } else if (userId) {
      where.userId = userId;
    }

    if (spoilerFilter) {
      if (spoilerFilter === 'SPOILER_FREE' || spoilerFilter === 'spoiler_free') {
        where.spoilerLevel = 'SPOILER_FREE';
      } else if (spoilerFilter === 'hide_spoilers') {
        where.spoilerLevel = { in: ['SPOILER_FREE', 'MILD_SPOILERS'] };
      } else {
        where.spoilerLevel = spoilerFilter;
      }
    }

    // Determine sort order
    let orderBy: any = { createdAt: 'desc' };
    if (sort === 'helpful') {
      orderBy = { likesCount: 'desc' };
    } else if (sort === 'highest_rated' || sort === 'positive') {
      orderBy = [{ rating: 'desc' }, { likesCount: 'desc' }];
    } else if (sort === 'lowest_rated' || sort === 'critical') {
      orderBy = [{ rating: 'asc' }, { likesCount: 'desc' }];
    } else if (sort === 'oldest') {
      orderBy = { createdAt: 'asc' };
    } else if (sort === 'recommended') {
      orderBy = [{ likesCount: 'desc' }, { createdAt: 'desc' }];
    }

    // The default (recommended) order is re-scored in memory so a reviewer's badge can add
    // a small, capped boost (see badges/ranking.ts): fetch a window, rank it, then page it.
    const isRecommended = sort === 'recommended';
    const [fetched, total] = await Promise.all([
      prisma.review.findMany({
        where,
        orderBy,
        skip: isRecommended ? 0 : skip,
        take: isRecommended ? Math.max(200, skip + limit) : limit,
        include: {
          user: { select: { id: true, username: true, avatarUrl: true } },
          anime: {
            select: {
              id: true,
              slug: true,
              canonicalTitle: true,
              posterUrl: true,
              type: true,
              year: true,
            },
          },
          aspects: true,
        },
      }),
      prisma.review.count({ where }),
    ]);

    // Reviews a moderator pinned to the top of this anime (any page, any sort).
    const pinnedRows = canonicalAnimeId
      ? await prisma.review.findMany({
          where: { animeId: canonicalAnimeId, deletedAt: null, status: 'PUBLISHED', pinnedAt: { not: null } },
          orderBy: { pinnedAt: 'asc' },
          take: 3,
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } },
            anime: {
              select: {
                id: true,
                slug: true,
                canonicalTitle: true,
                posterUrl: true,
                type: true,
                year: true,
              },
            },
            aspects: true,
          },
        })
      : [];

    const everyone = [...fetched, ...pinnedRows];
    const briefs = await getTierBriefs(everyone.map((r) => r.user.id));
    // Each review shows its author's score from the rating section (read live).
    const reviewerRatings = await getReviewerRatings(everyone.map((r) => ({ userId: r.user.id, animeId: r.anime.id })));
    // Each reviewer's own retention for the anime (their episode average) —
    // shown as their verdict pill ("Hooked", "Peaking"…), 2026-10-25.
    const reviewerRetention = await getReviewerRetention(everyone.map((r) => ({ userId: r.user.id, animeId: r.anime.id })));
    const now = new Date();
    const reviews = isRecommended
      ? [...fetched]
          .sort((a, b) => {
            // Creator reviews lead the default order (owner, 2026-10-24).
            if (a.isCreatorReview !== b.isCreatorReview) return a.isCreatorReview ? -1 : 1;
            const score = (r: (typeof fetched)[number]) =>
              feedScore({ helpfulVotes: r.likesCount, createdAt: r.createdAt, tier: briefs.get(r.user.id)?.tier ?? 'shoshinsha', now });
            return score(b) - score(a);
          })
          .slice(skip, skip + limit)
      : fetched;

    // Check auth user's reaction states for these reviews
    let userLikedReviewIds = new Set<string>();
    let userReview: any = null;

    if (authUser) {
      const reviewIds = reviews.map((r) => r.id);
      if (reviewIds.length > 0) {
        const reactions = await prisma.reviewLike.findMany({
          where: {
            userId: authUser.id,
            reviewId: { in: reviewIds },
            reactionType: 'HELPFUL',
          },
          select: { reviewId: true },
        });
        reactions.forEach((re) => userLikedReviewIds.add(re.reviewId));
      }

      // If viewing an anime, fetch the user's own review if present
      if (canonicalAnimeId) {
        const existingOwnReview = await prisma.review.findFirst({
          where: {
            userId: authUser.id,
            animeId: canonicalAnimeId,
            deletedAt: null,
            // A creator's unpublished draft lives in their dashboard, not here.
            status: { not: 'DRAFT' },
          },
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } },
            anime: {
              select: {
                id: true,
                slug: true,
                canonicalTitle: true,
                posterUrl: true,
                type: true,
                year: true,
              },
            },
            aspects: true,
          },
        });

        if (existingOwnReview) {
          userReview = {
            id: existingOwnReview.id,
            pinnedAt: existingOwnReview.pinnedAt ? existingOwnReview.pinnedAt.toISOString() : null,
            title: existingOwnReview.title,
            body: existingOwnReview.body,
            rating: await currentRating(authUser.id, existingOwnReview.anime.id),
            retention:
              (await getReviewerRetention([{ userId: authUser.id, animeId: existingOwnReview.anime.id }])).get(
                `${authUser.id}|${existingOwnReview.anime.id}`
              ) ?? null,
            spoilerLevel: existingOwnReview.spoilerLevel,
            containsSpoiler: existingOwnReview.containsSpoiler,
            watchStatusAtReview: existingOwnReview.watchStatusAtReview,
            episodeProgressAtReview: existingOwnReview.episodeProgressAtReview,
            edited: existingOwnReview.edited,
            likesCount: existingOwnReview.likesCount,
            overallSentiment: existingOwnReview.overallSentiment,
            reviewType: existingOwnReview.reviewType,
            createdAt: existingOwnReview.createdAt.toISOString(),
            updatedAt: existingOwnReview.updatedAt.toISOString(),
            isOwnReview: true,
            isCreatorReview: existingOwnReview.isCreatorReview,
            user: {
              id: existingOwnReview.user.id,
              username: existingOwnReview.user.username,
              avatarUrl: existingOwnReview.user.avatarUrl,
            },
            anime: {
              id: existingOwnReview.anime.id,
              slug: existingOwnReview.anime.slug,
              title: getAnimeDisplayTitle(existingOwnReview.anime),
              canonicalTitle: getAnimeDisplayTitle(existingOwnReview.anime),
              posterImage: existingOwnReview.anime.posterUrl,
              type: existingOwnReview.anime.type,
              year: existingOwnReview.anime.year,
            },
            aspects: existingOwnReview.aspects.map((a) => ({
              aspect: a.aspect,
              sentiment: a.sentiment,
              sentimentScore: a.sentimentScore,
              confidence: a.confidence,
            })),
          };
        }
      }
    }

    // Which of these reviewers the viewer already follows (Follow button on
    // review cards, 2026-11-06). One small query; none for signed-out viewers.
    const authorIds = Array.from(new Set([...fetched, ...pinnedRows].map((r) => r.user.id)));
    const viewerFollows =
      authUser && authorIds.length
        ? new Set(
            (await prisma.follow.findMany({ where: { followerId: authUser.id, followingId: { in: authorIds } }, select: { followingId: true } })).map(
              (f) => f.followingId
            )
          )
        : new Set<string>();

    const toItem = (r: (typeof fetched)[number]) => ({
      id: r.id,
      pinnedAt: r.pinnedAt ? r.pinnedAt.toISOString() : null,
      title: r.title,
      body: r.body,
      rating: reviewerRatingFrom(reviewerRatings, r.user.id, r.anime.id),
      retention: reviewerRetention.get(`${r.user.id}|${r.anime.id}`) ?? null,
      spoilerLevel: r.spoilerLevel,
      containsSpoiler: r.containsSpoiler,
      watchStatusAtReview: r.watchStatusAtReview,
      episodeProgressAtReview: r.episodeProgressAtReview,
      edited: r.edited,
      likesCount: r.likesCount,
      overallSentiment: r.overallSentiment,
      reviewType: r.reviewType,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      userLiked: userLikedReviewIds.has(r.id),
      isOwnReview: authUser ? r.user.id === authUser.id : false,
      isCreatorReview: r.isCreatorReview,
      user: {
        id: r.user.id,
        username: r.user.username,
        avatarUrl: r.user.avatarUrl,
        // Reviewer's CURRENT tier, not the tier they held when they wrote this review.
        badge: briefs.get(r.user.id) ?? { tier: 'shoshinsha', count: 0 },
        followedByViewer: viewerFollows.has(r.user.id),
      },
      anime: {
        id: r.anime.id,
        slug: r.anime.slug,
        title: getAnimeDisplayTitle(r.anime),
        canonicalTitle: getAnimeDisplayTitle(r.anime),
        posterImage: r.anime.posterUrl,
        type: r.anime.type,
        year: r.anime.year,
      },
      aspects: r.aspects.map((a) => ({
        aspect: a.aspect,
        sentiment: a.sentiment,
        sentimentScore: a.sentimentScore,
        confidence: a.confidence,
      })),
    });
    const parsed = reviews.map(toItem);
    const pinned = pinnedRows.map(toItem);

    // Member-picked tags + replies, for the listed reviews, pinned ones and the viewer's own.
    const socialIds = [...parsed.map((r) => r.id), ...pinned.map((r) => r.id), ...(userReview ? [userReview.id] : [])];
    // Tags and replies are extras: if they can't be read, the reviews must
    // still load for everyone rather than the whole list failing.
    let tagMap = new Map<string, string[]>();
    let replyMap: Awaited<ReturnType<typeof getRepliesForReviews>> = new Map();
    let communityTags: Awaited<ReturnType<typeof getCommunityTags>> | undefined;
    try {
      [tagMap, replyMap, communityTags] = await Promise.all([
        getTagsForReviews(socialIds),
        getRepliesForReviews(socialIds, authUser ? { id: authUser.id, role: authUser.role } : null),
        canonicalAnimeId ? getCommunityTags(canonicalAnimeId) : Promise.resolve(undefined),
      ]);
    } catch (err) {
      logger.error('Review tags/replies unavailable; serving reviews without them', { error: err, route: '/api/reviews', method: 'GET' });
    }
    const withSocial = <T extends { id: string }>(r: T) => ({
      ...r,
      tags: tagMap.get(r.id) ?? [],
      replyCount: replyMap.get(r.id)?.count ?? 0,
      replies: replyMap.get(r.id)?.replies ?? [],
    });

    return NextResponse.json({
      reviews: parsed.map(withSocial),
      /** Pinned by a moderator: shown above everything else. */
      pinned: pinned.map(withSocial),
      /** Whether the viewer may pin/unpin reviews (moderators and admins). */
      canPin: Boolean(authUser && hasMinRole(authUser.role, 'MODERATOR')),
      userReview: userReview ? withSocial(userReview) : null,
      ...(communityTags ? { communityTags } : {}),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Error fetching reviews:', error);
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await requireVerifiedUser(request);
    if (authUser instanceof NextResponse) return authUser;

    const body = await request.json();
    // A `rating` in the body is ignored: reviews don't collect a score any more.
    const { animeId, episodeId, episodeNumber, title, body: reviewBody, spoilerLevel, containsSpoiler } = body;
    const tags = sanitizeReviewTags(body.tags) ?? [];

    // The headline is optional now: the anime page shows the review text,
    // score and tags, not a tagline. Stored as '' when omitted.
    if (!animeId || !reviewBody?.trim()) {
      return NextResponse.json({ error: 'animeId and review body are required' }, { status: 400 });
    }

    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    const trimmedBody = reviewBody.trim();

    if (trimmedTitle.length > 120) {
      return NextResponse.json({ error: 'Review headline cannot exceed 120 characters' }, { status: 400 });
    }

    if (trimmedBody.length < 20) {
      return NextResponse.json({ error: 'Review body must be at least 20 characters long' }, { status: 400 });
    }

    if (trimmedBody.length > 5000) {
      return NextResponse.json({ error: 'Review body cannot exceed 5,000 characters' }, { status: 400 });
    }

    // Resolve canonical anime ID
    const anime = await prisma.anime.findFirst({
      where: { OR: [{ id: animeId }, { slug: animeId }] },
      select: { id: true },
    });
    if (!anime) {
      return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
    }
    const canonicalAnimeId = anime.id;

    // Reviews need something to have watched: none before episode 1 airs.
    const release = await getEpisodeReleaseState(canonicalAnimeId);
    if (!release.isOpen) {
      return NextResponse.json({ error: 'Reviews open when episode 1 airs.' }, { status: 403 });
    }

    // The score comes from the rating section; snapshotted for sort-by-rating.
    const parsedRating = await currentRating(authUser.id, canonicalAnimeId);

    // Validate spoiler level
    const validLevels = ['SPOILER_FREE', 'MILD_SPOILERS', 'SPOILERS', 'FULL_SPOILERS'] as const;
    let validatedSpoilerLevel: (typeof validLevels)[number] = 'SPOILER_FREE';
    if (spoilerLevel && validLevels.includes(spoilerLevel)) {
      validatedSpoilerLevel = spoilerLevel;
    } else if (containsSpoiler) {
      validatedSpoilerLevel = 'SPOILERS';
    }

    // Query user's current watch status from UserAnime to snapshot context
    const userAnime = await prisma.userAnime.findUnique({
      where: {
        userId_animeId: {
          userId: authUser.id,
          animeId: canonicalAnimeId,
        },
      },
      select: { status: true, episodesWatched: true },
    });

    const { review, extractedAspects } = await createAndAnalyzeReview({
      userId: authUser.id,
      animeId: canonicalAnimeId,
      episodeId,
      episodeNumber,
      title: trimmedTitle,
      body: trimmedBody,
      rating: parsedRating,
      spoilerLevel: validatedSpoilerLevel,
      containsSpoiler: validatedSpoilerLevel !== 'SPOILER_FREE',
      watchStatusAtReview: userAnime?.status || null,
      episodeProgressAtReview: userAnime?.episodesWatched ?? null,
    });

    // The review itself is already saved. A tag-write failure must not turn
    // a published review into an error for the author.
    let savedTags = tags;
    if (tags.length > 0) {
      try {
        await setReviewTags(review.id, canonicalAnimeId, tags);
      } catch (err) {
        savedTags = [];
        logger.error('Saving review tags failed; review kept without tags', { error: err, reviewId: review.id, route: '/api/reviews', method: 'POST' });
      }
    }

    // Badge progress for the post-submit nudge ("12 more to Senpai"). Reads the
    // cached stats; this review itself only counts after the maturity window.
    const stored = await prisma.review.findUnique({
      where: { id: review.id },
      select: { countState: true, countRemovalReason: true, wordCount: true },
    });
    const snapshot = await getUserBadgeSnapshot(authUser.id);
    const next = snapshot.progress.next;
    const badge = {
      countState: stored?.countState ?? null,
      ineligibleReason: stored?.countState === 'INELIGIBLE' ? stored.countRemovalReason : null,
      wordsNeeded: Math.max(0, BADGE_RULES.minWords - (stored?.wordCount ?? 0)),
      maturityHours: BADGE_RULES.maturityHours,
      tier: snapshot.tier,
      countedReviewCount: snapshot.countedReviewCount,
      pendingReviewCount: snapshot.pendingReviewCount,
      nextTier: next?.key ?? null,
      remaining: snapshot.progress.remaining,
      message: next ? BADGE_STRINGS.moreTo(snapshot.progress.remaining, next.name) : BADGE_STRINGS.topTier,
    };

    return NextResponse.json({
      success: true,
      review: {
        ...review,
        aspects: extractedAspects,
        tags: savedTags,
      },
      tagsSaved: savedTags.length === tags.length,
      badge,
    });
  } catch (error: any) {
    console.error('Error creating review:', error);
    const status = error.message === 'Anime not found' || error.message === 'Episode not found' ? 404 : 500;
    return NextResponse.json({ error: error.message || 'Failed to create review' }, { status });
  }
}
