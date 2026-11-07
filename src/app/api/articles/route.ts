import { NextRequest, NextResponse } from 'next/server';
import { requireVerifiedUser } from '../../../lib/auth';
import { RateLimiter } from '../../../lib/security/rateLimiter';
import { ArticleError, createArticle, listArticles, validateArticleInput } from '../../../lib/articles/articleService';
import { logger } from '../../../lib/logger';

export const dynamic = 'force-dynamic';

/** GET /api/articles?author=<username>&animeId=<id>&page=<n> — published member articles, newest first. */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const result = await listArticles({
      authorUsername: sp.get('author') || undefined,
      animeId: sp.get('animeId') || undefined,
      page: Number(sp.get('page')) || 1,
      limit: Number(sp.get('limit')) || 18,
    });
    return NextResponse.json(result);
  } catch (error) {
    logger.error('Listing articles failed', { error: error as Error, component: 'api/articles' });
    return NextResponse.json({ error: 'Failed to load articles.' }, { status: 500 });
  }
}

/** POST /api/articles { title, summary?, body, links?, animeId?, coverAssetId? } — publish an article. */
export async function POST(request: NextRequest) {
  try {
    const authUser = await requireVerifiedUser(request);
    if (authUser instanceof NextResponse) return authUser;

    const rate = await RateLimiter.check('COMMUNITY', `article:${authUser.id}`);
    if (!rate.allowed) {
      return NextResponse.json({ error: 'You are posting too quickly. Please wait a moment.' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const validated = validateArticleInput(body);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

    const article = await createArticle(authUser.id, validated.value);
    return NextResponse.json({ article }, { status: 201 });
  } catch (error) {
    if (error instanceof ArticleError) return NextResponse.json({ error: error.message }, { status: error.status });
    logger.error('Publishing article failed', { error: error as Error, component: 'api/articles' });
    return NextResponse.json({ error: 'Failed to publish article.' }, { status: 500 });
  }
}
