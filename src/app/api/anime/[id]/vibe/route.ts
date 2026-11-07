import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { getAuthUserFromRequest, requireVerifiedUser } from '../../../../../lib/auth';
import { RateLimiter } from '../../../../../lib/security/rateLimiter';
import { logger } from '../../../../../lib/logger';
import { getVibeSummary, saveVibe, VibeError } from '../../../../../lib/rating/vibe';
import { getEpisodeReleaseState } from '../../../../../lib/rating/episodeRatings';

export const dynamic = 'force-dynamic';

async function resolveAnime(idOrSlug: string) {
  return prisma.anime.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }, select: { id: true } });
}

/** GET /api/anime/:id/vibe — the Vibe chart data (+ the viewer's own grades). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const anime = await resolveAnime(params.id);
    if (!anime) return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
    const viewer = await getAuthUserFromRequest(request);
    return NextResponse.json(await getVibeSummary(anime.id, viewer?.id ?? null), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error('Vibe summary failed', { error, route: '/api/anime/[id]/vibe', method: 'GET' });
    return NextResponse.json({ error: 'Could not load the vibe.' }, { status: 500 });
  }
}

/**
 * POST { grades: { STORY: 'GOOD', MUSIC: 'GREAT', PACING: null, … } } — the
 * signed-in member's own grades (null removes one). Open once episode 1 has
 * aired, like every other rating.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireVerifiedUser(request);
    if (user instanceof NextResponse) return user;
    const rate = await RateLimiter.check('COMMUNITY', `vibe:${user.id}`);
    if (!rate.allowed) return NextResponse.json({ error: 'You are rating too quickly. Please wait a moment.' }, { status: 429 });
    const anime = await resolveAnime(params.id);
    if (!anime) return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
    if (!(await getEpisodeReleaseState(anime.id)).isOpen) {
      return NextResponse.json({ error: 'The vibe opens when episode 1 airs.' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    await saveVibe(user.id, anime.id, body?.grades);
    return NextResponse.json(await getVibeSummary(anime.id, user.id));
  } catch (error) {
    if (error instanceof VibeError) return NextResponse.json({ error: error.message }, { status: error.status });
    logger.error('Vibe save failed', { error, route: '/api/anime/[id]/vibe', method: 'POST' });
    return NextResponse.json({ error: 'Could not save your vibe.' }, { status: 500 });
  }
}
