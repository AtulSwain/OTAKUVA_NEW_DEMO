'use client';

import React, { useEffect, useState } from 'react';
import { notifyCommunityScoresChanged } from '../../lib/rating/useCommunityScore';
import { ChevronLeft, ChevronRight, Star, Trash2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { promptPhoneVerification } from '../auth/VerifyPhonePrompt';
import { retentionColor, retentionLabel } from '../../lib/rating/retentionTone';
import { RETENTION_MAX, RETENTION_MIN } from '../../lib/rating/retentionScore';
import { RetentionSegments } from './RetentionSegments';
import type { RetentionBadgeKey, RetentionStatus } from '../../lib/rating/retentionScore';
import styles from './RatingModal.module.css';
import own from './EpisodeRetentionModal.module.css';

/** What GET /api/anime/:id/episode-ratings returns that this window needs. */
export interface EpisodeRetentionSummary {
  released: number;
  isOpen?: boolean;
  next?: { number: number; airingAt: string } | null;
  /** Declared episode total, when known. */
  total?: number | null;
  /** Still airing (new show or new season). */
  airing?: boolean;
  /** The anime's community retention (see retentionScore.ts). */
  retention?: {
    value: number | null;
    members: number;
    raw?: number | null;
    ratedEpisodes?: number;
    totalRatings?: number;
    status?: RetentionStatus;
    badge?: RetentionBadgeKey | null;
    needs?: { raters: number; ratedEpisodes: number };
  };
  myRetention?: { value: number | null; episodes: number };
  episodes: { number: number; title: string | null; airedAt?: string | null; retention: number | null; retentionCount: number }[];
  mine: Record<number, { retention: number | null; note?: string | null }>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  animeId: string;
  animeTitle: string;
  /** The episode the member clicked in the episode guide. */
  episodeNumber: number | null;
  /** The member's rating of the whole anime, shown for context. */
  animeRating?: number | null;
  /** Opens the whole-anime rating window instead. */
  onRateAnime?: () => void;
  /** Called with the fresh summary after a save or removal. */
  onChanged?: (summary: EpisodeRetentionSummary) => void;
}

/**
 * Episode rating (2026-10-20): an episode is rated by retention — how much it
 * kept you hooked, 0–100% — separately from the anime's own score, which is
 * rated once in RatingModal. Same window design as RatingModal.
 */
export function EpisodeRetentionModal({ isOpen, onClose, animeId, animeTitle, episodeNumber, animeRating, onRateAnime, onChanged }: Props) {
  const { user, openAuthModal } = useAuth();
  const { showToast } = useToast();
  const [summary, setSummary] = useState<EpisodeRetentionSummary | null>(null);
  const [episode, setEpisode] = useState<number | null>(episodeNumber);
  const [retention, setRetention] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEpisode(episodeNumber);
      setError(null);
    }
  }, [isOpen, episodeNumber]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch(`/api/anime/${encodeURIComponent(animeId)}/episode-ratings`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: EpisodeRetentionSummary | null) => {
        if (!cancelled && data) setSummary(data);
      })
      .catch(() => {
        /* the form still works; community numbers just don't show */
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, animeId, user?.id]);

  // Switching episodes loads your retention for it (or a blank form).
  useEffect(() => {
    if (episode === null) return;
    setRetention(summary?.mine[episode]?.retention ?? null);
    setError(null);
  }, [episode, summary]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || episode === null) return null;

  const released = summary?.released ?? episode;
  const row = summary?.episodes.find((e) => e.number === episode) ?? null;
  const mineNow = summary?.mine[episode]?.retention ?? null;
  const myEpisodes = summary
    ? Object.entries(summary.mine)
        .filter(([, r]) => r.retention !== null)
        .map(([n, r]) => [Number(n), r.retention as number] as const)
        .sort((a, b) => a[0] - b[0])
    : [];

  const save = async () => {
    if (retention === null) {
      setError('Choose how much this episode kept you watching.');
      return;
    }
    if (!user) {
      onClose();
      openAuthModal('login');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/anime/${encodeURIComponent(animeId)}/episode-ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeNumber: episode, retention }),
      });
      const body = await res.json().catch(() => ({} as { error?: string; code?: string; summary?: EpisodeRetentionSummary }));
      if (!res.ok) {
        if (body.code === 'PHONE_NOT_VERIFIED') {
          onClose();
          promptPhoneVerification('rate');
          return;
        }
        throw new Error(body.error || 'Failed to save rating');
      }
      notifyCommunityScoresChanged();
      showToast(`Episode ${episode} retention ${retention}%`, 'success');
      if (body.summary) {
        setSummary(body.summary);
        onChanged?.(body.summary);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Unable to save rating. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/anime/${encodeURIComponent(animeId)}/episode-ratings?episodeNumber=${episode}&what=retention`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({} as { error?: string; summary?: EpisodeRetentionSummary }));
      if (!res.ok) throw new Error(body.error || 'Failed to remove rating');
      notifyCommunityScoresChanged();
      showToast(`Episode ${episode} rating removed`, 'info');
      if (body.summary) {
        setSummary(body.summary);
        onChanged?.(body.summary);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Unable to remove rating.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label={`Rate episode ${episode} of ${animeTitle}`}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleCol}>
            <span className={styles.kicker}>{animeTitle}</span>
            <h3 className={styles.animeTitle}>What&apos;s your opinion on episode {episode}?</h3>
            {row?.title && <span className={own.epTitle}>{row.title}</span>}
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Episode stepper */}
        {released > 1 && (
          <div className={own.stepper}>
            <button type="button" onClick={() => setEpisode(Math.max(1, episode - 1))} disabled={episode <= 1} aria-label="Previous episode">
              <ChevronLeft size={16} />
            </button>
            <span>
              Episode <strong>{episode}</strong> of {released}
            </span>
            <button type="button" onClick={() => setEpisode(Math.min(released, episode + 1))} disabled={episode >= released} aria-label="Next episode">
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Retention */}
        <div className={styles.scoreHero}>
          <div className={styles.scoreValueRow}>
            {retention !== null ? (
              <>
                <span className={styles.scoreBig} style={{ color: retentionColor(retention) }}>{retention}</span>
                <span className={styles.scoreMax}>%</span>
              </>
            ) : (
              <>
                <span className={styles.scorePlaceholder}>—</span>
                <span className={styles.scoreMax}>%</span>
              </>
            )}
          </div>
          <span className={styles.scoreLabel}>{retention !== null ? retentionLabel(retention).toUpperCase() : 'EPISODE RETENTION'}</span>
          <span className={styles.scoreHint}>How well did this episode keep you watching? Pick 1–100, then save.</span>
          {row && row.retentionCount > 0 && (
            <span className={own.community}>
              Community: <strong>{row.retention}%</strong> · {row.retentionCount} {row.retentionCount === 1 ? 'rating' : 'ratings'}
            </span>
          )}
        </div>

        <div className={styles.sliderSection}>
          <div className={styles.sliderControlsRow}>
            <button
              type="button"
              className={styles.stepperBtn}
              onClick={() => setRetention(Math.max(RETENTION_MIN, (retention ?? 50) - 1))}
              title="Decrease by 1"
              aria-label="Decrease by 1"
            >
              −1
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <RetentionSegments
                value={retention}
                onChange={setRetention}
                onEnter={save}
                size="md"
                label={`Episode ${episode} retention, 1 to 100`}
                color={retention !== null ? retentionColor(retention) : null}
              />
            </div>
            <button
              type="button"
              className={styles.stepperBtn}
              onClick={() => setRetention(Math.min(RETENTION_MAX, (retention ?? 50) + 1))}
              title="Increase by 1"
              aria-label="Increase by 1"
            >
              +1
            </button>
          </div>
          <div className={styles.sliderTicks}>
            <span>1</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
        </div>

        {/* The anime's own rating is separate — shown here for context. */}
        {onRateAnime && (
          <div className={own.animeRow}>
            <span>
              <Star size={13} aria-hidden="true" /> Your rating of the anime:{' '}
              <strong>{typeof animeRating === 'number' ? animeRating.toFixed(1) : 'not rated'}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onRateAnime();
              }}
            >
              {typeof animeRating === 'number' ? 'Change' : 'Rate the anime'}
            </button>
          </div>
        )}

        {/* Your episode retention so far */}
        {myEpisodes.length > 0 && (
          <div className={own.log}>
            <span className={own.logHead}>Your episode retention</span>
            <ul>
              {myEpisodes.map(([n, r]) => (
                <li key={n}>
                  <button type="button" className={`${own.logItem} ${n === episode ? own.logItemActive : ''}`} onClick={() => setEpisode(n)}>
                    Episode {n} <strong>{r}%</strong>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={styles.stickyBar}>
          {error && (
            <div className={styles.errorAlert} role="alert">
              {error}
            </div>
          )}
          <div className={styles.footer}>
            {mineNow !== null ? (
              <button type="button" className={styles.deleteBtn} onClick={remove} disabled={isSaving}>
                <Trash2 size={14} />
                <span>Remove</span>
              </button>
            ) : (
              <div />
            )}
            <div className={styles.actionRight}>
              <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={isSaving}>
                Cancel
              </button>
              <button type="button" className={styles.saveBtn} onClick={save} disabled={retention === null || isSaving}>
                {isSaving ? 'Saving...' : user ? `Save episode ${episode}` : 'Sign in to rate'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
