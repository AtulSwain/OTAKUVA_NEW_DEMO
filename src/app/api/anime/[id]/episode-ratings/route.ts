import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest, requireVerifiedUser } from '../../../../../lib/auth';
import { RateLimiter } from '../../../../../lib/security/rateLimiter';
import { logger } from '../../../../../lib/logger';
import {
  EpisodeRatingError,
  deleteEpisodeRating,
  deleteEpisodeRetention,
  getEpisodeRatingSummary,
  submitEpisodeRating,
  submitEpisodeRetention,
} from '../../../../../lib/rating/episodeRatings';
import { refreshUserBadges } from '../../../../../lib/badges/countingService';

export const dynamic = 'force-dynamic';

function fail(error: unknown, route: string, method: string) {
  if (error instanceof EpisodeRatingError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  logger.error('Episode ratings request failed', { error, route, method });
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}

/**
 * GET /api/anime/:id/episode-ratings — aired episodes with their community
 * retention %, the next episode, and (signed in) the viewer's own ratings.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const viewer = await getAuthUserFromRequest(request);
    return NextResponse.json(await getEpisodeRatingSummary(params.id, viewer?.id ?? null), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return fail(error, '/api/anime/[id]/episode-ratings', 'GET');
  }
}

/**
 * POST { episodeNumber, retention } — how well an aired, watched episode kept
 * you watching: a whole number 1–100 (verified members; always the signed-in
 * member's own rating — rating again replaces it). The legacy { episodeNumber, score, … } form is
 * still accepted for contract stability.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireVerifiedUser(request);
    if (user instanceof NextResponse) return user;
    const rate = await RateLimiter.check('COMMUNITY', `episode-rating:${user.id}`);
    if (!rate.allowed) return NextResponse.json({ error: 'You are rating too quickly. Please wait a moment.' }, { status: 429 });
    const body = await request.json().catch(() => ({}));
    if (body && Object.prototype.hasOwnProperty.call(body, 'retention')) {
      const saved = await submitEpisodeRetention({ userId: user.id, animeId: params.id, episodeNumber: body.episodeNumber, retention: body.retention, comment: body.comment });
      // A rated anime counts toward the member's badge (2026-10-27).
      await refreshUserBadges(user.id, { force: true });
      return NextResponse.json({ rating: saved, summary: await getEpisodeRatingSummary(params.id, user.id) });
    }
    const saved = await submitEpisodeRating({
      userId: user.id,
      animeId: params.id,
      episodeNumber: body?.episodeNumber,
      score: body?.score,
      categoryScores: body?.categoryScores,
      note: body?.note,
    });
    return NextResponse.json({ rating: saved, summary: await getEpisodeRatingSummary(params.id, user.id) });
  } catch (error) {
    return fail(error, '/api/anime/[id]/episode-ratings', 'POST');
  }
}

/** DELETE ?episodeNumber=N[&what=retention] — remove your retention (or legacy rating) of that episode. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    const n = Number(request.nextUrl.searchParams.get('episodeNumber'));
    if (!Number.isInteger(n) || n < 1) return NextResponse.json({ error: 'episodeNumber is required.' }, { status: 400 });
    if (request.nextUrl.searchParams.get('what') === 'retention') await deleteEpisodeRetention(user.id, params.id, n);
    else await deleteEpisodeRating(user.id, params.id, n);
    await refreshUserBadges(user.id, { force: true });
    return NextResponse.json({ summary: await getEpisodeRatingSummary(params.id, user.id) });
  } catch (error) {
    return fail(error, '/api/anime/[id]/episode-ratings', 'DELETE');
  }
}
