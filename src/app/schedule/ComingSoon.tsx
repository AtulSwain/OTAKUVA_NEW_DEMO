'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import type { AnnouncedAnime } from '../../lib/announcements/announcedAnime';
import styles from './ComingSoon.module.css';

/**
 * Schedule → "Coming Soon" (2026-11-06): every announced anime that hasn't
 * premiered yet, soonest first (GET /api/announced?sort=premiere). Grouped by
 * month when the premiere is known; a live countdown only when the exact day
 * is known. No adult titles or music videos (same read model as /announced).
 */
const PAGE = 48;

type Group = { key: string; label: string; items: AnnouncedAnime[] };

function groupLabel(a: AnnouncedAnime): { key: string; label: string } {
  if (a.premiereDate) {
    const d = new Date(a.premiereDate);
    return {
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    };
  }
  if (a.premiere) return { key: `p:${a.premiere}`, label: a.premiere };
  return { key: 'tba', label: 'Date not announced' };
}

function daysUntil(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'Premieres today';
  const days = Math.ceil(ms / 86_400_000);
  return days === 1 ? 'Tomorrow' : `In ${days} days`;
}

export function ComingSoon() {
  const [items, setItems] = useState<AnnouncedAnime[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [format, setFormat] = useState<string>('');
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => setNow(Date.now()), []);

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      setError(false);
      try {
        const qs = new URLSearchParams({ sort: 'premiere', limit: String(PAGE), offset: String(offset) });
        if (format) qs.set('format', format);
        const res = await fetch(`/api/announced?${qs}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        setItems((prev) => (replace ? json.items : [...prev, ...json.items]));
        setTotal(json.total ?? 0);
        setNext(json.nextOffset ?? null);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [format]
  );

  useEffect(() => {
    load(0, true);
  }, [load]);

  const groups = useMemo(() => {
    const out: Group[] = [];
    for (const a of items) {
      const g = groupLabel(a);
      const last = out[out.length - 1];
      if (last && last.key === g.key) last.items.push(a);
      else out.push({ ...g, items: [a] });
    }
    return out;
  }, [items]);

  return (
    <section className={styles.wrap} aria-label="Coming soon">
      <div className={styles.bar}>
        <p className={styles.count}>
          {total > 0 ? (
            <>
              <strong>{total.toLocaleString()}</strong> announced anime still to premiere
            </>
          ) : loading ? (
            'Loading…'
          ) : null}
        </p>
        <div className={styles.chips} role="tablist" aria-label="Format">
          {['', 'TV', 'Movie', 'ONA', 'OVA', 'Special'].map((f) => (
            <button
              key={f || 'all'}
              type="button"
              role="tab"
              aria-selected={format === f}
              className={`${styles.chip} ${format === f ? styles.chipOn : ''}`}
              onClick={() => setFormat(f)}
            >
              {f || 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className={styles.note}>Couldn&apos;t load upcoming premieres. Try again in a moment.</p>}

      {groups.map((g) => (
        <div key={g.key} className={styles.group}>
          <h3 className={styles.groupTitle}>{g.label}</h3>
          <ul className={styles.grid}>
            {g.items.map((a) => (
              <li key={a.id}>
                <Link href={`/anime/${a.slug}`} className={styles.card}>
                  <span className={styles.poster}>
                    {a.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.posterUrl} alt="" loading="lazy" />
                    ) : (
                      <span className={styles.posterBlank} aria-hidden="true">
                        {a.title.charAt(0)}
                      </span>
                    )}
                    {a.premiereDate && now !== null && <span className={styles.countdown}>{daysUntil(a.premiereDate, now)}</span>}
                  </span>
                  <span className={styles.title}>{a.title}</span>
                  <span className={styles.meta}>
                    {[a.type, a.premiere ?? 'Date TBA', a.studios.find((s) => s.isMain)?.name ?? a.studios[0]?.name].filter(Boolean).join(' · ')}
                  </span>
                  {a.continues && <span className={styles.continues}>{a.continues.label} {a.continues.title}</span>}
                  {a.hyped > 0 && (
                    <span className={styles.hyped}>
                      <Sparkles size={11} aria-hidden="true" /> {a.hyped.toLocaleString()} hyped
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {!loading && !error && items.length === 0 && <p className={styles.note}>No announced anime in this format right now.</p>}

      {next !== null && items.length > 0 && (
        <div className={styles.more}>
          <button type="button" className={styles.moreBtn} onClick={() => load(next, false)} disabled={loading}>
            {loading ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </section>
  );
}
