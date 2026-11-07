import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest, requireVerifiedUser } from '../../../../../lib/auth';
import { RateLimiter } from '../../../../../lib/security/rateLimiter';
import { deleteCreatorReview, getCreatorReview, requireCreator, updateCreatorReview } from '../../../../../lib/creator/creatorService';
import { creatorErrorResponse, NO_STORE } from '../../../../../lib/creator/creatorHttp';

export const dynamic = 'force-dynamic';

/** GET / PATCH { title, body, score?, spoilerLevel?, publish } / DELETE — your own review only. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    await requireCreator(user.id);
    return NextResponse.json({ review: await getCreatorReview(user.id, params.id) }, { headers: NO_STORE });
  } catch (err) {
    return creatorErrorResponse(err, 'load the review');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireVerifiedUser(request);
    if (user instanceof NextResponse) return user;
    if (!(await RateLimiter.check('REVIEWS', user.id)).allowed) {
      return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ review: await updateCreatorReview(user.id, params.id, body ?? {}) }, { headers: NO_STORE });
  } catch (err) {
    return creatorErrorResponse(err, 'save the review');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    await requireCreator(user.id);
    return NextResponse.json(await deleteCreatorReview(user.id, params.id), { headers: NO_STORE });
  } catch (err) {
    return creatorErrorResponse(err, 'delete the review');
  }
}
