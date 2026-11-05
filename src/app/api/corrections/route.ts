import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getAuthUserFromRequest } from '../../../lib/auth';
import { CORRECTION_FIELDS } from '../../../lib/reports/reportCategories';
import { resolveLink } from '../../../lib/reports/resolveLink';
import { logger } from '../../../lib/logger';

export const dynamic = 'force-dynamic';

const MAX_PER_HOUR = 10;

/**
 * POST /api/corrections { link, field, suggestedValue, details?, source? }
 *
 * "Wrong information" on the Report page (2026-11-05): a member says an anime
 * / person / character / studio / news detail is wrong. Stored as a PENDING
 * DataCorrectionRequest for the data team (Control Center → Reports inbox) —
 * it never changes the data by itself (review queue over silent action).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Sign in to send a correction.' }, { status: 401 });

    const recent = await prisma.dataCorrectionRequest.count({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 3600_000) } },
    });
    if (recent >= MAX_PER_HOUR) return NextResponse.json({ error: 'Too many corrections in an hour. Please try later.' }, { status: 429 });

    const body = await request.json().catch(() => ({}));
    const target = await resolveLink(body?.link);
    if (!target) return NextResponse.json({ error: 'Paste a link to the page with the wrong information.', code: 'INVALID_LINK' }, { status: 400 });

    const field = typeof body?.field === 'string' && (CORRECTION_FIELDS as readonly string[]).includes(body.field) ? body.field : 'Something else';
    const suggested = typeof body?.suggestedValue === 'string' ? body.suggestedValue.trim() : '';
    if (suggested.length < 2) return NextResponse.json({ error: 'Tell us what the correct information is.', code: 'MISSING_VALUE' }, { status: 400 });
    const details = typeof body?.details === 'string' ? body.details.trim() : '';
    const source = typeof body?.source === 'string' ? body.source.trim() : '';
    if (source && !/^https?:\/\/\S+$/i.test(source)) return NextResponse.json({ error: 'The source must be a link (https://…).', code: 'INVALID_SOURCE' }, { status: 400 });

    const reason = [details, source ? `Source: ${source}` : '', `Page: ${target.path}`].filter(Boolean).join('\n').slice(0, 2000);
    const row = await prisma.dataCorrectionRequest.create({
      data: {
        userId: user.id,
        entityType: target.type,
        entityId: target.id,
        field,
        suggestedValue: suggested.slice(0, 2000),
        reason,
      },
      select: { id: true },
    });
    return NextResponse.json({ success: true, id: row.id, about: target.label }, { status: 201 });
  } catch (error) {
    logger.error('Correction request failed', { error: error as Error, component: 'api/corrections' });
    return NextResponse.json({ error: 'Could not send the correction.' }, { status: 500 });
  }
}
