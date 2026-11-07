'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ThumbsUp,
  Flag,
  Edit3,
  AlertTriangle,
  Eye,
  ArrowUpDown,
  MessageCircle,
  Trash2,
  Pin,
  PinOff,
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { promptPhoneVerification } from '../auth/VerifyPhonePrompt';
import { ReportReviewModal } from '../review/ReportReviewModal';
import { UserAvatar } from '../ui/UserAvatar';
import BadgeChip from '../badges/BadgeChip';
import { isTierKey } from '../../lib/badges/tiers';
import { reviewTagLabel } from '../../lib/reviews/reviewTags';
import type { CommunityTag, ReplyItem } from '../../lib/reviews/reviewSocial';
import { retentionColor, retentionLabel, retentionSoftColor } from '../../lib/rating/retentionTone';
import styles from './AnimeReviewsCard.module.css';
import { Composer } from '../ui/Composer';
import { FollowButton } from '../social/FollowButton';

export interface ReviewItem {
  id: string;
  title?: string;
  body: string;
  rating?: number | null;
  /** The reviewer's own retention for this anime (their episode average). */
  retention?: number | null;
  spoilerLevel?: 'SPOILER_FREE' | 'MILD_SPOILERS' | 'SPOILERS' | 'FULL_SPOILERS';
  containsSpoiler?: boolean;
  watchStatusAtReview?: string | null;
  episodeProgressAtReview?: number | null;
  edited?: boolean;
  likesCount?: number;
  overallSentiment?: string;
  createdAt?: string;
  updatedAt?: string;
  userLiked?: boolean;
  isOwnReview?: boolean;
  /** Published by a creator account (stamped by the server). */
  isCreatorReview?: boolean;
  /** Set when a moderator pinned it to the top of the anime's reviews. */
  pinnedAt?: string | null;
  tags?: string[];
  replyCount?: number;
  replies?: ReplyItem[];
  user?: {
    id: string;
    username: string;
    avatarUrl?: string | null;
    /** Reviewer's current badge tier (not the tier when the review was written). */
    badge?: { tier: string; count: number };
    /** The viewer already follows this reviewer. */
    followedByViewer?: boolean;
  };
  anime?: {
    id: string;
    slug?: string;
    title?: string;
    canonicalTitle?: string;
    posterImage?: string | null;
  };
  aspects?: Array<{ aspect: string; sentiment: string; sentimentScore: number; confidence: number }>;
}

interface AnimeReviewsCardProps {
  animeId?: string;
  animeTitle?: string;
  reviews?: ReviewItem[];
  userReview?: ReviewItem | null;
  /** Reviews pinned to the top by a moderator. */
  pinned?: ReviewItem[];
  /** The viewer may pin/unpin (moderators and admins). */
  canPin?: boolean;
  communityTags?: CommunityTag[];
  /** Opens the full review window (headline, tags, spoiler level). */
  onWriteReview?: () => void;
  onEditReview?: (review: ReviewItem) => void;
  onReviewsChanged?: () => void;
}

const REVIEW_MIN = 20;
const REVIEW_MAX = 5000;

/** "2 days ago" / "Oct 12, 2026" — fixed locale so server and browser agree. */
function timeAgo(raw?: string) {
  if (!raw) return '';
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The reviewer's verdict: their own retention band ("Hooked", "Peaking"…), as a pill. */
function Verdict({ retention }: { retention?: number | null }) {
  if (typeof retention !== 'number') return null;
  return (
    <span
      className={styles.verdict}
      style={{ color: retentionColor(retention), background: retentionSoftColor(retention) }}
      title={`This reviewer's retention for the anime: ${retention}%`}
    >
      {retentionLabel(retention)}
    </span>
  );
}

/** Small spoiler tag that sits right after the name. */
function SpoilerTag({ level }: { level?: string }) {
  if (!level || level === 'SPOILER_FREE') return <span className={`${styles.tag} ${styles.tagSafe}`}>Spoiler-free</span>;
  const label = level === 'FULL_SPOILERS' ? 'Major spoilers' : level === 'MILD_SPOILERS' ? 'Mild spoilers' : 'Spoilers';
  return <span className={`${styles.tag} ${styles.tagSpoiler}`}>{label}</span>;
}

/**
 * The "Write a Review" card — used for a new review and, in place of the
 * review itself, for editing your own (owner, 2026-10-25: the edit window is
 * the same design as writing). Plain text box with the browser's spelling
 * correction, character count, "Contains spoilers", Post / Save.
 */
function ReviewWriteCard({
  mode,
  user,
  animeTitle,
  initialBody = '',
  initialSpoiler = false,
  submitting,
  onSubmit,
  onCancel,
  onDelete,
  onMoreOptions,
  onNeedLogin,
}: {
  mode: 'new' | 'edit';
  user: { username: string; avatarUrl?: string | null } | null;
  animeTitle: string;
  initialBody?: string;
  initialSpoiler?: boolean;
  submitting: boolean;
  onSubmit: (body: string, hasSpoilers: boolean) => Promise<boolean>;
  onCancel?: () => void;
  onDelete?: () => void;
  onMoreOptions?: () => void;
  onNeedLogin: () => void;
}) {
  const [draft, setDraft] = useState(initialBody);
  const [hasSpoilers, setHasSpoilers] = useState(initialSpoiler);
  const tooShort = draft.trim().length < REVIEW_MIN;
  const unchanged = mode === 'edit' && draft.trim() === initialBody.trim() && hasSpoilers === initialSpoiler;

  const submit = async () => {
    if (!user) return onNeedLogin();
    if (tooShort || submitting || unchanged) return;
    const ok = await onSubmit(draft.trim(), hasSpoilers);
    if (ok && mode === 'new') {
      setDraft('');
      setHasSpoilers(false);
    }
  };

  return (
    <div className={`${styles.writeCard} ${mode === 'edit' ? styles.writeCardEdit : ''}`}>
      <div className={styles.writeWho}>
        {user ? <UserAvatar username={user.username} avatarUrl={user.avatarUrl} size={44} /> : <span className={styles.writeAnon} aria-hidden="true" />}
        <span className={styles.writeName}>{user ? `@${user.username}` : 'Sign in to write a review'}</span>
        {mode === 'edit' && <span className={styles.editingMark}>Editing your review</span>}
      </div>
      <div className={styles.writeBox}>
        <textarea
          className={styles.writeInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, REVIEW_MAX))}
          onFocus={() => {
            if (!user) onNeedLogin();
          }}
          placeholder={`What did you think of ${animeTitle}?`}
          rows={mode === 'edit' ? 5 : 3}
          maxLength={REVIEW_MAX}
          spellCheck
          autoCorrect="on"
          autoCapitalize="sentences"
          lang="en"
          aria-label={mode === 'edit' ? 'Edit your review' : 'Your review'}
          autoFocus={mode === 'edit'}
        />
        <span className={styles.writeCount}>
          {draft.length}/{REVIEW_MAX}
        </span>
      </div>
      <div className={styles.writeFoot}>
        <label className={styles.check}>
          <input type="checkbox" checked={hasSpoilers} onChange={(e) => setHasSpoilers(e.target.checked)} />
          <span className={styles.checkBox} aria-hidden="true" />
          Contains spoilers
        </label>
        <div className={styles.writeActions}>
          {onDelete && (
            <button type="button" className={styles.deleteLink} onClick={onDelete} disabled={submitting}>
              <Trash2 size={13} aria-hidden="true" /> Delete
            </button>
          )}
          {onMoreOptions && user && (
            <button type="button" className={styles.moreOptions} onClick={onMoreOptions}>
              <SlidersHorizontal size={13} aria-hidden="true" /> More options
            </button>
          )}
          {onCancel && (
            <button type="button" className={styles.cancel} onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
          )}
          <button type="button" className={styles.post} onClick={submit} disabled={submitting || (Boolean(user) && (tooShort || unchanged))}>
            {submitting ? (mode === 'edit' ? 'Saving…' : 'Posting…') : mode === 'edit' ? 'Save' : 'Post'}
          </button>
        </div>
      </div>
      {user && draft.length > 0 && tooShort && <p className={styles.writeHint}>{REVIEW_MIN - draft.trim().length} more characters to post</p>}
    </div>
  );
}

/**
 * Reviews on the anime page (redesigned 2026-10-25, owner; modelled on a
 * reference app): a "Write a Review" card (avatar, @username, a plain text
 * box with the browser's spelling correction, spoiler switch, Post), then
 * "User Reviews" with sort + Show spoilers + Creators only. Each review:
 * avatar, name, then the Spoiler-free/Spoilers tag and the reviewer's
 * verdict pill (their retention band) — no spoiler line above the name any
 * more. Replies are collapsed behind "View N replies"; a reply's author sees
 * "You" and can delete it. The full review window (headline, tags) is one
 * tap away ("More options").
 */
export const AnimeReviewsCard: React.FC<AnimeReviewsCardProps> = ({
  animeId,
  animeTitle = 'this anime',
  reviews = [],
  userReview = null,
  pinned = [],
  canPin = false,
  communityTags = [],
  onWriteReview,
  onEditReview,
  onReviewsChanged,
}) => {
  const { user, openAuthModal } = useAuth();
  const { showToast } = useToast();

  // Write a Review / edit your own in place
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // List controls
  const [sortBy, setSortBy] = useState<'RECOMMENDED' | 'HELPFUL' | 'NEWEST'>('RECOMMENDED');
  const [showSpoilers, setShowSpoilers] = useState(false);
  const [creatorsOnly, setCreatorsOnly] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  // Follow taps on review cards, by username, so every review by the same
  // person updates together.
  const [followOverrides, setFollowOverrides] = useState<Record<string, boolean>>({});

  const [likeStates, setLikeStates] = useState<Record<string, { count: number; liked: boolean }>>({});
  const [reportingReview, setReportingReview] = useState<{ id: string; title: string } | null>(null);

  // Replies, per review
  const [replyState, setReplyState] = useState<Record<string, { replies: ReplyItem[]; count: number }>>({});
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set());
  const [openComposer, setOpenComposer] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [postingReply, setPostingReply] = useState(false);
  const [loadingAll, setLoadingAll] = useState<string | null>(null);

  const repliesFor = (r: ReviewItem) => replyState[r.id] ?? { replies: r.replies ?? [], count: r.replyCount ?? 0 };

  /* ── Write a Review ── */
  const postReview = async (body: string, hasSpoilers: boolean): Promise<boolean> => {
    if (!animeId || posting) return false;
    setPosting(true);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animeId, body, spoilerLevel: hasSpoilers ? 'SPOILERS' : 'SPOILER_FREE' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'PHONE_NOT_VERIFIED') {
          promptPhoneVerification('review');
          return false;
        }
        throw new Error(data.error || 'Could not post your review.');
      }
      showToast('Your review is posted', 'success');
      onReviewsChanged?.();
      return true;
    } catch (err) {
      showToast((err as Error).message, 'error');
      return false;
    } finally {
      setPosting(false);
    }
  };

  /* ── Edit / delete your own review, in place ── */
  const saveEdit = async (rev: ReviewItem, body: string, hasSpoilers: boolean): Promise<boolean> => {
    if (posting) return false;
    setPosting(true);
    try {
      // Keep a stronger spoiler level the review already had.
      const keepLevel = rev.spoilerLevel && rev.spoilerLevel !== 'SPOILER_FREE' ? rev.spoilerLevel : 'SPOILERS';
      const res = await fetch(`/api/reviews/${rev.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, spoilerLevel: hasSpoilers ? keepLevel : 'SPOILER_FREE' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save your review.');
      showToast('Review updated', 'success');
      setEditingId(null);
      onReviewsChanged?.();
      return true;
    } catch (err) {
      showToast((err as Error).message, 'error');
      return false;
    } finally {
      setPosting(false);
    }
  };

  const deleteOwn = async (rev: ReviewItem) => {
    if (!confirm("Delete your review? This can't be undone.")) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/reviews/${rev.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not delete your review.');
      showToast('Review deleted', 'info');
      setEditingId(null);
      onReviewsChanged?.();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setPosting(false);
    }
  };

  /* ── Helpful ── */
  const handleHelpfulToggle = async (rev: ReviewItem) => {
    if (!user) return showToast('Please sign in to vote on reviews', 'info');
    const current = likeStates[rev.id] ?? { count: rev.likesCount || 0, liked: Boolean(rev.userLiked) };
    const next = { count: Math.max(0, current.count + (current.liked ? -1 : 1)), liked: !current.liked };
    setLikeStates((prev) => ({ ...prev, [rev.id]: next }));
    try {
      const res = await fetch(`/api/reviews/${rev.id}/helpful`, { method: 'POST' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (typeof data.likesCount === 'number') {
        setLikeStates((prev) => ({ ...prev, [rev.id]: { count: data.likesCount, liked: data.userLiked ?? next.liked } }));
      }
    } catch {
      setLikeStates((prev) => ({ ...prev, [rev.id]: current }));
      showToast('Failed to update vote', 'error');
    }
  };

  /* ── Replies ── */
  const loadAllReplies = async (reviewId: string) => {
    setLoadingAll(reviewId);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/replies`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setReplyState((prev) => ({ ...prev, [reviewId]: { replies: data.replies, count: data.replies.length } }));
    } catch {
      showToast('Could not load replies', 'error');
    } finally {
      setLoadingAll(null);
    }
  };

  const toggleThread = (rev: ReviewItem) => {
    const open = openThreads.has(rev.id);
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (open) next.delete(rev.id);
      else next.add(rev.id);
      return next;
    });
    if (!open) {
      const { replies, count } = repliesFor(rev);
      if (count > replies.length) loadAllReplies(rev.id);
    }
  };

  const startReply = (rev: ReviewItem) => {
    if (!user) return openAuthModal('login');
    setOpenThreads((prev) => new Set(prev).add(rev.id));
    setOpenComposer((cur) => (cur === rev.id ? null : rev.id));
    setReplyDraft('');
  };

  const postReply = async (rev: ReviewItem) => {
    const body = replyDraft.trim();
    if (!body || postingReply) return;
    setPostingReply(true);
    try {
      const res = await fetch(`/api/reviews/${rev.id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not post reply');
      const cur = repliesFor(rev);
      setReplyState((prev) => ({ ...prev, [rev.id]: { replies: [...cur.replies, data.reply], count: cur.count + 1 } }));
      setReplyDraft('');
      setOpenComposer(null);
    } catch (err: any) {
      showToast(err.message || 'Could not post reply', 'error');
    } finally {
      setPostingReply(false);
    }
  };

  const removeReply = async (rev: ReviewItem, replyId: string) => {
    if (!confirm('Delete this reply?')) return;
    try {
      const res = await fetch(`/api/reviews/${rev.id}/replies/${replyId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      const cur = repliesFor(rev);
      setReplyState((prev) => ({ ...prev, [rev.id]: { replies: cur.replies.filter((r) => r.id !== replyId), count: Math.max(0, cur.count - 1) } }));
    } catch {
      showToast('Could not delete reply', 'error');
    }
  };

  /* ── Pin (moderators) ── */
  const [pinBusy, setPinBusy] = useState<string | null>(null);
  const togglePin = async (rev: ReviewItem) => {
    if (pinBusy) return;
    setPinBusy(rev.id);
    try {
      const res = await fetch(`/api/reviews/${rev.id}/pin`, { method: rev.pinnedAt ? 'DELETE' : 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update the pin.');
      showToast(rev.pinnedAt ? 'Review unpinned' : 'Review pinned to the top', 'success');
      onReviewsChanged?.();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setPinBusy(null);
    }
  };

  /* ── List ── */
  const pinnedIds = new Set(pinned.map((r) => r.id));
  const ownPinned = Boolean(userReview && pinnedIds.has(userReview.id));
  const communityReviews = reviews.filter((r) => !pinnedIds.has(r.id) && (!userReview || r.id !== userReview.id));
  const filtered = communityReviews.filter((r) => !creatorsOnly || r.isCreatorReview);
  const sorted = [...filtered].sort((a, b) => {
    const likes = (r: ReviewItem) => likeStates[r.id]?.count ?? r.likesCount ?? 0;
    const time = (r: ReviewItem) => (r.createdAt ? new Date(r.createdAt).getTime() : 0);
    if (sortBy === 'HELPFUL') return likes(b) - likes(a);
    if (sortBy === 'NEWEST') return time(b) - time(a);
    // Recommended: creator reviews first (owner, 2026-10-24), then likes, then recency.
    if (Boolean(a.isCreatorReview) !== Boolean(b.isCreatorReview)) return a.isCreatorReview ? -1 : 1;
    return likes(b) - likes(a) || time(b) - time(a);
  });
  const total = pinned.length + (userReview && !ownPinned ? 1 : 0) + communityReviews.length;

  /* ── One reply thread ── */
  const renderThread = (rev: ReviewItem) => {
    if (!openThreads.has(rev.id)) return null;
    const { replies, count } = repliesFor(rev);
    const author = rev.user?.username || 'member';
    return (
      <div className={styles.thread}>
        {replies.map((rp) => {
          const mine = Boolean(user && rp.user.username === user.username);
          return (
            <div key={rp.id} className={`${styles.reply} ${mine ? styles.replyMine : ''}`}>
              <UserAvatar username={rp.user.username} avatarUrl={rp.user.avatarUrl} size={28} />
              <div className={styles.replyMain}>
                <div className={styles.replyHead}>
                  <Link href={`/profile/${encodeURIComponent(rp.user.username)}`} className={styles.replyName}>
                    {rp.user.username}
                  </Link>
                  {mine && <span className={styles.youMark}>You</span>}
                  <span className={styles.replyTime}>{timeAgo(rp.createdAt)}</span>
                  {rp.canDelete && (
                    <button type="button" className={styles.replyDelete} onClick={() => removeReply(rev, rp.id)} aria-label="Delete reply" title="Delete reply">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p className={styles.replyBody}>{rp.body}</p>
              </div>
            </div>
          );
        })}
        {loadingAll === rev.id && <p className={styles.threadNote}>Loading replies…</p>}
        {replies.length === 0 && loadingAll !== rev.id && openComposer !== rev.id && <p className={styles.threadNote}>No replies yet.</p>}

        {openComposer === rev.id ? (
          <div className={styles.replyForm}>
            <Composer
              value={replyDraft}
              onChange={(v) => setReplyDraft(v.slice(0, 1000))}
              onSubmit={() => postReply(rev)}
              onCancel={() => {
                setReplyDraft('');
                setOpenComposer(null);
              }}
              submitting={postingReply}
              submitLabel="Reply"
              maxLength={1000}
              placeholder={`Reply to ${author}…`}
              replyingTo={author}
              autoFocus
              compact
            />
          </div>
        ) : (
          <button type="button" className={styles.threadReply} onClick={() => startReply(rev)}>
            <MessageCircle size={13} aria-hidden="true" /> Write a reply
          </button>
        )}
        {count > replies.length && loadingAll !== rev.id && (
          <button type="button" className={styles.threadMore} onClick={() => loadAllReplies(rev.id)}>
            Load all {count} replies
          </button>
        )}
      </div>
    );
  };

  /* ── One review ── */
  const renderReview = (rev: ReviewItem, own: boolean) => {
    const username = rev.user?.username || user?.username || 'member';
    const avatarUrl = rev.user?.avatarUrl ?? (own ? user?.avatarUrl : null);
    const isSpoiler = !own && rev.spoilerLevel && rev.spoilerLevel !== 'SPOILER_FREE';
    const hidden = isSpoiler && !showSpoilers && !revealedIds.has(rev.id);
    const like = likeStates[rev.id] ?? { count: rev.likesCount || 0, liked: Boolean(rev.userLiked) };
    const replyCount = repliesFor(rev).count;
    const threadOpen = openThreads.has(rev.id);

    if (own && editingId === rev.id) {
      return (
        <article key={rev.id} id={`review-${rev.id}`} className={styles.reviewEditing}>
          <ReviewWriteCard
            mode="edit"
            user={user ? { username: user.username, avatarUrl: user.avatarUrl } : null}
            animeTitle={animeTitle}
            initialBody={rev.body}
            initialSpoiler={Boolean(rev.spoilerLevel && rev.spoilerLevel !== 'SPOILER_FREE')}
            submitting={posting}
            onSubmit={(body, spoiler) => saveEdit(rev, body, spoiler)}
            onCancel={() => setEditingId(null)}
            onDelete={() => deleteOwn(rev)}
            onMoreOptions={onEditReview ? () => onEditReview(rev) : undefined}
            onNeedLogin={() => openAuthModal('login')}
          />
        </article>
      );
    }

    return (
      <article
        key={rev.id}
        id={`review-${rev.id}`}
        className={`${styles.review} ${rev.pinnedAt ? styles.reviewPinned : ''} ${rev.isCreatorReview ? styles.reviewCreator : ''}`}
      >
        {/* Flat on the page (owner, 2026-10-26): no bubble, outline or border. */}
        <UserAvatar username={username} avatarUrl={avatarUrl} size={40} />
        <div className={styles.reviewMain}>
          <div className={styles.bubble}>
            <header className={styles.reviewHead}>
              <div className={styles.who}>
                <div className={styles.nameRow}>
                  <Link href={`/profile/${encodeURIComponent(username)}`} className={styles.name}>
                    {username}
                  </Link>
                  {rev.isCreatorReview && <BadgeCheck size={16} className={styles.creatorCheck} aria-label="Creator" />}
                  {rev.user?.badge && isTierKey(rev.user.badge.tier) && <BadgeChip tier={rev.user.badge.tier} count={rev.user.badge.count} />}
                  {/* One line (owner, 2026-10-26): name · retention · spoiler tag. */}
                  <Verdict retention={rev.retention} />
                  <SpoilerTag level={rev.spoilerLevel} />
                  {own && <span className={styles.youMark}>Your review</span>}
                  {/* Follow the reviewer right from their review (2026-11-06). */}
                  {!own && rev.user?.username && user?.username !== rev.user.username && (
                    <span className={styles.followSlot}>
                      <FollowButton
                        username={rev.user.username}
                        size="sm"
                        following={followOverrides[rev.user.username] ?? Boolean(rev.user.followedByViewer)}
                        onChange={(next) => setFollowOverrides((m) => ({ ...m, [rev.user!.username]: next }))}
                      />
                    </span>
                  )}
                </div>
                <div className={styles.meta}>
                  {rev.pinnedAt && (
                    <span className={styles.pinned}>
                      <Pin size={11} aria-hidden="true" /> Pinned ·
                    </span>
                  )}
                  <span suppressHydrationWarning>{timeAgo(rev.createdAt)}</span>
                  {rev.edited && <span>· edited</span>}
                </div>
              </div>
            </header>

            {rev.isCreatorReview && rev.title && <h3 className={styles.headline}>{rev.title}</h3>}

            {hidden ? (
              <button type="button" className={styles.spoilerCover} onClick={() => setRevealedIds((prev) => new Set(prev).add(rev.id))}>
                <AlertTriangle size={15} aria-hidden="true" />
                <span>This review has spoilers — tap to read</span>
                <Eye size={14} aria-hidden="true" />
              </button>
            ) : (
              <p className={styles.body}>{rev.body}</p>
            )}

            {rev.tags && rev.tags.length > 0 && (
              <div className={styles.tags}>
                {rev.tags.map((t) => (
                  <span key={t} className={styles.tagChip}>
                    {reviewTagLabel(t)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <footer className={styles.actions}>
            {own ? (
              <span className={styles.action}>
                <ThumbsUp size={14} aria-hidden="true" /> {rev.likesCount || 0}
              </span>
            ) : (
              <button
                type="button"
                className={`${styles.action} ${like.liked ? styles.actionOn : ''}`}
                onClick={() => handleHelpfulToggle(rev)}
                aria-label={`Helpful (${like.count})`}
              >
                <ThumbsUp size={14} fill={like.liked ? 'currentColor' : 'none'} /> {like.count}
              </button>
            )}
            <button type="button" className={`${styles.action} ${threadOpen ? styles.actionOn : ''}`} onClick={() => (replyCount > 0 ? toggleThread(rev) : startReply(rev))} aria-expanded={threadOpen}>
              <MessageCircle size={14} aria-hidden="true" />
              {replyCount > 0 ? (
                <>
                  {threadOpen ? 'Hide replies' : `View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
                  {threadOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </>
              ) : (
                'Reply'
              )}
            </button>
            {own && (
              <button type="button" className={styles.action} onClick={() => setEditingId(rev.id)}>
                <Edit3 size={14} aria-hidden="true" /> Edit
              </button>
            )}
            {canPin && (
              <button type="button" className={styles.action} onClick={() => togglePin(rev)} disabled={pinBusy === rev.id}>
                {rev.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />} {rev.pinnedAt ? 'Unpin' : 'Pin'}
              </button>
            )}
            {!own && (
              <button
                type="button"
                className={`${styles.action} ${styles.report}`}
                onClick={() => setReportingReview({ id: rev.id, title: rev.title || `${username}'s review` })}
                aria-label="Report review"
              >
                <Flag size={13} />
              </button>
            )}
          </footer>

          {renderThread(rev)}
        </div>
      </article>
    );
  };

  return (
    <div className={styles.card} role="region" aria-label="Reviews">
      {/* ── Write a Review ── */}
      {!userReview && (
        <section className={styles.writeSection} aria-label="Write a review">
          <h3 className={styles.sectionTitle}>Write a Review</h3>
          <ReviewWriteCard
            mode="new"
            user={user ? { username: user.username, avatarUrl: user.avatarUrl } : null}
            animeTitle={animeTitle}
            submitting={posting}
            onSubmit={postReview}
            onMoreOptions={onWriteReview}
            onNeedLogin={() => openAuthModal('login')}
          />
        </section>
      )}

      {/* ── User Reviews ── */}
      <section aria-label="User reviews">
        <div className={styles.listHead}>
          <h3 className={styles.sectionTitle}>
            User Reviews <span className={styles.count}>{total}</span>
          </h3>
        </div>

        {communityTags.length > 0 && (
          <div className={styles.membersSay}>
            <span className={styles.membersSayLabel}>Members say</span>
            {communityTags.slice(0, 10).map((t) => (
              <span key={t.tag} className={styles.tagChip}>
                {t.label} <small>{t.count}</small>
              </span>
            ))}
          </div>
        )}

        {total > 0 && (
          <div className={styles.controls}>
            <label className={styles.sort}>
              <ArrowUpDown size={15} aria-hidden="true" />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} aria-label="Sort reviews">
                <option value="RECOMMENDED">Recommended</option>
                <option value="HELPFUL">Most liked</option>
                <option value="NEWEST">Newest</option>
              </select>
              <ChevronDown size={15} aria-hidden="true" className={styles.sortChevron} />
            </label>
            <label className={styles.toggle}>
              <input type="checkbox" checked={showSpoilers} onChange={(e) => setShowSpoilers(e.target.checked)} />
              <span className={styles.checkBox} aria-hidden="true" />
              Show spoilers
            </label>
            {communityReviews.some((r) => r.isCreatorReview) && (
              <label className={styles.toggle}>
                <input type="checkbox" checked={creatorsOnly} onChange={(e) => setCreatorsOnly(e.target.checked)} />
                <span className={styles.checkBox} aria-hidden="true" />
                Creators only
              </label>
            )}
          </div>
        )}

        {total === 0 ? (
          <p className={styles.empty}>No reviews yet — be the first to share what you thought of {animeTitle}.</p>
        ) : (
          <div className={styles.list}>
            {pinned.map((rev) => renderReview(rev, Boolean(userReview && rev.id === userReview.id)))}
            {userReview && !ownPinned && renderReview(userReview, true)}
            {sorted.map((rev) => renderReview(rev, false))}
          </div>
        )}
      </section>

      {reportingReview && (
        <ReportReviewModal
          isOpen={Boolean(reportingReview)}
          onClose={() => setReportingReview(null)}
          reviewId={reportingReview.id}
          reviewTitle={reportingReview.title}
        />
      )}
    </div>
  );
};
