import { NextRequest, NextResponse } from 'next/server';
import { requireVerifiedUser } from '../../../../lib/auth';
import { RateLimiter } from '../../../../lib/security/rateLimiter';
import { upgradeToCreator } from '../../../../lib/creator/creatorService';
import { creatorErrorResponse, NO_STORE } from '../../../../lib/creator/creatorHttp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/creator/upgrade { channelName, channelUrl? } — the explicit
 * "become a creator" step for a signed-in member. The role comes from this
 * server-side action only; any role field in the request body is ignored.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireVerifiedUser(request);
    if (user instanceof NextResponse) return user;
    if (!(await RateLimiter.check('ACCOUNT', `creator-upgrade:${user.id}`, { maxRequests: 10 })).allowed) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    const profile = await upgradeToCreator(user.id, { channelName: body?.channelName, channelUrl: body?.channelUrl });
    return NextResponse.json(profile, { headers: NO_STORE });
  } catch (err) {
    return creatorErrorResponse(err, 'turn on creator mode');
  }
}
