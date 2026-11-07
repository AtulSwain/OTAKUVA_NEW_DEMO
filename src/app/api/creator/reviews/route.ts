import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest, requireVerifiedUser } from '../../../../lib/auth';
import { RateLimiter } from '../../../../lib/security/rateLimiter';
import { listCreatorReviews, requireCreator, saveCreatorReview } from '../../../../lib/creator/creatorService';
import { creatorErrorResponse, NO_STORE } from '../../../../lib/creator/creatorHttp';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/creator/reviews — your drafts and published creator reviews
 * POST /api/creator/reviews { animeId, title, body, score?, spoilerLevel?, publish }
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    await requireCreator(user.id);
    return NextResponse.json({ reviews: await listCreatorReviews(user.id) }, { headers: NO_STORE });
  } catch (err) {
    return creatorErrorResponse(err, 'load your reviews');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireVerifiedUser(request);
    if (user instanceof NextResponse) return user;
    if (!(await RateLimiter.check('REVIEWS', user.id)).allowed) {
      return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    const review = await saveCreatorReview(user.id, body ?? {});
    return NextResponse.json({ review }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return creatorErrorResponse(err, 'save your review');
  }
}
