import React from 'react';
import type { Metadata } from 'next';
import { PageHead } from '../../components/ui/PageHead';
import { AnnouncedFeed } from '../../components/announced/AnnouncedFeed';
import { AnnouncedLead } from '../../components/announced/AnnouncedCard';
import { announcedFormatCounts, countAnnouncedAnime, getAnnouncedAnime } from '../../lib/announcements/announcedAnime';
import { ensureFreshAnnouncements } from '../../lib/announcements/announcementSync';
import { isWideBanner } from '../../lib/media/heroArt';
import styles from '../../components/announced/Announced.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Announced Anime — OTAKUVA',
  description: 'Newly announced anime: posters, premiere dates, studios and the news behind each announcement.',
};

/**
 * Announced (2026-11-01): every anime that has been announced but hasn't
 * premiered, newest announcement first. The lead is the newest one with wide
 * art among the latest few.
 */
export default async function AnnouncedPage() {
  ensureFreshAnnouncements();
  const [items, total, formats] = await Promise.all([getAnnouncedAnime({ limit: 25 }), countAnnouncedAnime(), announcedFormatCounts()]);
  const lead = items.slice(0, 8).find((a) => isWideBanner(a.bannerUrl)) ?? items[0] ?? null;

  return (
    <div className={styles.page}>
      <PageHead kicker="Fresh from the studios" title="Announced" />
      {lead && <AnnouncedLead anime={lead} />}
      <AnnouncedFeed initial={items} initialTotal={total} formats={formats} skipIds={lead ? [lead.id] : []} />
    </div>
  );
}
