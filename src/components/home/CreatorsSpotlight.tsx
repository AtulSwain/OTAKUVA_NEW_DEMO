'use client';

/**
 * Homepage "Content creators" (2026-10-24, owner; sits right above
 * "Creators and Directors"): story-style circles for every creator account —
 * The creators the viewer follows (or, when there are none, creators to
 * discover), with each creator's recent anime ratings shown as branches.
 * Real data from GET /api/creators; renders nothing until
 * there is at least one creator.
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { HypeIcon } from '../hype/HypeMeter';
import { PeakedAt } from '../rating/PeakedAt';
import { SectionHead } from '../ui/SectionHead';
import { AnimeImage } from '../anime/AnimeImage';
import { avatarInitial } from '../../lib/mediaResolver';
import { useAuth } from '../../context/AuthContext';
import type { CreatorDirectoryData } from '../../lib/creator/creatorDirectory';
import styles from './CreatorsSpotlight.module.css';

interface CreatorCard {
  username: string;
  displayName: string | null;
  channelName: string | null;
  avatarUrl: string | null;
  followerCount: number;
  lastActiveAt: string | null;
  latestActivity: 'JOINED' | 'RATED' | 'REVIEWED' | 'HYPED' | null;
  isOnline: boolean;
  ratedAnime: Array<{ id: string; slug: string; title: string; posterUrl: string | null }>;
  latestReview: { id: string; title: string; excerpt: string | null; animeSlug: string; animeTitle: string } | null;
}
interface FeedItem {
  kind: 'JOINED' | 'RATED' | 'REVIEWED' | 'HYPED';
  at: string;
  creator: { username: string; name: string; avatarUrl: string | null };
  anime: { id?: string; slug: string; title: string; posterUrl: string | null } | null;
  score: number | null;
  review: { id: string; title: string; excerpt: string | null } | null;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function CreatorBranch({ c, following }: { c: CreatorCard; following: boolean }) {
  const name = c.channelName || c.displayName || c.username;
  return (
    <li className={styles.creatorBranch}>
      <div className={styles.creatorProfile}>
        <Link href={`/profile/${encodeURIComponent(c.username)}`} className={styles.creatorNode} title={`${name} · @${c.username}`}>
          <span className={styles.avatar}>
            {c.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.avatarUrl} alt="" loading="lazy" decoding="async" />
            ) : (
              <span aria-hidden="true">{avatarInitial(name)}</span>
            )}
            <span className={`${styles.statusDot} ${c.isOnline ? styles.statusOnline : ''}`} aria-label={c.isOnline ? 'Online' : 'Offline'} title={c.isOnline ? 'Online' : 'Offline'} />
          </span>
          <span className={styles.creatorDetails}>
            <span className={styles.creatorName}>{name}</span>
            <span className={styles.creatorMeta}>
              {following && <span className={styles.followingTag}>Following</span>}
              {compact.format(c.followerCount)} {c.followerCount === 1 ? 'follower' : 'followers'}
            </span>
          </span>
        </Link>
        {c.latestReview && (
          <Link href={`/anime/${c.latestReview.animeSlug}#review-${c.latestReview.id}`} className={styles.reviewBubble}>
            <span className={styles.reviewBubbleTitle}><MessageSquare size={11} aria-hidden="true" /> {c.latestReview.title}</span>
            <span className={styles.reviewBubbleText}>
              {c.latestReview.animeTitle}{c.latestReview.excerpt ? ` · ${c.latestReview.excerpt}` : ''}
            </span>
          </Link>
        )}
      </div>
      {c.ratedAnime.length > 0 ? (
        <ul className={styles.ratedBranches} aria-label={`Anime rated by ${name}`}>
          {c.ratedAnime.map((anime) => (
            <li key={anime.id}>
              <Link href={`/anime/${anime.slug}`} className={styles.ratedAnime} title={anime.title}>
                <span className={styles.animePoster}>
                  {anime.posterUrl ? (
                    <AnimeImage src={anime.posterUrl} alt="" fill sizes="30px" />
                  ) : (
                    <span aria-hidden="true">{avatarInitial(anime.title)}</span>
                  )}
                </span>
                <span className={styles.ratedAnimeTitle}>{anime.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <span className={styles.noRatedAnime}>No anime rated yet</span>
      )}
    </li>
  );
}

function verb(item: FeedItem) {
  if (item.kind === 'JOINED') return 'joined OTAKUVA as a creator';
  if (item.kind === 'REVIEWED') return 'reviewed';
  if (item.kind === 'HYPED') return 'is hyped for';
  return 'rated';
}

function activityLabel(kind: FeedItem['kind']) {
  if (kind === 'JOINED') return 'NEW CREATOR';
  if (kind === 'REVIEWED') return 'NEW REVIEW';
  if (kind === 'HYPED') return 'HYPED';
  return 'RATED';
}

export function CreatorsSpotlight({
  initialData,
  initialFollowedCreators,
  initialFollowedUsername,
}: {
  initialData: CreatorDirectoryData;
  initialFollowedCreators: string[];
  initialFollowedUsername: string | null;
}) {
  const { user, isLoading } = useAuth();
  const [data, setData] = useState<CreatorDirectoryData>(initialData);
  const [followed, setFollowed] = useState<Set<string>>(() => new Set(initialFollowedCreators));

  // The server provides the initial follow list; fetch only if the active
  // client session differs from the one used to render the page.
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setFollowed(new Set());
      return;
    }
    if (user.username === initialFollowedUsername) return;
    let active = true;
    fetch(`/api/users/${encodeURIComponent(user.username)}/following?limit=60`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return;
        if (d) setFollowed(new Set((d.items || []).map((i: { username: string }) => i.username)));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user, isLoading, initialFollowedUsername]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/creators?feed=8', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (active && d) setData(d);
        })
        .catch(() => {});
    };
    const timer = window.setInterval(refresh, 120_000);
    const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
        active = false;
        window.clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  if (data.creators.length === 0) return null;
  const followsAny = data.creators.some((c) => followed.has(c.username));
  const creators = [...data.creators].sort((a, b) =>
    Number(followed.has(b.username)) - Number(followed.has(a.username)) ||
    b.followerCount - a.followerCount ||
    a.username.localeCompare(b.username),
  );
  const feed = [...data.feed]
    .sort((a, b) => Number(followed.has(b.creator.username)) - Number(followed.has(a.creator.username)) || b.at.localeCompare(a.at))
    .slice(0, 8);
  return (
    <section className={styles.block} aria-labelledby="creators-spotlight">
      <SectionHead kicker="Content creators" title={followsAny ? 'Creators you follow & discover' : 'Creators to follow'} id="creators-spotlight" />
      <ul className={styles.tree}>
        {creators.map((c) => (
          <CreatorBranch key={c.username} c={c} following={followed.has(c.username)} />
        ))}
      </ul>

      {feed.length > 0 && (
        <ul className={styles.feed}>
          {feed.map((item, i) => (
            <li key={`${item.kind}-${item.creator.username}-${item.anime?.slug ?? item.at}-${i}`}>
              <Link
                href={
                  item.kind === 'JOINED'
                    ? `/profile/${encodeURIComponent(item.creator.username)}`
                    : item.review && item.anime
                    ? `/anime/${item.anime.slug}#review-${item.review.id}`
                    : item.anime
                      ? `/anime/${item.anime.slug}?creator=${encodeURIComponent(item.creator.username)}#creators`
                      : `/profile/${encodeURIComponent(item.creator.username)}`
                }
                className={styles.feedCard}
              >
                <span className={styles.poster}>
                  {item.anime?.posterUrl ? (
                    <AnimeImage src={item.anime.posterUrl} alt="" fill sizes="56px" />
                  ) : item.creator.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.creator.avatarUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span aria-hidden="true">{avatarInitial(item.creator.name)}</span>
                  )}
                </span>
                <span className={styles.feedText}>
                  <span className={styles.feedTags}>
                    <span className={styles.activityTag}>{activityLabel(item.kind)}</span>
                    {followed.has(item.creator.username) && <span className={styles.followingTag}>Following</span>}
                  </span>
                  <span className={styles.feedWho}>
                    <strong>{item.creator.name}</strong> {verb(item)}
                  </span>
                  {item.anime && <span className={styles.feedAnime}>{item.anime.title}</span>}
                  {item.anime && <span className={styles.feedWhat}>
                    {item.kind === 'RATED' && <PeakedAt animeId={item.anime.id} />}
                    {item.kind === 'REVIEWED' && (
                      <span>
                        <MessageSquare size={12} aria-hidden="true" /> {item.review?.title || 'Creator review'}
                        {item.review?.excerpt && ` · ${item.review.excerpt}`}
                      </span>
                    )}
                    {item.kind === 'HYPED' && (
                      <span className={styles.hype}>
                        <HypeIcon size={12} aria-hidden="true" /> Hyped
                      </span>
                    )}
                  </span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
