/**
 * OTAKUVA — DeadLetterQueue retention policy.
 *
 * DeadLetterQueue rows record provider fetch failures (see
 * `syncEngine.syncFullCatalogById` / `ingestAnimeByMalId`) so they get
 * retried rather than silently dropped — the charter's failure-isolation
 * rule: a provider outage must never be interpreted as "delete/skip this
 * forever." Left unbounded, though, the table only grows: 4,615 rows at the
 * 2026-09-11 audit, ~13,000 the next day, 23,122 as of this writing —
 * because nothing was ever sweeping it. This module is the retention half
 * of the fix.
 *
 * A row that has been retried MAX_RETRIES times and has sat around for
 * RETENTION_DAYS isn't going to recover through the normal retry path
 * anymore (see scripts/retry_dead_letters.ts, which retries everything
 * under that limit); keeping it in the hot table forever buys nothing.
 * archiveExpiredDeadLetters() moves rows like that to a compressed NDJSON
 * file — so the failure record isn't lost, only moved off the table — and
 * deletes them from DeadLetterQueue.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { prisma } from './prisma';

/** Attempts a row can accumulate before it's considered exhausted. */
export const MAX_RETRIES = 10;

/** How long an exhausted row is kept in the live table before archival. */
export const RETENTION_DAYS = 30;

const ARCHIVE_DIR = path.resolve(process.cwd(), 'scripts', 'dead_letter_archive');

export interface DeadLetterArchiveResult {
  archivedCount: number;
  archivePath: string | null;
}

/**
 * Archives (gzip-compressed NDJSON) and deletes every DeadLetterQueue row
 * with `attempts >= MAX_RETRIES` and `createdAt` older than RETENTION_DAYS
 * days. Idempotent / safe to call on every scheduled sweep — a no-op when
 * nothing currently qualifies. The archive file is written and flushed to
 * disk before any row is deleted, so a crash mid-run can never lose a row
 * without also losing its archived copy.
 */
export async function archiveExpiredDeadLetters(): Promise<DeadLetterArchiveResult> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const expired = await prisma.deadLetterQueue.findMany({
    where: { attempts: { gte: MAX_RETRIES }, createdAt: { lt: cutoff } },
    orderBy: { createdAt: 'asc' },
  });

  if (expired.length === 0) {
    return { archivedCount: 0, archivePath: null };
  }

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(ARCHIVE_DIR, `dlq-archive-${stamp}.jsonl.gz`);

  const ndjson = expired.map((row) => JSON.stringify(row)).join('\n') + '\n';
  fs.writeFileSync(archivePath, zlib.gzipSync(Buffer.from(ndjson, 'utf-8')));

  await prisma.deadLetterQueue.deleteMany({
    where: { id: { in: expired.map((r) => r.id) } },
  });

  return { archivedCount: expired.length, archivePath };
}

export interface DeadLetterInput {
  provider: string;
  entityType: string;
  externalId: string;
  error: string;
}

/**
 * Records a failure once per (provider, entityType, externalId) — 2026-11-06.
 * Before, every failure `create`d a new row, so one MAL id failing on each
 * catalog pass left a pile of duplicates (~16.5k ids across 23k rows). Now
 * an open (unresolved) row for the same item is bumped instead: attempts +1,
 * latest error, new lastAttemptAt. A resolved row is left as history and a
 * fresh one is opened.
 */
export async function recordDeadLetter(input: DeadLetterInput): Promise<void> {
  const open = await prisma.deadLetterQueue.findFirst({
    where: { provider: input.provider, entityType: input.entityType, externalId: input.externalId, resolvedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (open) {
    await prisma.deadLetterQueue.update({
      where: { id: open.id },
      data: { error: input.error.slice(0, 2000), attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
    return;
  }
  await prisma.deadLetterQueue.create({ data: { ...input, error: input.error.slice(0, 2000) } });
}
