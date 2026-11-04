/**
 * OTAKUVA — move uploaded images from the Cloudflare R2 bucket to Cloudinary
 * (2026-11-04, owner). Dry run by default.
 *
 *   npx tsx scripts/migrate_r2_to_cloudinary.ts           # dry run: what would move
 *   npx tsx scripts/migrate_r2_to_cloudinary.ts --apply   # copy + rewrite links
 *
 * 1. Scans every text column in the database for links to R2 files
 *    (`/api/media/<key>` relay links and `https://media.otakuva.com/<key>`),
 *    plus MediaAsset.storageKey rows from R2.
 * 2. Copies each file from R2 into Cloudinary under the same path
 *    (public_id `otakuva/<key without extension>`).
 * 3. Replaces the old link with the Cloudinary link in every place it
 *    appears, and points MediaAsset rows at Cloudinary.
 *
 * Every change is written to scripts/import_logs/r2-to-cloudinary-*.json
 * (table, column, old → new), so it can be undone. Files that can't be read
 * from R2 or can't be uploaded are listed and their links left untouched.
 * Nothing is deleted from R2 — delete the bucket only after this has run on
 * every database (local AND production) and the site shows the images.
 *
 * Needs R2_* (to read) and CLOUDINARY_URL (to write) in the environment, and
 * DATABASE_URL pointing at the database to migrate.
 */
import fs from 'fs';
import path from 'path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '../src/lib/prisma';
import { CloudinaryStorageProvider } from '../src/lib/storage/cloudinaryStorageProvider';

const APPLY = process.argv.includes('--apply');
const KEY_RE = /(?:https:\/\/media\.otakuva\.com\/|\/api\/media\/)([\w./-]+?\.(?:webp|png|jpe?g|gif|avif))/gi;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function main() {
  const cloudinary = new CloudinaryStorageProvider();
  if (APPLY && !cloudinary.isConfigured()) throw new Error('Set CLOUDINARY_URL first.');
  const r2Key = process.env.R2_ACCESS_KEY_ID;
  const r2Secret = process.env.R2_SECRET_ACCESS_KEY;
  if (APPLY && (!r2Key || !r2Secret || !process.env.R2_ENDPOINT)) throw new Error('R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT are needed to read the old files.');
  const r2 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: r2Key ?? '', secretAccessKey: r2Secret ?? '' } });
  const bucket = process.env.R2_BUCKET_NAME || 'otakuva-media';

  // 1. Find every text column holding an R2 link.
  const columns = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')
        AND table_name NOT LIKE '\\_prisma%'`,
  );
  const hits: { table: string; column: string; value: string }[] = [];
  for (const { table_name, column_name } of columns) {
    const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(
      `SELECT DISTINCT ${quoteIdent(column_name)} AS v FROM ${quoteIdent(table_name)}
        WHERE ${quoteIdent(column_name)} LIKE '%/api/media/%' OR ${quoteIdent(column_name)} LIKE '%media.otakuva.com/%'`,
    );
    for (const r of rows) hits.push({ table: table_name, column: column_name, value: r.v });
  }

  const keys = new Set<string>();
  for (const h of hits) for (const m of h.value.matchAll(KEY_RE)) keys.add(m[1]);
  const assetRows = await prisma.mediaAsset.findMany({ where: { source: 'r2', storageKey: { not: null } }, select: { id: true, storageKey: true } });
  for (const a of assetRows) if (a.storageKey) keys.add(a.storageKey.replace(/^\/+/, ''));

  const places = new Map<string, number>();
  for (const h of hits) places.set(`${h.table}.${h.column}`, (places.get(`${h.table}.${h.column}`) ?? 0) + 1);
  console.log(`R2 files referenced: ${keys.size}`);
  console.log(`Columns with R2 links: ${[...places].map(([k, n]) => `${k} (${n})`).join(', ') || 'none'}`);
  console.log(`MediaAsset rows on R2: ${assetRows.length}`);
  if (!APPLY) {
    console.log('\nDry run — nothing copied or changed. Re-run with --apply.');
    return;
  }

  // 2. Copy each file R2 → Cloudinary.
  const moved = new Map<string, { url: string; publicId: string }>();
  const failed: { key: string; error: string }[] = [];
  let n = 0;
  for (const key of keys) {
    n++;
    try {
      const obj = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = Buffer.from(await obj.Body!.transformToByteArray());
      const up = await cloudinary.upload({
        file: bytes,
        filename: key.split('/').pop() || key,
        mimeType: obj.ContentType || 'image/webp',
        category: 'general',
        customKey: key,
      });
      moved.set(key, { url: up.url, publicId: up.storageKey! });
      console.log(`  [${n}/${keys.size}] ${key} → ${up.url}`);
    } catch (err) {
      failed.push({ key, error: (err as Error).message });
      console.log(`  [${n}/${keys.size}] FAILED ${key}: ${(err as Error).message}`);
    }
  }

  // 3. Rewrite links.
  const changes: { table: string; column: string; from: string; to: string; rows: number }[] = [];
  for (const [key, { url }] of moved) {
    for (const from of [`https://media.otakuva.com/${key}`, `/api/media/${key}`]) {
      for (const { table, column } of hits.filter((h) => h.value.includes(from))) {
        if (changes.some((c) => c.table === table && c.column === column && c.from === from)) continue;
        const rows = await prisma.$executeRawUnsafe(
          `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = replace(${quoteIdent(column)}, $1, $2) WHERE ${quoteIdent(column)} LIKE '%' || $1 || '%'`,
          from,
          url,
        );
        changes.push({ table, column, from, to: url, rows });
      }
    }
  }
  let assetsUpdated = 0;
  for (const a of assetRows) {
    const m = a.storageKey ? moved.get(a.storageKey.replace(/^\/+/, '')) : undefined;
    if (!m) continue;
    await prisma.mediaAsset.update({ where: { id: a.id }, data: { source: 'cloudinary', storageKey: m.publicId, storedUrl: m.url } });
    assetsUpdated++;
  }

  const dir = path.join(__dirname, 'import_logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `r2-to-cloudinary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ moved: Object.fromEntries(moved), failed, changes, assetsUpdated }, null, 2));
  console.log(`\nCopied ${moved.size}/${keys.size}; ${failed.length} failed; ${changes.reduce((s, c) => s + c.rows, 0)} rows rewritten; ${assetsUpdated} MediaAsset rows updated.`);
  console.log(`Log: ${file}`);
  if (failed.length) console.log('Some files failed — their links still point at R2. Do NOT delete the bucket yet.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
