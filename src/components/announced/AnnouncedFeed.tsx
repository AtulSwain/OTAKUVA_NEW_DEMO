'use client';

import React, { useState } from 'react';
import type { AnnouncedAnime } from '../../lib/announcements/announcedAnime';
import { AnnouncedCard } from './AnnouncedCard';
import styles from './Announced.module.css';

const PAGE = 24;

/**
 * The /announced list: format chips + "Load more". The first page comes from
 * the server; later pages and filters from GET /api/announced.
 */
export function AnnouncedFeed({
  initial,
  initialTotal,
  formats,
  skipIds = [],
}: {
  initial: AnnouncedAnime[];
  initialTotal: number;
  formats: { format: string; count: number }[];
  /** Shown elsewhere on the page already (the lead story). */
  skipIds?: string[];
}) {
  const [format, setFormat] = useState<string | null>(null);
  const [items, setItems] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [offset, setOffset] = useState(initial.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const load = async (nextFormat: string | null, from: number) => {
    setBusy(true);
    setError(false);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(from) });
      if (nextFormat) qs.set('format', nextFormat);
      const res = await fetch(`/api/announced?${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setItems((prev) => (from === 0 ? d.items : [...prev, ...d.items]));
      setTotal(d.total);
      setOffset(from + d.items.length);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const pick = (f: string | null) => {
    if (f === format || busy) return;
    setFormat(f);
    load(f, 0);
  };

  const all = formats.reduce((n, f) => n + f.count, 0);
  const shown = format ? items : items.filter((a) => !skipIds.includes(a.id));

  return (
    <div className={styles.block}>
      {formats.length > 1 && (
        <div className={styles.filters} role="group" aria-label="Format">
          <button type="button" className={`${styles.chip} ${format === null ? styles.chipActive : ''}`} onClick={() => pick(null)} aria-pressed={format === null}>
            All <small>{all.toLocaleString('en-US')}</small>
          </button>
          {formats.map((f) => (
            <button
              key={f.format}
              type="button"
              className={`${styles.chip} ${format === f.format ? styles.chipActive : ''}`}
              onClick={() => pick(f.format)}
              aria-pressed={format === f.format}
            >
              {f.format === 'Movie' ? 'Movies' : f.format} <small>{f.count.toLocaleString('en-US')}</small>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 && !busy ? (
        <p className={styles.empty}>No announced anime here yet.</p>
      ) : (
        <div className={styles.grid}>
          {shown.map((a) => (
            <AnnouncedCard key={a.id} anime={a} />
          ))}
        </div>
      )}

      {error && <p className={styles.empty}>Couldn&apos;t load more right now. Try again.</p>}
      {offset < total && (
        <button type="button" className={styles.more} onClick={() => load(format, offset)} disabled={busy}>
          {busy ? 'Loading…' : `Load more (${(total - offset).toLocaleString('en-US')} more)`}
        </button>
      )}
    </div>
  );
}
