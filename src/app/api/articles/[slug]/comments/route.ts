import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest, requireVerifiedUser } from '../../../../../lib/auth';
import { ArticleSocialError, createArticleComment, listArticleComments } from '../../../../../lib/articles/articleSocial';
import { RateLimiter } from '../../../../../lib/security/rateLimiter';
import { logger } from '../../../../../lib/logger';

export const dynamic = 'force-dynamic';

/** GET /api/articles/:slug/comments?sort=top|newest|oldest — comment threads, replies nested. */
export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const authUser = await getAuthUserFromRequest(request);
    const rawSort = request.nextUrl.searchParams.get('sort');
    const sort = rawSort === 'newest' || rawSort === 'oldest' ? rawSort : 'top';
    const comments = await listArticleComments(params.slug, authUser ? { id: authUser.id, role: authUser.role } : null, sort);
    return NextResponse.json({ comments });
  } catch (error) {
    if (error instanceof ArticleSocialError) return NextResponse.json({ error: error.message }, { status: error.status });
    logger.error('Listing article comments failed', { error, route: '/api/articles/[slug]/comments', method: 'GET' });
    return NextResponse.json({ error: 'Failed to load comments' }, { status: 500 });
  }
}

/** POST /api/articles/:slug/comments { body, parentId? } — verified users only; parentId makes it a reply. */
export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const authUser = await requireVerifiedUser(request);
    if (authUser instanceof NextResponse) return authUser;
    const rate = await RateLimiter.check('COMMUNITY', authUser.id);
    if (!rate.allowed) return NextResponse.json({ error: 'You are commenting too fast. Please wait a moment.' }, { status: 429 });
    const payload = await request.json().catch(() => ({}));
    const comment = await createArticleComment(params.slug, { id: authUser.id, username: authUser.username, role: authUser.role }, payload?.body, payload?.parentId);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    if (error instanceof ArticleSocialError) return NextResponse.json({ error: error.message }, { status: error.status });
    logger.error('Creating article comment failed', { error, route: '/api/articles/[slug]/comments', method: 'POST' });
    return NextResponse.json({ error: 'Failed to post comment' }, { status: 500 });
  }
}
