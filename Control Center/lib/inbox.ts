import { prisma } from '@/lib/prisma';
import { REASON_LABEL } from '@/lib/reports/reportCategories';
import { ControlEditError } from './editor';

/**
 * Reports inbox (2026-11-05): everything members sent from the Report page or
 * a Report button — moderation reports (Report) and "wrong information"
 * corrections (DataCorrectionRequest) — in one list, with where to look.
 * Before this nothing listed them; they were only counted on the dashboard.
 * Approving a correction only closes it: the fix itself is made in the
 * normal editors (anime form etc.), so nothing changes data silently.
 */

export type InboxFilter = 'open' | 'closed';

export interface InboxItem {
  kind: 'report' | 'correction';
  id: string;
  createdAt: string;
  status: string;
  category: string;
  /** What it's about, e.g. "ANIME · /anime/frieren". */
  about: string;
  href: string | null;
  from: string | null;
  text: string | null;
  /** Corrections only. */
  field?: string;
  suggested?: string;
}

const PATH_IN_TEXT = /^\[(\/[^\]]*)\]\s*/;

async function reportHref(targetType: string, targetId: string): Promise<string | null> {
  switch (targetType) {
    case 'PAGE':
      return targetId.startsWith('/') ? targetId : null;
    case 'DISCUSSION':
      return `/discussions/${targetId}`;
    case 'USER': {
      const u = await prisma.user.findUnique({ where: { id: targetId }, select: { username: true } });
      return u ? `/profile/${u.username}` : null;
    }
    case 'COMMUNITY': {
      const c = await prisma.community.findUnique({ where: { id: targetId }, select: { slug: true } });
      return c ? `/community/${c.slug}` : null;
    }
    case 'ARTICLE': {
      const a = await prisma.userArticle.findUnique({ where: { id: targetId }, select: { slug: true } });
      return a ? `/articles/${a.slug}` : null;
    }
    case 'COMMENT': {
      const c = await prisma.discussionComment.findUnique({ where: { id: targetId }, select: { discussionId: true } });
      return c ? `/discussions/${c.discussionId}` : null;
    }
    case 'ARTICLE_COMMENT': {
      const c = await prisma.userArticleComment.findUnique({ where: { id: targetId }, select: { article: { select: { slug: true } } } });
      return c ? `/articles/${c.article.slug}` : null;
    }
    default:
      return null;
  }
}

export async function listInbox(filter: InboxFilter = 'open', limit = 100): Promise<{ items: InboxItem[]; openCount: number }> {
  const openReport = { status: 'OPEN' };
  const openCorrection = { status: 'PENDING' };
  const [reports, corrections, openReports, openCorrections] = await Promise.all([
    prisma.report.findMany({
      where: filter === 'open' ? openReport : { status: { not: 'OPEN' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { reporter: { select: { username: true } } },
    }),
    prisma.dataCorrectionRequest.findMany({
      where: filter === 'open' ? openCorrection : { status: { not: 'PENDING' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { username: true } } },
    }),
    prisma.report.count({ where: openReport }),
    prisma.dataCorrectionRequest.count({ where: openCorrection }),
  ]);

  const items: InboxItem[] = [];
  for (const r of reports) {
    const m = r.description?.match(PATH_IN_TEXT);
    const href = m ? m[1] : await reportHref(r.targetType, r.targetId);
    const text = (m ? r.description!.replace(PATH_IN_TEXT, '') : r.description)?.trim() || null;
    items.push({
      kind: 'report',
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      status: r.status,
      category: REASON_LABEL[r.reason] ?? r.reason,
      about: `${r.targetType}${href ? ` · ${href}` : ''}`,
      href,
      from: r.reporter?.username ?? null,
      text,
    });
  }
  for (const c of corrections) {
    const page = c.reason.match(/^Page: (\S+)$/m)?.[1] ?? null;
    items.push({
      kind: 'correction',
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      status: c.status,
      category: 'Wrong information',
      about: `${c.entityType}${page ? ` · ${page}` : ''}`,
      href: page,
      from: c.user?.username ?? null,
      text: c.reason.replace(/^Page: \S+$/m, '').trim() || null,
      field: c.field,
      suggested: c.suggestedValue,
    });
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items: items.slice(0, limit), openCount: openReports + openCorrections };
}

const REPORT_STATUSES = new Set(['REVIEWED', 'ACTIONED', 'DISMISSED', 'OPEN']);
const CORRECTION_STATUSES = new Set(['APPROVED', 'REJECTED', 'PENDING']);

export async function updateInboxItem(kind: unknown, id: unknown, status: unknown, reviewerId: string, note?: unknown) {
  if (typeof id !== 'string' || !id) throw new ControlEditError(400, 'Missing id.');
  const s = typeof status === 'string' ? status.toUpperCase() : '';
  const now = new Date();
  if (kind === 'report') {
    if (!REPORT_STATUSES.has(s)) throw new ControlEditError(400, 'Unknown status.');
    const action = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;
    await prisma.report.update({
      where: { id },
      data: s === 'OPEN' ? { status: s, reviewedBy: null, reviewedAt: null } : { status: s, reviewedBy: reviewerId, reviewedAt: now, ...(action ? { actionTaken: action } : {}) },
    });
    return { id, status: s };
  }
  if (kind === 'correction') {
    if (!CORRECTION_STATUSES.has(s)) throw new ControlEditError(400, 'Unknown status.');
    await prisma.dataCorrectionRequest.update({
      where: { id },
      data: s === 'PENDING' ? { status: s, reviewedBy: null, reviewedAt: null } : { status: s, reviewedBy: reviewerId, reviewedAt: now },
    });
    return { id, status: s };
  }
  throw new ControlEditError(400, 'Unknown item type.');
}
