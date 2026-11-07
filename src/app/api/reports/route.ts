import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getAuthUserFromRequest } from '../../../lib/auth';
import { RateLimiter } from '../../../lib/security/rateLimiter';
import { canUserViewCommunityContent } from '../../../lib/engine/community/communityEngine';
import { REPORT_REASONS } from '../../../lib/reports/reportCategories';
import { resolveLink } from '../../../lib/reports/resolveLink';
import { logger } from '../../../lib/logger';

export const dynamic = 'force-dynamic';

const TARGET_TYPES = new Set(['DISCUSSION', 'COMMENT', 'MESSAGE', 'USER', 'COMMUNITY', 'ARTICLE', 'ARTICLE_COMMENT']);
// Public catalog pages a pasted link can point at (2026-11-05) — always visible.
const PUBLIC_LINK_TYPES = new Set(['ANIME', 'PERSON', 'CHARACTER', 'STUDIO', 'NEWS', 'PAGE']);

/**
 * Only something that exists and that the reporter can actually see can be
 * reported — otherwise the endpoint becomes a way to probe private content.
 */
async function targetVisibleTo(targetType: string, targetId: string, userId: string): Promise<boolean> {
  const community = { select: { id: true, visibility: true, ownerId: true, status: true } };
  if (targetType === 'COMMENT') {
    const c = await prisma.discussionComment.findUnique({
      where: { id: targetId },
      select: { discussion: { select: { community } } },
    });
    if (!c) return false;
    return !c.discussion.community || canUserViewCommunityContent(c.discussion.community, userId);
  }
  if (targetType === 'DISCUSSION') {
    const d = await prisma.discussion.findUnique({ where: { id: targetId }, select: { community } });
    if (!d) return false;
    return !d.community || canUserViewCommunityContent(d.community, userId);
  }
  if (targetType === 'MESSAGE') {
    const m = await prisma.communityMessage.findUnique({
      where: { id: targetId },
      select: { channel: { select: { community } } },
    });
    return Boolean(m) && canUserViewCommunityContent(m!.channel.community, userId);
  }
  if (targetType === 'ARTICLE') {
    return Boolean(await prisma.userArticle.findFirst({ where: { id: targetId, status: 'PUBLISHED' }, select: { id: true } }));
  }
  if (targetType === 'ARTICLE_COMMENT') {
    return Boolean(
      await prisma.userArticleComment.findFirst({
        where: { id: targetId, deletedAt: null, status: 'PUBLISHED', article: { status: 'PUBLISHED' } },
        select: { id: true },
      })
    );
  }
  if (targetType === 'USER') return Boolean(await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } }));
  if (targetType === 'COMMUNITY') return Boolean(await prisma.community.findUnique({ where: { id: targetId }, select: { id: true } }));
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const rate = await RateLimiter.check('COMMUNITY', authUser.id);
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Too many reports. Please wait a moment.' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    let targetType = typeof body.targetType === 'string' ? body.targetType.toUpperCase() : '';
    const reason = typeof body.reason === 'string' ? body.reason.toUpperCase() : '';
    let targetId = typeof body.targetId === 'string' ? body.targetId : '';
    let description = typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '';

    if (!REPORT_REASONS.has(reason)) {
      return NextResponse.json({ error: 'Choose a report reason' }, { status: 400 });
    }

    // From the Report page (2026-11-05): a pasted link instead of an id.
    if (!targetType && !targetId && body.link !== undefined) {
      const target = await resolveLink(body.link);
      if (!target) return NextResponse.json({ error: 'Paste a link to the page you’re reporting.', code: 'INVALID_LINK' }, { status: 400 });
      targetType = target.type;
      targetId = target.id;
      if (target.type !== 'PAGE') description = `[${target.path}] ${description}`.trim().slice(0, 1000);
      if (!PUBLIC_LINK_TYPES.has(targetType) && !(await targetVisibleTo(targetType, targetId, authUser.id))) {
        return NextResponse.json({ error: 'That content could not be found' }, { status: 404 });
      }
    } else {
      if (!TARGET_TYPES.has(targetType) || !targetId) {
        return NextResponse.json({ error: 'A valid report target is required' }, { status: 400 });
      }
      if (!(await targetVisibleTo(targetType, targetId, authUser.id))) {
        return NextResponse.json({ error: 'That content could not be found' }, { status: 404 });
      }
    }

    // One open report per person per item; repeat clicks don't stack.
    const existing = await prisma.report.findFirst({
      where: { reporterId: authUser.id, targetType, targetId, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ success: true, reportId: existing.id, alreadyReported: true }, { status: 200 });
    }

    const report = await prisma.report.create({
      data: {
        reporterId: authUser.id,
        targetType,
        targetId,
        reason,
        description: description || null,
      },
    });

    return NextResponse.json({ success: true, reportId: report.id }, { status: 201 });
  } catch (error: any) {
    logger.error('Report failed', { error: error as Error, component: 'api/reports' });
    return NextResponse.json({ error: 'Failed to submit report' }, { status: 500 });
  }
}
