'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLibrary } from '../../context/LibraryContext';
import { useToast } from '../../context/ToastContext';
import { Check, CheckCircle2, ChevronDown, ChevronUp, Play, Tv } from 'lucide-react';
import type { EpisodeRetentionSummary } from '../rating/EpisodeRetentionModal';
import { RetentionBars } from './RetentionBars';
import { retentionColor, retentionLabel, retentionSoftColor } from '../../lib/rating/retentionTone';
import styles from './EpisodeQuickList.module.css';

export interface EpisodeItem {
  id?: string;
  seasonId?: string;
  seasonNumber?: number;
  number: number;
  title?: string;
  airedAt?: string | null;
  aired?: string | null;
  duration?: string | null;
  synopsis?: string | null;
  thumbnail?: string | null;
  filler?: boolean;
  recap?: boolean;
  score?: number | null;
  isWatched?: boolean;
}

export interface SeasonItem {
  id: string;
  seasonNumber: number;
  title: string;
  slug?: string;
  episodeCount?: number;
  episodes?: EpisodeItem[];
}

interface EpisodeQuickListProps {
  animeId: string;
  totalEpisodes?: number;
  episodesList?: EpisodeItem[];
  seasonsList?: SeasonItem[];
  animeTitle?: string;
  onOpenTrailer?: () => void;
  /** Aired episodes + retention, from GET /api/anime/:id/episode-ratings. */
  ratingSummary?: EpisodeRetentionSummary | null;
  /** Opens the rating window for one episode (unused when rating inline). */
  onRateEpisode?: (episodeNumber: number) => void;
  /** Episode retention is rated inline in the row; called with the fresh summary. */
  onSummaryChange?: (summary: EpisodeRetentionSummary) => void;
}

export const EpisodeQuickList: React.FC<EpisodeQuickListProps> = ({
  animeId,
  totalEpisodes,
  episodesList = [],
  seasonsList = [],
  animeTitle = 'Anime',
  onOpenTrailer,
  ratingSummary = null,
  onRateEpisode,
  onSummaryChange,
}) => {
  const { user } = useAuth();
  const { applyTracking, getItem } = useLibrary();
  const { showToast } = useToast();

  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState(0);
  const [watchedEpisodeIds, setWatchedEpisodeIds] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Initialize watched IDs from props
  useEffect(() => {
    const initialWatched = new Set<string>();
    if (Array.isArray(episodesList) && episodesList.length > 0) {
      episodesList.forEach((ep) => {
        if (ep.isWatched && (ep.id || ep.number)) {
          initialWatched.add(ep.id || `ep-${ep.number}`);
        }
      });
    }
    setWatchedEpisodeIds(initialWatched);
  }, [episodesList]);

  // Build Season Partitions
  const normalizedSeasons = useMemo(() => {
    // 1. If explicit seasonsList with directSeasons or seasons was passed
    if (Array.isArray(seasonsList) && seasonsList.length > 0) {
      return seasonsList.map((s, idx) => {
        const seasonEps = (s.episodes && s.episodes.length > 0)
          ? s.episodes
          : episodesList.filter((ep) => ep.seasonId === s.id || ep.seasonNumber === (s.seasonNumber || idx + 1));

        // Real rows first, then the season's declared count; never an
        // invented default (this used to fall back to 12).
        const epCount = seasonEps.length || s.episodeCount || (idx === 0 ? totalEpisodes ?? 0 : 0);
        return {
          id: s.id || `season-${s.seasonNumber || idx + 1}`,
          seasonNumber: s.seasonNumber || idx + 1,
          title: s.title || `Season ${s.seasonNumber || idx + 1}`,
          episodeCount: epCount,
          episodes: seasonEps,
        };
      })
        // A season with no episodes and no known count is an empty placeholder
        // row (e.g. a stray "Season 2" whose real season is its own anime).
        .filter((s, idx) => idx === 0 || s.episodes.length > 0 || s.episodeCount > 0);
    }

    // 2. Fallback: If we have an episodes list with seasonIds
    const seasonIdGroups = new Map<string, EpisodeItem[]>();
    episodesList.forEach((ep) => {
      const sId = ep.seasonId || 'default-season';
      if (!seasonIdGroups.has(sId)) seasonIdGroups.set(sId, []);
      seasonIdGroups.get(sId)!.push(ep);
    });

    if (seasonIdGroups.size > 1) {
      let seasonIdx = 1;
      const result: SeasonItem[] = [];
      seasonIdGroups.forEach((eps, key) => {
        result.push({
          id: key,
          seasonNumber: seasonIdx,
          title: `Season ${seasonIdx}`,
          episodeCount: eps.length,
          episodes: eps,
        });
        seasonIdx++;
      });
      return result;
    }

    // 3. Single season: the real episode rows, if any. No rows are generated
    // here any more — this used to invent "Episode N · 24 min · Broadcast"
    // rows (for ~95% of the catalog), whose ids could never be saved.
    return [
      {
        id: 'season-1',
        seasonNumber: 1,
        title: 'Season 1',
        episodeCount: episodesList.length || totalEpisodes || 0,
        episodes: episodesList,
      },
    ];
  }, [seasonsList, episodesList, totalEpisodes]);

  const activeSeason = normalizedSeasons[selectedSeasonIdx] || normalizedSeasons[0];

  // Active episodes for the selected season
  // Real episode rows only. When there are none, the guide shows a progress
  // counter instead (see below) rather than placeholder episodes.
  const storedEpisodes: EpisodeItem[] = useMemo(() => activeSeason.episodes || [], [activeSeason]);
  const hasEpisodeRows = storedEpisodes.length > 0;
  // No stored rows but we know which episodes have aired (schedule, status,
  // official count): list exactly those, numbered — no invented titles,
  // durations or dates. Only for a single-season entry, where the aired count
  // is this entry's own.
  const releasedRows: EpisodeItem[] = useMemo(() => {
    if (hasEpisodeRows || normalizedSeasons.length > 1 || !ratingSummary) return [];
    return ratingSummary.episodes.map((e) => ({ number: e.number, title: e.title ?? undefined, airedAt: e.airedAt ?? null } as EpisodeItem));
  }, [hasEpisodeRows, normalizedSeasons.length, ratingSummary]);
  const activeEpisodes: EpisodeItem[] = hasEpisodeRows ? storedEpisodes : releasedRows;
  const hasListRows = activeEpisodes.length > 0;
  const released = ratingSummary?.released ?? 0;
  const retentionOf = (n: number) => ratingSummary?.episodes.find((e) => e.number === n) ?? null;
  const myRetentionOf = (n: number) => ratingSummary?.mine[n]?.retention ?? null;
  const declaredCount = activeSeason.episodeCount || null;

  // Display limited rows when not expanded
  const INITIAL_DISPLAY_COUNT = 12;
  const displayedEpisodes = isExpanded
    ? activeEpisodes
    : activeEpisodes.slice(0, INITIAL_DISPLAY_COUNT);

  const watchedCount = useMemo(() => {
    return activeEpisodes.filter((ep) => watchedEpisodeIds.has(ep.id || `ep-${ep.number}`)).length;
  }, [activeEpisodes, watchedEpisodeIds]);

  // --- Progress counter (no episode rows on record) ---------------------
  // Saves a plain count through the library API; nothing is invented.
  const libraryItem = getItem(animeId);
  const watchedTotal = libraryItem?.episodesWatched ?? 0;
  const [isSavingCount, setIsSavingCount] = useState(false);

  const setWatchedCount = async (next: number) => {
    if (!user) {
      showToast('Sign in to save episode progress', 'info');
      return;
    }
    const cap = declaredCount ?? Number.MAX_SAFE_INTEGER;
    const target = Math.max(0, Math.min(next, cap));
    if (target === watchedTotal || isSavingCount) return;

    const previous = libraryItem;
    const status =
      declaredCount && target >= declaredCount
        ? 'completed'
        : !previous || previous.status === 'plan_to_watch' || previous.status === 'completed'
        ? 'watching'
        : undefined;
    applyTracking(animeId, { episodesWatched: target, ...(status ? { status } : {}) });
    setIsSavingCount(true);
    try {
      const res = await fetch(`/api/library/${encodeURIComponent(animeId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodesWatched: target, ...(status ? { status } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
    } catch (err: any) {
      applyTracking(animeId, { episodesWatched: previous?.episodesWatched ?? 0, status: previous?.status ?? null });
      showToast(err?.message ? `Couldn't save progress: ${err.message}` : "Couldn't save progress", 'error');
    } finally {
      setIsSavingCount(false);
    }
  };

  // Every aired row carries its own retention bar (always visible) — there is
  // nothing to open; clicking a row just highlights it.
  const canRate = Boolean(onSummaryChange);

  // Rows built from the aired count (no stored episode rows): each tick is its
  // own record (UserEpisodeWatch, 2026-10-21) — ticking episode 5 marks only
  // 5. It used to mean "watched up to 5" and ticked 1–4 as well.
  const [tickedNumbers, setTickedNumbers] = useState<Set<number>>(new Set());
  const [tickBusy, setTickBusy] = useState<Set<number>>(new Set());
  // Bumped on every tick; a page load that started before a tick never
  // overwrites it (that showed up as ticks "moving" between episodes).
  const tickVersion = React.useRef(0);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (hasEpisodeRows || !userId) {
      setTickedNumbers(new Set());
      return;
    }
    let live = true;
    const startedAt = tickVersion.current;
    fetch(`/api/anime/${encodeURIComponent(animeId)}/watched-episodes`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (live && body?.numbers && tickVersion.current === startedAt) setTickedNumbers(new Set<number>(body.numbers));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [animeId, hasEpisodeRows, userId]);

  const isTicked = (n: number) => !hasEpisodeRows && tickedNumbers.has(n);

  // Progress strip + "Up next" (2026-10-22): from the same watched state the
  // rows use — nothing estimated.
  const rowWatched = (ep: EpisodeItem) =>
    hasEpisodeRows ? watchedEpisodeIds.has(ep.id || `ep-${ep.number}`) : isTicked(Math.floor(ep.number));
  const rowAired = (ep: EpisodeItem) => !canRate || (ep.number >= 1 && ep.number <= released);
  const listWatched = activeEpisodes.filter(rowWatched).length;
  const listAired = activeEpisodes.filter(rowAired).length;
  const firstUnwatched = user ? activeEpisodes.find((ep) => rowAired(ep) && !rowWatched(ep))?.number ?? null : null;
  // Watched → rate first (owner, 2026-10-26): after ticking an episode it
  // stays the focus, with its retention bar, until you submit a retention;
  // only then does "Up next" move on to the next episode.
  const [rateFirst, setRateFirst] = useState<number | null>(null);
  useEffect(() => {
    if (rateFirst !== null && myRetentionOf(rateFirst) !== null) setRateFirst(null);
  }, [rateFirst, ratingSummary]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextUpNumber = rateFirst ?? firstUnwatched;

  // Range chips (1–12, 13–24 …) for long lists (2026-10-27). Opens on the
  // range holding your next episode; once you tick or pick, it stays put.
  const rangeSize = activeEpisodes.length <= 120 ? 12 : activeEpisodes.length <= 400 ? 25 : activeEpisodes.length <= 1200 ? 50 : 100;
  const ranges = useMemo(() => {
    const out: { start: number; end: number; from: number; to: number }[] = [];
    for (let i = 0; i < activeEpisodes.length; i += rangeSize) {
      const end = Math.min(activeEpisodes.length, i + rangeSize);
      out.push({ start: i, end, from: activeEpisodes[i].number, to: activeEpisodes[end - 1].number });
    }
    return out;
  }, [activeEpisodes, rangeSize]);
  const showRanges = activeEpisodes.length > 24 && ranges.length > 1;
  const [pickedRange, setPickedRange] = useState<number | null>(null);
  const rangeOf = (n: number) => ranges.findIndex((r) => n >= r.from && n <= r.to);
  const autoRange = (() => {
    if (nextUpNumber !== null) return Math.max(0, rangeOf(nextUpNumber));
    // All caught up: the range with the latest aired episode.
    if (listWatched > 0 && released > 0) return Math.max(0, rangeOf(Math.min(released, ranges[ranges.length - 1]?.to ?? released)));
    return 0;
  })();
  const rangeIdx = pickedRange !== null && pickedRange < ranges.length ? pickedRange : autoRange;
  const pinRange = () => {
    if (showRanges && pickedRange === null) setPickedRange(rangeIdx);
  };
  const shownEpisodes = showRanges && ranges[rangeIdx]
    ? activeEpisodes.slice(ranges[rangeIdx].start, ranges[rangeIdx].end)
    : displayedEpisodes;
  const [nowMs, setNowMs] = useState<number | null>(null);
  // Ticks so "Just aired · 2 min ago" and "Airs in 3h 12m" stay live.
  useEffect(() => {
    setNowMs(Date.now());
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const latestAired = released > 0 ? released : null;
  const nextUp = ratingSummary?.next ?? null;
  const ago = (iso: string) => {
    if (nowMs === null) return null;
    const mins = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60_000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    return `${h}h ago`;
  };
  const countdown = (iso: string) => {
    if (nowMs === null) return null;
    const mins = Math.round((new Date(iso).getTime() - nowMs) / 60_000);
    if (mins <= 0) return 'any moment';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    if (h < 48) return `${h}h ${mins % 60}m`;
    return `${Math.round(h / 24)} days`;
  };
  // Release tracker: how many episodes are out so far ("3 / 12"), and
  // "Complete" once the last one has aired. Only real counts — the aired
  // number comes from getEpisodeReleaseState, the total from the provider.
  const releaseTotal = ratingSummary?.total ?? declaredCount ?? null;
  const releaseComplete = releaseTotal !== null && released >= releaseTotal && !nextUp;
  const showRelease =
    !!ratingSummary && released > 0 && normalizedSeasons.length <= 1 &&
    (!!ratingSummary.airing || !!nextUp || (releaseTotal !== null && releaseTotal > 1));
  const isFresh = (ep: EpisodeItem) => {
    if (!ep.airedAt || nowMs === null) return false;
    const t = new Date(ep.airedAt).getTime();
    return t <= nowMs && nowMs - t < 7 * 86_400_000;
  };
  // Each tick touches only its own episode — in the UI and on the server.
  // Taps on different episodes can overlap; a reply never rewrites other
  // episodes' ticks (the server applies one member's ticks one at a time).
  const toggleTick = async (n: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      showToast('Sign in to save episode progress', 'info');
      return;
    }
    if (tickBusy.has(n)) return;
    pinRange();
    const version = ++tickVersion.current;
    const watched = !tickedNumbers.has(n);
    if (watched && canRate && myRetentionOf(n) === null) setRateFirst(n);
    else if (!watched && rateFirst === n) setRateFirst(null);
    const flip = (on: boolean) =>
      setTickedNumbers((prev) => {
        const next = new Set(prev);
        if (on) next.add(n);
        else next.delete(n);
        return next;
      });
    flip(watched);
    setTickBusy((prev) => new Set(prev).add(n));
    try {
      const res = await fetch(`/api/anime/${encodeURIComponent(animeId)}/watched-episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeNumber: n, watched }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      // The tick already shows; only the library count/status comes from the
      // server (from the newest tap, so an older reply can't roll it back).
      if (version === tickVersion.current && body.inLibrary !== false) applyTracking(animeId, { episodesWatched: body.episodesWatched, status: body.status });
    } catch (err: any) {
      flip(!watched);
      if (watched) setRateFirst((cur) => (cur === n ? null : cur));
      showToast(err?.message ? `Couldn't save episode ${n}: ${err.message}` : `Couldn't save episode ${n}`, 'error');
    } finally {
      setTickBusy((prev) => {
        const next = new Set(prev);
        next.delete(n);
        return next;
      });
    }
  };

  // Toggle single episode watched state
  const handleToggleWatched = async (ep: EpisodeItem, e: React.MouseEvent) => {
    e.stopPropagation();

    const epId = ep.id || `ep-${ep.number}`;
    const currentlyWatched = watchedEpisodeIds.has(epId);
    pinRange();
    const targetStatus = currentlyWatched ? 'UNWATCHED' : 'WATCHED';
    if (!currentlyWatched && canRate && myRetentionOf(ep.number) === null) setRateFirst(ep.number);
    else if (currentlyWatched && rateFirst === ep.number) setRateFirst(null);

    setWatchedEpisodeIds((prev) => {
      const next = new Set(prev);
      if (currentlyWatched) next.delete(epId);
      else next.add(epId);
      return next;
    });

    setIsUpdating(epId);

    // Paint every progress display (hero progress box, journey card, sticky
    // bar) right away instead of waiting for the round trip; the server's
    // numbers replace this guess when they arrive.
    const previousItem = getItem(animeId);
    // Only paint library progress when it's already in the library — a tick
    // never adds it there.
    if (user && previousItem) {
      applyTracking(animeId, {
        episodesWatched: (previousItem?.episodesWatched ?? 0) + (currentlyWatched ? -1 : 1),
        episodeNumber: ep.number,
        watched: !currentlyWatched,
      });
    }

    try {
      if (user) {
        const res = await fetch(`/api/anime/${animeId}/episodes/${epId}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: targetStatus, episodeNumber: ep.number }),
        });

        // A rejected write used to fall through as success.
        if (!res.ok) throw new Error(`Episode progress update failed (${res.status})`);
        const json = await res.json();
        // Authoritative status/count from the same response — no second
        // PATCH /api/library round trip (it used to call updateStatus here).
        if (json.userTracking) {
          applyTracking(animeId, {
            status: json.userTracking.status,
            episodesWatched: json.userTracking.episodesWatched,
          });
        }
      }

      showToast(
        currentlyWatched ? `Episode ${ep.number} unmarked` : `Episode ${ep.number} marked as watched`,
        'success'
      );
    } catch (err: any) {
      console.error('Episode toggle error:', err);
      if (user && previousItem) {
        applyTracking(animeId, {
          status: previousItem?.status ?? null,
          episodesWatched: previousItem?.episodesWatched ?? 0,
          episodeNumber: ep.number,
          watched: currentlyWatched,
        });
      }
      setWatchedEpisodeIds((prev) => {
        const rollback = new Set(prev);
        if (currentlyWatched) rollback.add(epId);
        else rollback.delete(epId);
        return rollback;
      });
      showToast("Couldn't update episode progress", 'error');
    } finally {
      setIsUpdating(null);
    }
  };

  // Mark all episodes in this season as watched
  const handleMarkAllSeasonWatched = async () => {
    if (!user) {
      showToast('Sign in to save episode progress', 'info');
      return;
    }

    const allSeasonIds = activeEpisodes.map((ep) => ep.id || `ep-${ep.number}`);
    setWatchedEpisodeIds((prev) => {
      const next = new Set(prev);
      allSeasonIds.forEach((id) => next.add(id));
      return next;
    });

    const previousIds = watchedEpisodeIds;
    const previousItem = getItem(animeId);
    try {
      const res = await fetch(`/api/anime/${animeId}/progress/mark-all-watched`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      // A 409 ("no released episodes") or 500 used to still report success
      // and flip the library status to Completed.
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      applyTracking(animeId, {
        status: json.libraryStatus || 'completed',
        ...(typeof json.totalWatched === 'number' ? { episodesWatched: json.totalWatched } : {}),
      });
      showToast(`All ${activeEpisodes.length} episodes marked as watched!`, 'success');
    } catch (err: any) {
      setWatchedEpisodeIds(previousIds);
      if (previousItem) {
        applyTracking(animeId, { status: previousItem.status, episodesWatched: previousItem.episodesWatched });
      }
      showToast(err?.message ? `Couldn't mark all episodes: ${err.message}` : "Couldn't mark all episodes", 'error');
    }
  };

  return (
    <div className={styles.section} aria-label="Episode Guide">
      <div className={styles.sectionHead}>
        <div className={styles.titleArea}>
          <div className={styles.titleRow}>
            <Tv size={16} className={styles.sectionIcon} />
            <h3 className={styles.title}>Episode Guide</h3>
          </div>
          <span className={styles.subtitle}>
            {hasEpisodeRows
              ? `${activeSeason.title} • ${watchedCount}/${activeEpisodes.length} watched`
              : hasListRows
              ? `${activeEpisodes.length} aired${declaredCount ? ` of ${declaredCount}` : ''} · mark an episode watched, then rate it`
              : declaredCount
              ? `${declaredCount} episode${declaredCount === 1 ? '' : 's'}`
              : activeSeason.title}
          </span>
        </div>

        <div className={styles.headerActions}>
          {hasEpisodeRows && (
            <button
              type="button"
              className={styles.markAllBtn}
              onClick={handleMarkAllSeasonWatched}
            >
              Mark season watched
            </button>
          )}
          {onOpenTrailer && (
            <button
              type="button"
              className={styles.trailerBtn}
              onClick={onOpenTrailer}
              title="Watch Official Trailer"
            >
              <Play size={11} fill="currentColor" />
              <span>Trailer</span>
            </button>
          )}
        </div>
      </div>

      {/* Season Selector Tabs */}
      {normalizedSeasons.length > 0 && (
        <div className={styles.seasonTabs} role="tablist" aria-label="Anime Seasons">
          {normalizedSeasons.map((season, idx) => (
            <button
              key={season.id || idx}
              type="button"
              role="tab"
              aria-selected={selectedSeasonIdx === idx}
              className={`${styles.tab} ${selectedSeasonIdx === idx ? styles.activeTab : ''}`}
              onClick={() => {
                setSelectedSeasonIdx(idx);
                setIsExpanded(false);
                setPickedRange(null);
              }}
            >
              <span className={styles.tabSeasonName}>{season.title}</span>
              {(season.episodeCount ?? 0) > 0 && <span className={styles.tabEpCount}>{season.episodeCount} eps</span>}
            </button>
          ))}
        </div>
      )}

      {showRelease && (
        <div className={`${styles.release} ${releaseComplete ? styles.releaseDone : ''}`} aria-label="Episode release progress">
          <div className={styles.releaseHead}>
            <span className={styles.releaseLabel}>
              {releaseComplete ? (
                <>
                  <CheckCircle2 size={14} aria-hidden="true" /> Complete
                </>
              ) : (
                <>
                  <i className={styles.liveDot} aria-hidden="true" /> {ratingSummary?.airing || nextUp ? 'Airing weekly' : 'Episodes out'}
                </>
              )}
            </span>
            <span className={styles.releaseCount} aria-live="polite">
              <strong key={released}>{released}</strong>
              {releaseTotal !== null ? <span>/ {releaseTotal}</span> : null}
              <span className={styles.releaseUnit}>{releaseComplete ? 'episodes, all out' : `episode${released === 1 ? '' : 's'} out`}</span>
            </span>
            <span className={styles.releaseNext}>
              {releaseComplete
                ? `All ${releaseTotal} episodes have aired`
                : nextUp
                ? `Episode ${nextUp.number}${countdown(nextUp.airingAt) ? ` · in ${countdown(nextUp.airingAt)}` : ''}`
                : releaseTotal === null
                ? 'Total not announced yet'
                : `${releaseTotal - released} to go`}
            </span>
          </div>
          {releaseTotal !== null && releaseTotal <= 60 ? (
            <div className={styles.releaseStrip} aria-hidden="true">
              {Array.from({ length: releaseTotal }, (_, i) => i + 1).map((n) => (
                <span
                  key={n}
                  className={n <= released ? styles.relOut : nextUp && n === nextUp.number ? styles.relNext : styles.relLater}
                  style={{ ['--i' as string]: n } as React.CSSProperties}
                  title={n <= released ? `Episode ${n} · out` : nextUp && n === nextUp.number ? `Episode ${n} · next` : `Episode ${n}`}
                />
              ))}
            </div>
          ) : releaseTotal !== null ? (
            <div className={styles.releaseBar} aria-hidden="true">
              <span style={{ width: `${Math.min(100, (released / releaseTotal) * 100)}%` }} />
            </div>
          ) : null}
        </div>
      )}

      {/* No list at all: the progress counter is the only way to track. */}
      {!hasListRows && (
        <div className={styles.counterCard}>
          <p className={styles.counterNote}>
            The episode-by-episode list for this {normalizedSeasons.length > 1 ? 'season' : 'series'} isn&apos;t in our catalog yet
            {declaredCount ? '' : ', and the total episode count hasn’t been announced'}. You can still track how far you are.
          </p>
          <div className={styles.counterRow}>
            <button
              type="button"
              className={styles.counterBtn}
              onClick={() => setWatchedCount(watchedTotal - 1)}
              disabled={isSavingCount || watchedTotal <= 0}
              aria-label="One episode fewer"
            >
              −
            </button>
            <div className={styles.counterValue} aria-live="polite">
              <strong>{watchedTotal}</strong>
              {declaredCount ? <span> / {declaredCount}</span> : null}
              <span className={styles.counterLabel}>episodes watched</span>
            </div>
            <button
              type="button"
              className={styles.counterBtn}
              onClick={() => setWatchedCount(watchedTotal + 1)}
              disabled={isSavingCount || (declaredCount !== null && watchedTotal >= declaredCount)}
              aria-label="One more episode watched"
            >
              +
            </button>
          </div>
          {declaredCount !== null && watchedTotal > 0 && (
            <div className={styles.counterBar} aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.round((watchedTotal / declaredCount) * 100))}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Progress strip: one segment per listed episode (watched / aired /
          not yet), or a plain bar for very long shows. */}
      {hasListRows && user && listAired > 0 && (
        <div className={styles.progress}>
          <div className={styles.progressText}>
            <strong>{listWatched}</strong>
            <span>/ {listAired} watched</span>
            {nextUpNumber !== null && listWatched > 0 && <em>Up next · Episode {nextUpNumber}</em>}
            {listWatched > 0 && listWatched >= listAired && <em className={styles.progressDone}>All caught up</em>}
          </div>
          {activeEpisodes.length <= 60 ? (
            <div className={styles.strip} aria-hidden="true">
              {activeEpisodes.map((ep) => (
                <span
                  key={ep.id || ep.number}
                  className={rowWatched(ep) ? styles.segWatched : rowAired(ep) ? styles.segAired : styles.segUpcoming}
                  title={`Episode ${ep.number}`}
                />
              ))}
            </div>
          ) : (
            <div className={styles.counterBar} aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.round((listWatched / listAired) * 100))}%` }} />
            </div>
          )}
        </div>
      )}

      {hasListRows && showRanges && (
        <div className={styles.rangeChips} role="tablist" aria-label="Episode ranges">
          {ranges.map((r, i) => {
            const holdsNext = nextUpNumber !== null && nextUpNumber >= r.from && nextUpNumber <= r.to;
            return (
              <button
                key={r.start}
                type="button"
                role="tab"
                aria-selected={rangeIdx === i}
                className={`${styles.rangeChip} ${rangeIdx === i ? styles.rangeChipActive : ''}`}
                onClick={() => setPickedRange(i)}
                title={holdsNext ? `Up next: Episode ${nextUpNumber}` : undefined}
              >
                {r.from === r.to ? r.from : `${r.from}–${r.to}`}
                {holdsNext && <i className={styles.rangeDot} aria-label="Up next is in this range" />}
              </button>
            );
          })}
        </div>
      )}

      {hasListRows && (
        <ul className={styles.epLines}>
          {shownEpisodes.map((ep) => {
            const epId = ep.id || `ep-${ep.number}`;
            const n = Math.floor(ep.number);
            const isWatched = hasEpisodeRows ? watchedEpisodeIds.has(epId) : isTicked(n);
            const aired = ep.number >= 1 && ep.number <= released;
            const community = retentionOf(ep.number);
            const mine = myRetentionOf(ep.number);
            const date = ep.aired || (ep.airedAt ? new Date(ep.airedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null);
            const realTitle = ep.title && !/^episode\s*\d+$/i.test(ep.title.trim()) ? ep.title : null;
            const isNext = ep.number === nextUpNumber;
            const fresh = isFresh(ep);

            return (
              <li
                key={epId}
                className={`${styles.epLine} ${isWatched ? styles.epLineWatched : ''} ${!aired && canRate ? styles.epLineUpcoming : ''} ${isNext ? styles.epLineNext : ''} ${ep.number === rateFirst ? styles.epLineRateNow : ''}`}
              >
                <span className={styles.epLineNo}>
                  <small>EP</small>
                  {String(ep.number).padStart(2, '0')}
                </span>
                <span className={styles.epLineText}>
                  <span className={styles.epLineTitleRow}>
                    <span className={realTitle ? styles.epLineTitle : styles.epLineTitleMuted}>{realTitle || `Episode ${ep.number}`}</span>
                    {isNext && ep.number === rateFirst ? (
                      <span className={styles.rateNowBadge}>Rate this episode</span>
                    ) : (
                      isNext && <span className={styles.nextBadge}>Up next</span>
                    )}
                    {/* The latest episode, in its first day: "Just aired · 2 min ago" (live). */}
                    {aired && ep.number === latestAired && ep.airedAt && nowMs !== null && nowMs - new Date(ep.airedAt).getTime() < 24 * 3_600_000 ? (
                      <span className={styles.justAired}>
                        <i aria-hidden="true" /> Just aired · {ago(ep.airedAt)}
                      </span>
                    ) : (
                      fresh && <span className={styles.newBadge}>New</span>
                    )}
                  </span>
                  {(date || ep.filler || ep.recap || (aired && community?.retention != null)) && (
                    <span className={styles.epLineMeta}>
                      {date}
                      {ep.filler && <span className={styles.fillerBadge}>Filler</span>}
                      {ep.recap && <span className={styles.recapBadge}>Recap</span>}
                      {/* The community's score for this episode, right under its title (2026-10-25). */}
                      {aired && community?.retention != null && (
                        <span
                          className={styles.communityPill}
                          style={{ color: retentionColor(community.retention), background: retentionSoftColor(community.retention) }}
                          title={`Community retention · ${community.retentionCount} ${community.retentionCount === 1 ? 'rating' : 'ratings'}`}
                        >
                          {community.retention}% {retentionLabel(community.retention)}
                        </span>
                      )}
                    </span>
                  )}
                </span>
                {canRate && (
                  <span className={styles.epLineRate}>
                    {aired && onSummaryChange ? (
                      <RetentionBars
                        animeId={animeId}
                        episodeNumber={n}
                        mine={mine}
                        myComment={ratingSummary?.mine[ep.number]?.note ?? null}
                        community={{ value: community?.retention ?? null, count: community?.retentionCount ?? 0 }}
                        onSaved={onSummaryChange}
                        compact
                        locked={!isWatched}
                      />
                    ) : (
                      <span className={styles.notAired}>
                        {nextUp && ep.number === nextUp.number && countdown(nextUp.airingAt) ? `Airs in ${countdown(nextUp.airingAt)}` : 'Not aired yet'}
                      </span>
                    )}
                  </span>
                )}
                <button
                  type="button"
                  aria-pressed={isWatched}
                  className={`${styles.epTick} ${isWatched ? styles.epTickOn : ''}`}
                  disabled={hasEpisodeRows ? isUpdating === epId : tickBusy.has(n) || !aired}
                  onClick={(e) => (hasEpisodeRows ? handleToggleWatched(ep, e) : toggleTick(n, e))}
                  title={isWatched ? 'Mark as unwatched' : 'Mark as watched'}
                  aria-label={`${isWatched ? 'Unmark' : 'Mark'} episode ${ep.number} as watched`}
                >
                  <Check size={14} strokeWidth={3} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Expand / Collapse Toggle if many episodes */}
      {!showRanges && activeEpisodes.length > INITIAL_DISPLAY_COUNT && (
        <button
          type="button"
          className={styles.expandToggleBtn}
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          <span>
            {isExpanded
              ? 'Show Less'
              : `Show All ${activeEpisodes.length} Episodes (+${activeEpisodes.length - INITIAL_DISPLAY_COUNT} more)`}
          </span>
          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      )}
    </div>
  );
};
