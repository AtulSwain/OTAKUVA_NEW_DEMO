import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest, requireVerifiedUser } from '../../../../../lib/auth';
import { RateLimiter } from '../../../../../lib/security/rateLimiter';
import { createDiscussionComment, listComments, CommentError } from '../../../../../lib/engine/community/commentService';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof CommentError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/**
 * GET /api/discussions/:id/comments
 *   ?sort=top|newest&cursor=&limit=     top-level comments, paginated
 *   ?parentId=<commentId>&cursor=       replies to one comment, oldest first
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authUser = await getAuthUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const result = await listComments({
      discussionId: params.id,
      viewer: authUser ? { id: authUser.id, role: authUser.role } : null,
      parentId: searchParams.get('parentId'),
      cursor: searchParams.get('cursor'),
      limit: Number(searchParams.get('limit')) || undefined,
      sort: searchParams.get('sort') === 'newest' ? 'newest' : 'top',
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'Failed to load comments');
  }
}

/**
 * POST /api/discussions/:id/comments
 * { content, parentId?, spoilerLevel?, mediaIds?, gifIds?, mediaIsSpoiler? }
 * The author is always the session user; attachments must be theirs.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authUser = await requireVerifiedUser(request);
  if (authUser instanceof NextResponse) return authUser;

  const rate = await RateLimiter.check('COMMENTS', authUser.id);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'You are commenting too quickly. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec || 60) } }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'A JSON body is required' }, { status: 400 });
  }

  try {
    const comment = await createDiscussionComment({
      authorId: authUser.id,
      discussionId: params.id,
      parentId: typeof body.parentId === 'string' ? body.parentId : null,
      body: typeof body.content === 'string' ? body.content : '',
      spoilerLevel: typeof body.spoilerLevel === 'string' ? body.spoilerLevel : undefined,
      mediaIds: Array.isArray(body.mediaIds) ? body.mediaIds : [],
      gifIds: Array.isArray(body.gifIds) ? body.gifIds : [],
      mediaIsSpoiler: body.mediaIsSpoiler === true,
    });
    return NextResponse.json({ success: true, comment }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to post comment');
  }
}
