import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '../../../../lib/auth';
import { getFollowingFeed } from '../../../../lib/social/followingFeed';
import { logger } from '../../../../lib/logger';

export const dynamic = 'force-dynamic';

/** GET /api/feed/following?before=<ISO>&limit= — what people you follow published. */
export async function GET(request: NextRequest) {
  const user = await getAuthUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Sign in to see your following feed.' }, { status: 401 });
  const beforeRaw = request.nextUrl.searchParams.get('before');
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : null;
  const limit = Number(request.nextUrl.searchParams.get('limit')) || 30;
  try {
    return NextResponse.json(await getFollowingFeed(user.id, { before, limit }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error('Following feed failed', { error: error as Error, component: 'api/feed/following', userId: user.id });
    return NextResponse.json({ error: 'Could not load your feed.' }, { status: 500 });
  }
}
