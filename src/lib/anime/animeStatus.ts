/**
 * One display vocabulary for airing status. Providers disagree: AniList
 * stores "Finished" / "Airing" / "Not Yet Aired", Jikan "Finished Airing" /
 * "Currently Airing" / "Not yet aired", plus enum-style variants. Cards used
 * to show whichever string came in — and classified "Finished Airing" as
 * airing because it contains "air".
 */
export type AiringStatus = 'airing' | 'finished' | 'upcoming';

export function classifyAnimeStatus(raw?: string | null): AiringStatus | null {
  const v = String(raw || '').trim().toLowerCase().replace(/_/g, ' ');
  if (!v || v === 'unknown') return null;
  if (v.includes('not yet') || v.includes('upcoming') || v === 'not aired') return 'upcoming';
  if (v.includes('finished') || v.includes('completed') || v === 'ended') return 'finished';
  if (v.includes('airing') || v === 'releasing' || v === 'ongoing') return 'airing';
  return null;
}

const LABELS: Record<AiringStatus, string> = {
  airing: 'Airing',
  finished: 'Finished',
  upcoming: 'Not yet aired',
};

/** Display label, or null when the status is unknown (nothing is assumed). */
export function formatAnimeStatus(raw?: string | null): string | null {
  const s = classifyAnimeStatus(raw);
  if (s) return LABELS[s];
  // AniList's CANCELLED (16 anime, 2026-11-06): labelled as such, but not
  // classified — it isn't airing, finished or upcoming for any logic.
  if (/^cancel+ed$/i.test(String(raw || '').trim())) return 'Cancelled';
  return null;
}
