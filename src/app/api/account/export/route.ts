import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import { RateLimiter } from '../../../../lib/security/rateLimiter';
import { SecurityAuditLogger } from '../../../../lib/security/securityAuditLogger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/account/export — GDPR Art. 15 / CCPA right-to-access self-service.
 *
 * Returns everything in the canonical DB keyed to this account: profile,
 * library/tracking, ratings, reviews, community activity, messages, and
 * the platform's own record of this user's actions (reports filed,
 * moderation actions taken, audit log entries) — anything with a foreign
 * key to `User` in prisma/schema.prisma, except security artifacts that
 * aren't meaningfully "their data" (password hash, password-reset /
 * email-verification tokens).
 *
 * *** [LEGAL REVIEW NEEDED] ***
 * This dumps the *complete* relational graph this account touches, which
 * for an active community member includes things other people can see
 * about them (their own comments/messages/reviews) but not things *other
 * people* wrote *to* or *about* them beyond that — e.g. this does not
 * include reports *filed against* this user by others, DMs sent *to* them
 * by others, or moderator notes about them, since those aren't this
 * user's own data to receive in an access request the same way (they may
 * contain a *different* person's personal data, or be exempt as part of
 * an active moderation process). Whether that scope is correct for GDPR
 * Art. 15 / CCPA in every jurisdiction this product operates in needs a
 * lawyer's sign-off, not an engineering guess.
 */
export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const rate = await RateLimiter.check('ACCOUNT', authUser.id);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many account requests. Please wait before trying again.' },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        // Profile — passwordHash deliberately excluded; there's no
        // legitimate reason to hand a hash back even to its owner, and it
        // only adds risk if the export file leaks.
        id: true,
        username: true,
        email: true,
        emailVerifiedAt: true,
        phone: true,
        phoneVerifiedAt: true,
        avatarUrl: true,
        bannerUrl: true,
        bio: true,
        role: true,
        createdAt: true,
        updatedAt: true,

        // Library & watch tracking
        library: true,
        episodeProgress: true,
        // Per-episode watched ticks by number (anime without Episode rows)
        episodeWatches: true,

        // Ratings
        ratings: true,
        ratingEvents: true,
        ratingRiskSignals: true,
        episodeRatings: true,
        // Hype Meter votes on upcoming anime
        hypes: true,

        // Reviews & reactions
        reviews: true,
        reviewReplies: true,
        reviewLikes: true,
        reviewReports: true,
        favorites: true,

        // Member articles and what the user did on others' articles
        articles: true,
        articleLikes: true,
        articleComments: true,

        // Lists & activity
        customLists: true,
        activities: true,

        // Media the user uploaded
        mediaAssets: true,
        commentMedia: true,

        // Notifications & social graph
        notifications: true,
        followers: true,
        following: true,

        // Community
        ownedCommunities: true,
        communityMemberships: true,
        joinRequests: true,
        communityBans: true,
        discussions: true,
        discussionComments: true,
        discussionFollows: true,
        discussionReactions: true,
        commentReactions: true,
        communityMessages: true,

        // Direct messages
        conversationMemberships: true,
        messagesSent: true,
        messageReactions: true,

        // This user's own actions elsewhere on the platform
        reportsCreated: true,
        moderatorActions: true,
        correctionRequests: true,
        auditLogs: true,
        studioAuditLogs: true,
        authoredStudioVersions: true,
        uploadedStudioMedia: true,
        studioMergesInitiated: true,
        pollVotes: true,

        // Personalization / recommendation data
        tasteProfile: true,
        interestClusters: true,
        recommendationSessions: true,
        recommendationFeedback: true,
        recommendationPredictions: true,
        eventLogs: true,
        scheduleReminders: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    }

    await SecurityAuditLogger.logSecurityEvent({
      eventType: 'ACCOUNT_DATA_EXPORTED',
      actorId: authUser.id,
      targetEntityType: 'User',
      targetEntityId: authUser.id,
    });

    // OTAKUVA Vibe grades per aspect ("What's your vibe?") — plain SQL so it
    // works on a server whose Prisma client predates the table.
    const vibes = await prisma.$queryRaw<{ animeId: string; category: string; grade: string; updatedAt: Date }[]>`
      SELECT "animeId", "category", "grade", "updatedAt" FROM "AnimeVibe" WHERE "userId" = ${authUser.id} ORDER BY "updatedAt" DESC`;

    const exportPayload = {
      exportGeneratedAt: new Date().toISOString(),
      exportFormatVersion: 1,
      note:
        'This is a full export of the personal data OTAKUVA holds for this account, generated on request under GDPR Art. 15 / CCPA right-to-access. See src/app/api/account/export/route.ts for exactly what is and is not included.',
      data: { ...user, vibes },
    };

    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="otakuva-data-export-${authUser.id}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('Account export error:', error);
    return NextResponse.json({ error: 'Failed to export account data.' }, { status: 500 });
  }
}
