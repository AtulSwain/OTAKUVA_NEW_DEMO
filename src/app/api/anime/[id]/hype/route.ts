import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest, requireVerifiedUser } from '../../../../../lib/auth';
import { RateLimiter } from '../../../../../lib/security/rateLimiter';
import { logger } from '../../../../../lib/logger';
import { HypeError, clearHype, getHypeSummary, setHype } from '../../../../../lib/hype/hypeService';

export const dynamic = 'force-dynamic';

function fail(error: unknown, method: string) {
  if (error instanceof HypeError) return NextResponse.json({ error: error.message }, { status: error.status });
  logger.error('Hype request failed', { error, route: '/api/anime/[id]/hype', method });
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}

/** GET — the Hype Meter for this anime (+ the viewer's vote). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const viewer = await getAuthUserFromRequest(request);
    return NextResponse.json(await getHypeSummary(params.id, viewer?.id ?? null), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return fail(error, 'GET');
  }
}

/** POST { level: 'HYPED' | 'SKIP' } — vote (until episode 1 airs). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireVerifiedUser(request);
    if (user instanceof NextResponse) return user;
    const rate = await RateLimiter.check('COMMUNITY', `hype:${user.id}`);
    if (!rate.allowed) return NextResponse.json({ error: 'Slow down a little and try again.' }, { status: 429 });
    const body = await request.json().catch(() => ({}));
    await setHype(user.id, params.id, body?.level);
    return NextResponse.json(await getHypeSummary(params.id, user.id));
  } catch (error) {
    return fail(error, 'POST');
  }
}

/** DELETE — refused: a hype vote is final once cast (2026-10-21). */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    await clearHype(user.id, params.id);
    return NextResponse.json(await getHypeSummary(params.id, user.id));
  } catch (error) {
    return fail(error, 'DELETE');
  }
}
