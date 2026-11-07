import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest, requireVerifiedUser } from '../../../lib/auth';
import { RateLimiter } from '../../../lib/security/rateLimiter';
import { logger } from '../../../lib/logger';
import {
  listDiscoverableCommunities,
  createCommunity,
} from '../../../lib/engine/community/communityEngine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/communities
 * Discovery endpoint for public and authorized communities.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const category = searchParams.get('category') || undefined;
    const communityType = searchParams.get('type') || undefined;
    const animeId = searchParams.get('animeId') || undefined;
    const genre = searchParams.get('genre') || undefined;
    const query = searchParams.get('q') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '30', 10)));

    const authUser = await getAuthUserFromRequest(request);

    const result = await listDiscoverableCommunities({
      filter,
      category,
      communityType,
      animeId,
      genre,
      query,
      page,
      limit,
      userId: authUser?.id || null,
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: any) {
    console.error('Error fetching communities:', error);
    return NextResponse.json({ error: 'Failed to fetch communities' }, { status: 500 });
  }
}

/**
 * POST /api/communities
 * Creates a new community (Authentication required, owner derived from session).
 */
export async function POST(request: NextRequest) {
  try {
    const authUser = await requireVerifiedUser(request);
    if (authUser instanceof NextResponse) return authUser;

    const rate = await RateLimiter.check('COMMUNITY', authUser.id);
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
    }

    const body = await request.json();
    // Members-only communities come back with their first invitation; its
    // access key is in this response only (never stored in plaintext).
    const { invitation, ...community } = await createCommunity(authUser.id, body);

    return NextResponse.json(
      { success: true, community, invitation },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    logger.error('Error creating community', { component: 'communities', err: error });
    const status = error.message?.startsWith('Forbidden')
      ? 403
      : error.message?.includes('Validation') || error.message?.includes('must be') || error.message?.includes('cannot exceed')
      ? 400
      : 500;
    return NextResponse.json(
      { error: (error.message || 'Failed to create community').replace(/^(Validation|Forbidden): /, '') },
      { status }
    );
  }
}
