'use client';

import React, { useEffect, useState } from 'react';
import type { AnnouncedAnime } from '../../lib/announcements/announcedAnime';
import { SectionHead } from '../ui/SectionHead';
import { AnnouncedCard } from './AnnouncedCard';
import styles from './Announced.module.css';

/**
 * Homepage "Just announced" rail: the newest announcements as cards with the
 * poster, premiere, studio and genres. `studio` limits it to one studio.
 */
export function AnnouncedRail({ limit = 12 }: { limit?: number }) {
  const [items, setItems] = useState<AnnouncedAnime[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/announced?limit=${limit}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => alive && setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [limit]);

  if (items && items.length === 0) return null;
  return (
    <section className={styles.block} aria-labelledby="home-announced">
      <SectionHead kicker="Fresh from the studios" title="Just Announced" id="home-announced" href="/announced" linkLabel="All announcements" />
      <div className={styles.rail}>
        {items
          ? items.map((a) => <AnnouncedCard key={a.id} anime={a} compact />)
          : Array.from({ length: 3 }, (_, i) => <div key={i} className={styles.skeleton} />)}
      </div>
    </section>
  );
}
