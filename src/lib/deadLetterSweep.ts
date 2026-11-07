/**
 * DeadLetterQueue sweep (2026-11-06): merge duplicates, retry what's
 * retryable, archive what's exhausted. Was only in
 * scripts/retry_dead_letters.ts (hand-run / --daemon); now also the
 * recurring 'dead-letter:sweep' queue job (src/lib/queue/recurring.ts).
 */
import { prisma } from './prisma';
import { syncEngine } from './syncEngine';
import { MAX_RETRIES, archiveExpiredDeadLetters } from './deadLetter';
import { logger } from './logger';

const BATCH_SIZE = 2000;

/**
 * Merges open rows for the same (provider, entityType, externalId) into the
 * oldest one: highest attempt count, latest attempt time and error. The old
 * ingest path created a new row on every failure, so duplicates only repeat
 * the same failure — nothing distinct is lost. `dryRun` only counts.
 */
export async function collapseDuplicateDeadLetters(dryRun = false): Promise<{ groups: number; removed: number }> {
  const [stats] = await prisma.$queryRaw<{ groups: bigint; removed: bigint }[]>`
    SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(n - 1), 0)::bigint AS removed FROM (
      SELECT COUNT(*) AS n FROM "DeadLetterQueue" WHERE "resolvedAt" IS NULL
      GROUP BY "provider", "entityType", "externalId" HAVING COUNT(*) > 1
    ) d`;
  const result = { groups: Number(stats?.groups ?? 0), removed: Number(stats?.removed ?? 0) };
  if (dryRun || result.removed === 0) return result;

  await prisma.$transaction([
    prisma.$executeRaw`
      WITH g AS (
        SELECT (ARRAY_AGG("id" ORDER BY "createdAt" ASC))[1] AS keep_id,
               MAX("attempts") AS attempts,
               MAX("lastAttemptAt") AS last_at,
               (ARRAY_AGG("error" ORDER BY "lastAttemptAt" DESC))[1] AS last_error
        FROM "DeadLetterQueue" WHERE "resolvedAt" IS NULL
        GROUP BY "provider", "entityType", "externalId" HAVING COUNT(*) > 1
      )
      UPDATE "DeadLetterQueue" d SET "attempts" = g.attempts, "lastAttemptAt" = g.last_at, "error" = g.last_error
      FROM g WHERE d."id" = g.keep_id`,
    prisma.$executeRaw`
      DELETE FROM "DeadLetterQueue" d
      USING (
        SELECT "provider", "entityType", "externalId", (ARRAY_AGG("id" ORDER BY "createdAt" ASC))[1] AS keep_id
        FROM "DeadLetterQueue" WHERE "resolvedAt" IS NULL
        GROUP BY "provider", "entityType", "externalId" HAVING COUNT(*) > 1
      ) g
      WHERE d."resolvedAt" IS NULL AND d."provider" = g."provider" AND d."entityType" = g."entityType"
        AND d."externalId" = g."externalId" AND d."id" <> g.keep_id`,
  ]);
  return result;
}

type DeadLetterRow = Awaited<ReturnType<typeof prisma.deadLetterQueue.findMany>>[number];

async function retryOne(row: DeadLetterRow): Promise<'recovered' | 'failed' | 'unsupported'> {
  if (row.provider === 'jikan' && row.entityType === 'ANIME') {
    const malId = parseInt(row.externalId, 10);
    if (!Number.isFinite(malId)) return 'failed';
    const result = await syncEngine.ingestAnimeByMalId(malId);
    return result ? 'recovered' : 'failed';
  }
  return 'unsupported';
}

export interface DeadLetterSweepResult {
  collapsed: number;
  examined: number;
  recovered: number;
  failed: number;
  unsupported: number;
  archived: number;
}

export async function runDeadLetterSweep(opts: { batchSize?: number } = {}): Promise<DeadLetterSweepResult> {
  const { removed: collapsed } = await collapseDuplicateDeadLetters();

  const pending = await prisma.deadLetterQueue.findMany({
    where: { resolvedAt: null, attempts: { lt: MAX_RETRIES } },
    orderBy: { lastAttemptAt: 'asc' },
    take: opts.batchSize ?? BATCH_SIZE,
  });

  let recovered = 0;
  let failed = 0;
  let unsupported = 0;
  for (const row of pending) {
    try {
      const outcome = await retryOne(row);
      if (outcome === 'recovered') {
        recovered++;
        await prisma.deadLetterQueue.update({ where: { id: row.id }, data: { resolvedAt: new Date() } });
      } else if (outcome === 'unsupported') {
        unsupported++;
      } else {
        failed++;
        await prisma.deadLetterQueue.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastAttemptAt: new Date() } });
      }
    } catch (err: any) {
      failed++;
      await prisma.deadLetterQueue
        .update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), error: err?.message || String(err) } })
        .catch(() => {});
    }
  }

  const archive = await archiveExpiredDeadLetters();
  const result = { collapsed, examined: pending.length, recovered, failed, unsupported, archived: archive.archivedCount };
  logger.info('dead-letter sweep done', { component: 'deadLetterSweep', ...result });
  return result;
}
