'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CommunityScoreBadge } from '../../../../components/rating/CommunityScoreBadge';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpDown, Check, ChevronLeft, ChevronRight, Globe, GripVertical, ImageIcon, Link2, Lock, Pencil, Share2, Star, Trash2, X } from 'lucide-react';
import { BannerPicker, type BannerChoice } from '../../../../components/collections/BannerPicker';
import { useAuth } from '../../../../context/AuthContext';
import { useToast } from '../../../../context/ToastContext';
import { ListCover } from '../../../../components/lists/ListCover';
import { ShareListDialog } from '../../../../components/lists/ShareListDialog';
import { EmptyState } from '../../../../components/ui/EmptyState';
import styles from '../../../../components/lists/lists.module.css';

type Visibility = 'PRIVATE' | 'LINK' | 'PUBLIC';

interface ListAnime {
  id: string;
  slug: string;
  title: string;
  posterUrl: string;
  bannerUrl?: string | null;
  year: number | null;
  type: string | null;
  otakuvaScore: number | null;
}

interface ListDetail {
  id: string;
  name: string;
  description: string | null;
  visibility: Visibility;
  shareToken: string | null;
  bannerUrl?: string | null;
  bannerChosen?: boolean;
  items: ListAnime[];
}

const VIS = {
  PRIVATE: { icon: Lock, label: 'Private' },
  LINK: { icon: Link2, label: 'Anyone with the link' },
  PUBLIC: { icon: Globe, label: 'Public' },
} as const;

export default function ListDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { user, isLoading: authLoading, openAuthModal } = useAuth();
  const { showToast } = useToast();
  const [list, setList] = useState<ListDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [bannerPick, setBannerPick] = useState<BannerChoice>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    fetch(`/api/lists/${id}`)
      .then(async (r) => {
        if (r.status === 404) return 'missing' as const;
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (!cancelled) setList(d.list);
        return 'ready' as const;
      })
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, [id, user, authLoading]);

  if (!authLoading && !user) {
    return (
      <div className={styles.page}>
        <EmptyState icon={Lock} title="Sign in to see this list" description="Lists are private to their owner unless shared." actionLabel="Sign in" onAction={() => openAuthModal('login')} />
      </div>
    );
  }

  if (state === 'missing' || state === 'error') {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={Lock}
          title={state === 'missing' ? 'List not found' : "Couldn't load this list"}
          description={state === 'missing' ? 'It may have been deleted, or it belongs to someone else.' : 'Please try again in a moment.'}
          actionLabel="Back to my lists"
          onAction={() => router.push('/library/lists')}
        />
      </div>
    );
  }

  if (!list) return <div className={styles.page} aria-busy="true" />;

  const v = VIS[list.visibility] || VIS.PRIVATE;
  const VisIcon = v.icon;

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draftName, description: draftDesc }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      setList((prev) => (prev ? { ...prev, name: data.list.name, description: data.list.description } : prev));
      setEditing(false);
    } catch (err: any) {
      showToast(err?.message || "Couldn't save", 'error');
    } finally {
      setBusy(false);
    }
  };

  // Banner (2026-10-22): saved as soon as one is picked.
  const changeBanner = async (choice: BannerChoice) => {
    setBannerPick(choice);
    try {
      const body =
        choice === null ? { banner: null } : choice.kind === 'upload' ? { bannerAssetId: choice.assetId } : { bannerAnimeId: choice.animeId };
      const res = await fetch(`/api/lists/${list.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      setList((prev) => (prev ? { ...prev, bannerUrl: data.list.bannerUrl, bannerChosen: data.list.bannerChosen } : prev));
      showToast('Banner updated', 'success');
    } catch (err: any) {
      showToast(err?.message || "Couldn't change the banner", 'error');
    }
  };

  // Arrange mode (2026-11-06): drag cards (mouse) or use the arrows (touch,
  // keyboard). Saved a moment after the last move; rolled back on failure.
  const [arranging, setArranging] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const savedOrder = useRef<ListAnime[] | null>(null);

  const saveOrder = (items: ListAnime[]) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/lists/${list.id}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: items.map((i) => i.id) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error);
        savedOrder.current = items;
      } catch (err: any) {
        if (savedOrder.current) setList((prev) => (prev ? { ...prev, items: savedOrder.current! } : prev));
        showToast(err?.message || "Couldn't save the new order", 'error');
      }
    }, 500);
  };

  const moveItem = (fromId: string, toIndex: number) => {
    setList((prev) => {
      if (!prev) return prev;
      const items = [...prev.items];
      const from = items.findIndex((i) => i.id === fromId);
      if (from < 0 || toIndex < 0 || toIndex >= items.length || from === toIndex) return prev;
      if (!savedOrder.current) savedOrder.current = prev.items;
      const [moved] = items.splice(from, 1);
      items.splice(toIndex, 0, moved);
      saveOrder(items);
      return { ...prev, items };
    });
  };

  const removeItem = async (anime: ListAnime) => {
    const before = list.items;
    setList((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== anime.id) } : prev));
    try {
      const res = await fetch(`/api/lists/${list.id}/items/${anime.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast(`Removed ${anime.title}`, 'success');
    } catch {
      setList((prev) => (prev ? { ...prev, items: before } : prev));
      showToast("Couldn't remove it", 'error');
    }
  };

  const deleteWholeList = async () => {
    if (!window.confirm(`Delete “${list.name}”? The anime stay in the catalog and your library — only this list is removed.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lists/${list.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('List deleted', 'success');
      router.push('/library/lists');
    } catch {
      showToast("Couldn't delete the list", 'error');
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <Link href="/library/lists" className={styles.backLink}>
        <ArrowLeft size={15} aria-hidden="true" /> My collections
      </Link>

      {bannerOpen ? (
        <div className={styles.bannerEdit}>
          <BannerPicker value={bannerPick} onChange={changeBanner} sources={list.items.map((i) => ({ id: i.id, title: i.title, bannerUrl: i.bannerUrl ?? null }))} title={list.name} />
          <button type="button" className={styles.ghostBtn} onClick={() => setBannerOpen(false)}>
            <Check size={15} aria-hidden="true" /> Done
          </button>
        </div>
      ) : (
        <div className={styles.bannerBand}>
          {list.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={list.bannerUrl} alt="" />
          ) : (
            <span className={styles.bannerEmpty}>No banner yet</span>
          )}
          <button type="button" className={styles.bannerBtn} onClick={() => setBannerOpen(true)}>
            <ImageIcon size={15} aria-hidden="true" /> Change banner
          </button>
        </div>
      )}

      <section className={styles.detailHero}>
        <ListCover covers={list.items.slice(0, 4).map((i) => i.posterUrl)} size="lg" />
        <div className={styles.detailInfo}>
          {editing ? (
            <form className={styles.editForm} onSubmit={saveDetails}>
              <input className={styles.input} value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={60} aria-label="List name" required />
              <textarea
                className={styles.textarea}
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Add a description (optional)"
                aria-label="Description"
              />
              <div className={styles.inline}>
                <button type="submit" className={styles.primaryBtn} disabled={busy || !draftName.trim()}>
                  <Check size={16} aria-hidden="true" /> Save
                </button>
                <button type="button" className={styles.ghostBtn} onClick={() => setEditing(false)}>
                  <X size={16} aria-hidden="true" /> Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <span className={styles.kicker}>Collection</span>
              <h1 className={styles.detailTitle}>{list.name}</h1>
              {list.description && <p className={styles.detailDesc}>{list.description}</p>}
              <p className={styles.detailMeta}>
                {list.items.length} anime · <VisIcon size={13} aria-hidden="true" /> {v.label}
              </p>
              <div className={styles.inline}>
                <button type="button" className={styles.primaryBtn} onClick={() => setShareOpen(true)}>
                  <Share2 size={16} aria-hidden="true" /> Share
                </button>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => {
                    setDraftName(list.name);
                    setDraftDesc(list.description || '');
                    setEditing(true);
                  }}
                >
                  <Pencil size={15} aria-hidden="true" /> Edit
                </button>
                <button type="button" className={styles.dangerGhostBtn} onClick={deleteWholeList} disabled={busy}>
                  <Trash2 size={15} aria-hidden="true" /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {list.items.length === 0 ? (
        <EmptyState
          icon={Star}
          title="This list is empty"
          description="Open any anime and choose “Add to a list…” from its Add to Library menu."
          actionLabel="Find anime"
          onAction={() => router.push('/anime')}
        />
      ) : (
        <>
        {list.items.length > 1 && (
          <div className={styles.arrangeBar}>
            <button
              type="button"
              className={`${styles.arrangeBtn} ${arranging ? styles.arrangeBtnOn : ''}`}
              aria-pressed={arranging}
              onClick={() => {
                setArranging((v) => !v);
                savedOrder.current = list.items;
              }}
            >
              {arranging ? <Check size={14} /> : <ArrowUpDown size={14} />} {arranging ? 'Done' : 'Arrange'}
            </button>
            {arranging && <span className={styles.arrangeHint}>Drag the posters, or use the arrows. Changes save on their own.</span>}
          </div>
        )}
        <div className={`${styles.posterGrid} ${arranging ? styles.posterGridArranging : ''}`}>
          {list.items.map((anime, index) => (
            <div
              key={anime.id}
              className={`${styles.posterCard} ${dragId === anime.id ? styles.posterCardDragging : ''}`}
              draggable={arranging}
              onDragStart={(e) => {
                if (!arranging) return;
                setDragId(anime.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!arranging || !dragId) return;
                e.preventDefault();
                if (dragId !== anime.id) moveItem(dragId, index);
              }}
              onDragEnd={() => setDragId(null)}
              onDrop={(e) => e.preventDefault()}
            >
              <Link href={`/anime/${anime.slug || anime.id}`} className={styles.posterLink}>
                <div className={styles.posterArt}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={anime.posterUrl} alt="" loading="lazy" />
                  <CommunityScoreBadge animeId={anime.id} variant="overlay" />
                </div>
                <strong className={styles.posterTitle}>{anime.title}</strong>
                <span className={styles.posterMeta}>{[anime.year, anime.type].filter(Boolean).join(' · ')}</span>
              </Link>
              {arranging ? (
                <div className={styles.arrangeControls}>
                  <button type="button" onClick={() => moveItem(anime.id, index - 1)} disabled={index === 0} aria-label={`Move ${anime.title} earlier`}>
                    <ChevronLeft size={15} />
                  </button>
                  <GripVertical size={14} aria-hidden="true" className={styles.arrangeGrip} />
                  <button
                    type="button"
                    onClick={() => moveItem(anime.id, index + 1)}
                    disabled={index === list.items.length - 1}
                    aria-label={`Move ${anime.title} later`}
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              ) : (
                <button type="button" className={styles.removeBtn} onClick={() => removeItem(anime)} aria-label={`Remove ${anime.title} from this list`}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        </>
      )}

      <ShareListDialog
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        listId={list.id}
        listName={list.name}
        visibility={list.visibility}
        shareToken={list.shareToken}
        onChange={(next) => setList((prev) => (prev ? { ...prev, ...next } : prev))}
      />
    </div>
  );
}
