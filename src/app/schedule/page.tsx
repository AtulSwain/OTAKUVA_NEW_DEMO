'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Calendar, Plus, Check, Bell, Globe, Sparkles, AlertCircle, Tv, ExternalLink, Radio } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { COMMON_TIMEZONES } from '../../lib/engine/schedule/scheduleTimezone';
import { AnimeImage } from '../../components/anime/AnimeImage';
import { streamingBrandColor } from '../../components/schedule/streamingBrands';
import styles from './schedule.module.css';
import { ComingSoon } from './ComingSoon';

interface EnrichedScheduleItem {
  id: string;
  animeId: string;
  slug: string;
  title: string;
  posterImage: string | null;
  episode: number;
  episodeTitle: string | null;
  airingAtUtc: string;
  localDate: string;
  localTime: string;
  localTime12h: string;
  originalTime: string | null;
  weekday: string;
  day: string;
  status: string;
  airingStatus: string;
  format: string;
  delayReason: string | null;
  score: number | null;
  genres: string[];
  inLibrary: boolean;
  hasReminder: boolean;
  relativeTimeText: string;
  seasonTitle: string | null;
  streaming?: Array<{ name: string; url: string }>;
}

const PRESET_TABS = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'this_week', label: 'This Week' },
  { key: 'upcoming', label: 'Next 90 Days' },
  { key: 'up_next', label: 'Up Next for You' },
  { key: 'coming_soon', label: 'Coming Soon' },
];

const PAGE_SIZE = 200;
const MAX_PAGES = 5;
/** An episode counts as "airing now" for this long after its start time. */
const AIRING_WINDOW_MS = 30 * 60 * 1000;

/** "2026-10-16" for the given instant, in the given time zone. */
function dateKeyIn(timeZone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function shiftDateKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDayLabel(
  key: string,
  todayKey: string
): { relative: string | null; full: string; weekday: string; dayOfMonth: string } {
  const d = new Date(`${key}T12:00:00Z`);
  // Formatted piecewise: locales order "Fri 16" vs "16 Fri" differently.
  const full = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
  const dayOfMonth = d.toLocaleDateString(undefined, { day: 'numeric', timeZone: 'UTC' });
  const relative =
    key === todayKey ? 'Today' : key === shiftDateKey(todayKey, 1) ? 'Tomorrow' : key === shiftDateKey(todayKey, -1) ? 'Yesterday' : null;
  return { relative, full, weekday, dayOfMonth };
}

function formatCountdown(ms: number): string {
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  let text: string;
  if (mins < 1) text = 'less than a minute';
  else if (mins < 60) text = `${mins}m`;
  else if (mins < 24 * 60) text = `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ''}`.trim();
  else {
    const days = Math.floor(mins / (24 * 60));
    const hours = Math.floor((mins % (24 * 60)) / 60);
    text = `${days}d${hours ? ` ${hours}h` : ''}`;
  }
  return ms >= 0 ? `in ${text}` : `${text} ago`;
}

type LiveStatus = 'upcoming' | 'airing' | 'aired' | 'delayed' | 'cancelled';

function liveStatus(item: EnrichedScheduleItem, now: number): LiveStatus {
  const st = item.airingStatus || item.status;
  if (st === 'CANCELLED') return 'cancelled';
  if (st === 'DELAYED') return 'delayed';
  const at = new Date(item.airingAtUtc).getTime();
  if (Number.isNaN(at)) return st === 'RELEASED' ? 'aired' : 'upcoming';
  if (now < at) return 'upcoming';
  if (now - at < AIRING_WINDOW_MS) return 'airing';
  return 'aired';
}

export default function SchedulePage() {
  const { library, updateStatus } = useLibrary();

  // Defaults to "This Week" rather than "Today": landing on an empty
  // "Today" read as "the feature is broken" rather than "nothing airs today."
  const [activeTab, setActiveTab] = useState<string>('this_week');
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [timezone, setTimezone] = useState<string>('UTC');
  const [libraryOnly, setLibraryOnly] = useState<boolean>(false);
  const [streamingOnly, setStreamingOnly] = useState<boolean>(false);
  const [schedules, setSchedules] = useState<EnrichedScheduleItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [reminders, setReminders] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    try {
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (localTz) setTimezone(localTz);
    } catch {
      setTimezone('UTC');
    }
  }, []);

  // Countdowns and the "now" marker stay live without refetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const loadSchedule = useCallback(async () => {
    // Coming Soon has its own list (ComingSoon.tsx), not episode times.
    if (activeTab === 'coming_soon') {
      setSchedules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      let items: EnrichedScheduleItem[] = [];
      if (activeTab === 'up_next') {
        const res = await fetch(`/api/schedule/up-next?timezone=${encodeURIComponent(timezone)}`);
        if (!res.ok) throw new Error(String(res.status));
        items = (await res.json()).data || [];
      } else {
        const base = new URLSearchParams({ timezone, library: libraryOnly ? 'true' : 'false', limit: String(PAGE_SIZE) });
        if (activeTab === 'upcoming') {
          const from = new Date();
          const to = new Date(from);
          to.setDate(to.getDate() + 90);
          base.set('from', from.toISOString());
          base.set('to', to.toISOString());
        } else {
          base.set('date', activeTab);
        }
        if (statusFilter !== 'ALL') base.set('status', statusFilter);
        // Follow pagination so a busy week is never silently cut short.
        for (let page = 1; page <= MAX_PAGES; page++) {
          base.set('page', String(page));
          const res = await fetch(`/api/schedule?${base.toString()}`);
          if (!res.ok) throw new Error(String(res.status));
          const json = await res.json();
          items = items.concat(json.data || json.schedule || []);
          if (!json.meta?.hasNextPage) break;
        }
      }
      items.sort((a, b) => a.airingAtUtc.localeCompare(b.airingAtUtc));
      setSchedules(items);
      const remMap: Record<string, boolean> = {};
      items.forEach((it) => {
        if (it.hasReminder) remMap[it.id] = true;
      });
      setReminders(remMap);
    } catch (err) {
      console.error('Failed to load schedule:', err);
      setLoadError(true);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, timezone, libraryOnly, statusFilter]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  const handleToggleReminder = async (scheduleId: string) => {
    try {
      const res = await fetch('/api/schedule/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId }),
      });
      if (res.ok) {
        const data = await res.json();
        setReminders((prev) => ({ ...prev, [scheduleId]: !!data.active }));
      }
    } catch (err) {
      console.error('Failed to toggle reminder:', err);
    }
  };

  const todayKey = dateKeyIn(timezone, new Date(now));

  const visible = useMemo(
    () =>
      schedules.filter((item) => {
        if (streamingOnly && !(item.streaming && item.streaming.length > 0)) return false;
        if (activeTab === 'this_week' && selectedDate !== 'all' && item.localDate !== selectedDate) return false;
        return true;
      }),
    [schedules, streamingOnly, activeTab, selectedDate]
  );

  // Day strip for "This Week": every date that actually has episodes.
  const dayStrip = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of schedules) counts.set(item.localDate, (counts.get(item.localDate) || 0) + 1);
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [schedules]);

  const groups = useMemo(() => {
    const map = new Map<string, EnrichedScheduleItem[]>();
    for (const item of visible) {
      const list = map.get(item.localDate) || [];
      list.push(item);
      map.set(item.localDate, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const tzLabel = COMMON_TIMEZONES.find((tz) => tz.value === timezone)?.label || timezone;
  const airingNowCount = visible.filter((i) => liveStatus(i, now) === 'airing').length;
  const streamableCount = visible.filter((i) => i.streaming && i.streaming.length > 0).length;

  return (
    <div className={styles.schedulePage}>
      <header className={styles.hero}>
        <p className={styles.kicker}>Release schedule</p>
        <h1 className={styles.title}>What&apos;s airing</h1>
        {!loading && visible.length > 0 && (
          <div className={styles.heroStats} aria-live="polite">
            <span className={styles.statPill}>
              <Calendar size={14} aria-hidden="true" /> {visible.length} {visible.length === 1 ? 'episode' : 'episodes'}
            </span>
            {airingNowCount > 0 && (
              <span className={`${styles.statPill} ${styles.statLive}`}>
                <span className={styles.liveDot} aria-hidden="true" /> {airingNowCount} airing now
              </span>
            )}
            <span className={styles.statPill}>
              <Tv size={14} aria-hidden="true" /> {streamableCount} with streaming links
            </span>
          </div>
        )}
      </header>

      <div className={styles.controlsBar}>
        <div className={styles.presetTabs} role="tablist" aria-label="Schedule range">
          {PRESET_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`${styles.presetBtn} ${activeTab === tab.key ? styles.presetBtnActive : ''}`}
              onClick={() => {
                setActiveTab(tab.key);
                setSelectedDate('all');
              }}
            >
              {tab.key === 'up_next' && <Sparkles size={13} aria-hidden="true" />}
              {tab.label}
            </button>
          ))}
        </div>

        <label className={styles.tzWrapper}>
          <Globe size={14} aria-hidden="true" />
          <span className={styles.srOnly}>Time zone</span>
          <select className={styles.tzSelect} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
            {!COMMON_TIMEZONES.some((tz) => tz.value === timezone) && <option value={timezone}>{timezone}</option>}
          </select>
        </label>
      </div>

      {activeTab === 'this_week' && dayStrip.length > 1 && (
        <div className={styles.dayStrip} role="tablist" aria-label="Day">
          <button
            type="button"
            className={`${styles.dayChip} ${selectedDate === 'all' ? styles.dayChipActive : ''}`}
            onClick={() => setSelectedDate('all')}
          >
            <span className={styles.dayChipTop}>All</span>
            <span className={styles.dayChipBottom}>Week</span>
            <span className={styles.dayChipCount}>{schedules.length} episodes</span>
          </button>
          {dayStrip.map(([key, count]) => {
            const label = formatDayLabel(key, todayKey);
            return (
              <button
                key={key}
                type="button"
                className={`${styles.dayChip} ${selectedDate === key ? styles.dayChipActive : ''} ${key === todayKey ? styles.dayChipToday : ''}`}
                onClick={() => setSelectedDate(key)}
              >
                <span className={styles.dayChipTop}>{label.relative || label.weekday}</span>
                <span className={styles.dayChipBottom}>
                  {label.relative ? `${label.weekday} ${label.dayOfMonth}` : label.dayOfMonth}
                </span>
                <span className={styles.dayChipCount}>
                  {count} {count === 1 ? 'episode' : 'episodes'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {activeTab === 'coming_soon' ? (
        <ComingSoon />
      ) : (
      <>
      <div className={styles.filterBar}>
        {activeTab !== 'this_week' && activeTab !== 'up_next' && (
          <div className={styles.statusChips}>
            {['ALL', 'UPCOMING', 'AIRING', 'RELEASED', 'DELAYED'].map((st) => (
              <button
                key={st}
                type="button"
                className={`${styles.chip} ${statusFilter === st ? styles.chipActive : ''}`}
                onClick={() => setStatusFilter(st)}
              >
                {st === 'ALL' ? 'All releases' : st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        )}
        <div className={styles.toggles}>
          <button
            type="button"
            aria-pressed={streamingOnly}
            className={`${styles.chip} ${streamingOnly ? styles.chipActive : ''}`}
            onClick={() => setStreamingOnly((v) => !v)}
          >
            <Tv size={13} aria-hidden="true" /> Has streaming link
          </button>
          {activeTab !== 'up_next' && (
            <button
              type="button"
              aria-pressed={libraryOnly}
              className={`${styles.chip} ${libraryOnly ? styles.chipActive : ''}`}
              onClick={() => setLibraryOnly((v) => !v)}
            >
              <Check size={13} aria-hidden="true" /> In my library
            </button>
          )}
        </div>
      </div>

      <p className={styles.tzNote}>
        Times in <strong>{tzLabel}</strong>. Streaming listings come from AniList; availability varies by region.
      </p>

      {loading ? (
        <div className={styles.skeletonList} aria-label="Loading schedule">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.skeletonRow} />
          ))}
        </div>
      ) : loadError ? (
        <div className={styles.emptyState} role="alert">
          <AlertCircle size={32} aria-hidden="true" />
          <h3>Couldn&apos;t load the schedule</h3>
          <p>Check your connection and try again.</p>
          <button type="button" className={styles.emptyBtn} onClick={() => loadSchedule()}>
            Retry
          </button>
        </div>
      ) : groups.length > 0 ? (
        <div className={styles.days}>
          {groups.map(([dateKey, items]) => {
            const label = formatDayLabel(dateKey, todayKey);
            const isToday = dateKey === todayKey;
            const firstUpcomingIdx = isToday ? items.findIndex((i) => liveStatus(i, now) === 'upcoming') : -1;
            return (
              <section key={dateKey} className={styles.dayGroup} aria-label={label.full}>
                <h2 className={styles.dayHeader}>
                  {label.relative && <span className={styles.dayRelative}>{label.relative}</span>}
                  <span className={styles.dayFull}>{label.full}</span>
                  <span className={styles.dayCount}>
                    {items.length} {items.length === 1 ? 'episode' : 'episodes'}
                  </span>
                </h2>

                <ol className={styles.timeline}>
                  {items.map((item, idx) => {
                    const status = liveStatus(item, now);
                    const inLibrary = Boolean(item.inLibrary || library[item.animeId]);
                    const hasRem = !!reminders[item.id];
                    const at = new Date(item.airingAtUtc).getTime();
                    const streaming = item.streaming || [];
                    return (
                      <React.Fragment key={item.id}>
                        {idx === firstUpcomingIdx && (
                          <li className={styles.nowMarker} aria-label="Now">
                            <span>Now</span>
                          </li>
                        )}
                        <li className={`${styles.row} ${status === 'aired' ? styles.rowPast : ''} ${status === 'airing' ? styles.rowLive : ''}`}>
                          <div className={styles.timeCol}>
                            <time className={styles.time} dateTime={item.airingAtUtc}>
                              {item.localTime12h || item.localTime}
                            </time>
                            {item.originalTime && <span className={styles.origTime}>JP {item.originalTime.replace(/\s*\(Tokyo\)/, '')}</span>}
                          </div>
                          <span className={styles.dot} aria-hidden="true" />

                          <article className={styles.card}>
                            <Link href={`/anime/${item.slug || item.animeId}`} className={styles.posterWrap} tabIndex={-1} aria-hidden="true">
                              <AnimeImage src={item.posterImage} alt="" fill sizes="72px" />
                            </Link>

                            <div className={styles.cardBody}>
                              <div className={styles.cardTop}>
                                <span
                                  className={`${styles.statusPill} ${
                                    status === 'airing'
                                      ? styles.pillLive
                                      : status === 'upcoming'
                                      ? styles.pillUpcoming
                                      : status === 'delayed'
                                      ? styles.pillDelayed
                                      : status === 'cancelled'
                                      ? styles.pillCancelled
                                      : styles.pillAired
                                  }`}
                                >
                                  {status === 'airing' && <Radio size={11} aria-hidden="true" />}
                                  {status === 'airing'
                                    ? 'Airing now'
                                    : status === 'delayed'
                                    ? 'Delayed'
                                    : status === 'cancelled'
                                    ? 'Cancelled'
                                    : Number.isNaN(at)
                                    ? item.relativeTimeText
                                    : status === 'upcoming'
                                    ? formatCountdown(at - now)
                                    : `Aired ${formatCountdown(at - now)}`}
                                </span>
                                <span className={styles.episodeLabel}>Episode {item.episode}</span>
                                {item.format && <span className={styles.metaDim}>{item.format}</span>}
                              </div>

                              <Link href={`/anime/${item.slug || item.animeId}`} className={styles.cardTitle} title={item.title}>
                                {item.title}
                              </Link>
                              {item.episodeTitle && !/^Episode \d+$/.test(item.episodeTitle) && (
                                <p className={styles.episodeTitle}>{item.episodeTitle}</p>
                              )}
                              {status === 'delayed' && item.delayReason && (
                                <p className={styles.delayNote}>
                                  <AlertCircle size={12} aria-hidden="true" /> {item.delayReason}
                                </p>
                              )}

                              <div className={styles.streamRow}>
                                {streaming.length > 0 ? (
                                  <>
                                    <span className={styles.streamLabel}>Watch on</span>
                                    {streaming.slice(0, 3).map((s) => (
                                      <a
                                        key={s.name}
                                        href={s.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={styles.streamChip}
                                        style={{ '--brand': streamingBrandColor(s.name) } as React.CSSProperties}
                                        aria-label={`Watch ${item.title} on ${s.name} (opens in a new tab)`}
                                      >
                                        <span className={styles.brandDot} aria-hidden="true" />
                                        {s.name}
                                        <ExternalLink size={11} aria-hidden="true" className={styles.streamIcon} />
                                      </a>
                                    ))}
                                    {streaming.length > 3 && (
                                      <Link href={`/anime/${item.slug || item.animeId}`} className={styles.streamMore}>
                                        +{streaming.length - 3} more
                                      </Link>
                                    )}
                                  </>
                                ) : (
                                  <span className={styles.streamNone}>No official streaming listed yet</span>
                                )}
                              </div>
                            </div>

                            <div className={styles.actions}>
                              <button
                                type="button"
                                aria-label={hasRem ? 'Remove reminder' : 'Remind me when it airs'}
                                aria-pressed={hasRem}
                                title={hasRem ? 'Reminder set' : 'Remind me'}
                                className={`${styles.iconBtn} ${hasRem ? styles.iconBtnActive : ''}`}
                                onClick={() => handleToggleReminder(item.id)}
                              >
                                <Bell size={15} fill={hasRem ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                type="button"
                                aria-pressed={inLibrary}
                                className={`${styles.trackBtn} ${inLibrary ? styles.trackBtnActive : ''}`}
                                onClick={() => updateStatus(item.slug || item.animeId, inLibrary ? 'plan_to_watch' : 'watching')}
                              >
                                {inLibrary ? <Check size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
                                <span>{inLibrary ? 'Tracking' : 'Track'}</span>
                              </button>
                            </div>
                          </article>
                        </li>
                      </React.Fragment>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          {activeTab === 'up_next' ? (
            <>
              <Sparkles size={32} aria-hidden="true" />
              <h3>Nothing coming up from your library</h3>
              <p>Add anime to &quot;Watching&quot; or &quot;Plan to Watch&quot; to see their next episodes here.</p>
            </>
          ) : streamingOnly && schedules.length > 0 ? (
            <>
              <Tv size={32} aria-hidden="true" />
              <h3>No streaming links for these episodes yet</h3>
              <p>Turn off &quot;Has streaming link&quot; to see every episode.</p>
              <button type="button" className={styles.emptyBtn} onClick={() => setStreamingOnly(false)}>
                Show all episodes
              </button>
            </>
          ) : (
            <>
              <Calendar size={32} aria-hidden="true" />
              <h3>
                {activeTab === 'today' ? 'Nothing confirmed for today' : activeTab === 'tomorrow' ? 'Nothing confirmed for tomorrow' : 'No episodes scheduled'}
              </h3>
              <p>We only list an episode once its air time is confirmed. Try a wider range.</p>
              <div className={styles.emptyActions}>
                <button type="button" className={styles.emptyBtn} onClick={() => { setActiveTab('this_week'); setSelectedDate('all'); }}>
                  This Week
                </button>
                <button type="button" className={styles.emptyBtn} onClick={() => { setActiveTab('upcoming'); setSelectedDate('all'); }}>
                  Next 90 Days
                </button>
              </div>
            </>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
