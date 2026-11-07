import { NextRequest, NextResponse } from 'next/server';
import { searchCharacters } from '../../../lib/characters/characterSearch';
import { RateLimiter } from '../../../lib/security/rateLimiter';
import { getClientIp } from '../../../lib/security/authRateLimiter';
import { logger } from '../../../lib/logger';

export const dynamic = 'force-dynamic';

/** GET /api/characters?q=<name>&limit=<1-50> — character search, best match first. */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') || '').slice(0, 100);
  const limit = Number(request.nextUrl.searchParams.get('limit')) || 20;
  if (!RateLimiter.checkRateLimit('SEARCH', `characters:${getClientIp(request)}`).allowed) {
    return NextResponse.json({ error: 'Too many searches. Try again in a minute.' }, { status: 429 });
  }
  try {
    return NextResponse.json({ characters: await searchCharacters(q, limit) });
  } catch (error) {
    logger.error('Character search failed', { error: error as Error, component: 'api/characters' });
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
