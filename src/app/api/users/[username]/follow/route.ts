import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '../../../../../lib/auth';
import { RateLimiter } from '../../../../../lib/security/rateLimiter';
import { logger } from '../../../../../lib/logger';
import { FollowError, followUser, getFollowSummary, unfollowUser } from '../../../../../lib/social/followService';

export const dynamic = 'force-dynamic';

/**
 * GET    /api/users/:username/follow — { followerCount, followingCount, isFollowing, followsYou }
 * POST   /api/users/:username/follow — follow (notifies them; idempotent)
 * DELETE /api/users/:username/follow — unfollow (idempotent)
 *
 * Following someone means you're notified when they publish a review,
 * article or public collection, or are active in a public community thread
 * (src/lib/social/followService.ts).
 */

const username = (params: { username: string }) => decodeURIComponent(params.username);

function fail(err: unknown, what: string) {
  if (err instanceof FollowError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  logger.error(`${what} failed`, { component: 'follow', err });
  return NextResponse.json({ error: `Failed to ${what}.` }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: { username: string } }) {
  try {
    const viewer = await getAuthUserFromRequest(request);
    const summary = await getFollowSummary(username(params), viewer?.id);
    if (!summary) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return fail(err, 'load follow state');
  }
}

export async function POST(request: NextRequest, { params }: { params: { username: string } }) {
  try {
    const authUser = await getAuthUserFromRequest(request);
    if (!authUser) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

    const rate = await RateLimiter.check('COMMUNITY', authUser.id);
    if (!rate.allowed) return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });

    const { created, followerCount } = await followUser(authUser.id, username(params));
    return NextResponse.json({ success: true, following: true, followerCount }, { status: created ? 201 : 200 });
  } catch (err) {
    return fail(err, 'follow user');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { username: string } }) {
  try {
    const authUser = await getAuthUserFromRequest(request);
    if (!authUser) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    const { followerCount } = await unfollowUser(authUser.id, username(params));
    return NextResponse.json({ success: true, following: false, followerCount });
  } catch (err) {
    return fail(err, 'unfollow user');
  }
}
