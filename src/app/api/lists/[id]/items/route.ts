import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '../../../../../lib/auth';
import { addAnimeToList, ListError, reorderListItems } from '../../../../../lib/lists/listService';
import { logger } from '../../../../../lib/logger';

export const dynamic = 'force-dynamic';

/** POST /api/lists/:id/items { animeId } — idempotent (adding twice is a no-op). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authUser = await getAuthUserFromRequest(request);
  if (!authUser) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const result = await addAnimeToList(authUser.id, params.id, body?.animeId);
    return NextResponse.json(result, { status: result.added ? 201 : 200 });
  } catch (e) {
    if (e instanceof ListError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    logger.error('Error adding anime to list', { error: e as Error, route: '/api/lists/[id]/items', method: 'POST' });
    return NextResponse.json({ error: 'Failed to add to list' }, { status: 500 });
  }
}

/** PUT /api/lists/:id/items { order: animeId[] } — new order of the list's anime (owner only). */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const authUser = await getAuthUserFromRequest(request);
  if (!authUser) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await reorderListItems(authUser.id, params.id, body?.order));
  } catch (e) {
    if (e instanceof ListError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    logger.error('Error reordering list', { error: e as Error, route: '/api/lists/[id]/items', method: 'PUT' });
    return NextResponse.json({ error: 'Failed to save the order' }, { status: 500 });
  }
}
