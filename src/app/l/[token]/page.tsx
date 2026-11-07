import React from 'react';
import { CommunityScoreBadge } from '../../../components/rating/CommunityScoreBadge';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getSharedList } from '../../../lib/lists/listService';
import { resolveAvatarUrl, resolveMediaUrl } from '../../../lib/mediaResolver';
import { CopyLinkButton } from './CopyLinkButton';
import styles from './share.module.css';
import { ViewBeacon } from '../../../components/analytics/ViewBeacon';

export const dynamic = 'force-dynamic';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const list = await getSharedList(params.token);
  // notFound() here (not only in the page): metadata resolves before the
  // loading skeleton streams, so the response is a real 404, not a 200.
  if (!list) notFound();
  const title = `${list.name} — ${list.items.length} anime by @${list.owner.username}`;
  const description =
    list.description ||
    `${list.items.slice(0, 4).map((i) => i.title).join(', ')}${list.items.length > 4 ? ' and more' : ''} — an anime list on OTAKUVA.`;
  const image = list.bannerUrl || list.items[0]?.posterUrl;
  return {
    title: `${title}`,
    description,
    // Link-only lists aren't meant to be found by search engines.
    robots: list.visibility === 'PUBLIC' ? undefined : { index: false, follow: false },
    openGraph: { title, description, type: 'website', ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, ...(image ? { images: [image] } : {}) },
  };
}

/**
 * Public view of a shared list (/l/<token>). Only lists their owner shared
 * ("Anyone with the link" or "Public") resolve; private or revoked links 404.
 * Everything shown is real: the list's own anime, count, owner and dates.
 */
export default async function SharedListPage({ params }: { params: { token: string } }) {
  const list = await getSharedList(params.token);
  if (!list) notFound();

  const stack = list.items.slice(0, 3);
  const count = list.items.length;
  const ownerAvatar = resolveAvatarUrl(list.owner.avatarUrl);

  return (
    <div className={styles.page}>
      <ViewBeacon kind="collection" id={list.id} />
      <section className={styles.card} aria-labelledby="shared-list-title">
        <div className={styles.glow} aria-hidden="true" />
        {/* Collection banner (2026-10-22): chosen or the first anime's, fading into the page. */}
        {list.bannerUrl && (
          <div className={styles.bannerBg} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resolveMediaUrl(list.bannerUrl) || list.bannerUrl} alt="" />
          </div>
        )}

        <Link href="/" className={styles.brand} aria-label="OTAKUVA home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/otakuva-mark@2x.png" alt="" width={72} height={56} className={styles.brandIcon} />
        </Link>

        <h1 id="shared-list-title" className={styles.title}>{list.name}</h1>

        <div className={`${styles.stack} ${stack.length === 1 ? styles.stackSingle : ''}`} aria-hidden="true">
          {stack.length === 0 ? (
            <div className={`${styles.poster} ${styles.posterEmpty}`} />
          ) : (
            stack.map((a, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={a.id} src={a.posterUrl} alt="" className={`${styles.poster} ${styles[`poster${i}`]}`} />
            ))
          )}
        </div>

        <div className={styles.stat}>
          <span className={styles.statValue}>{count.toLocaleString('en-US')}</span>
          <span className={styles.statLabel}>Anime in this collection</span>
        </div>

        {list.description && <p className={styles.description}>{list.description}</p>}

        <div className={styles.divider} />

        <p className={styles.byline}>
          {ownerAvatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ownerAvatar} alt="" className={styles.avatar} />
          )}
          <span>
            Made by <strong>@{list.owner.username}</strong> · Updated {formatDate(list.updatedAt)}
          </span>
        </p>

        <div className={styles.actions}>
          <a href="#titles" className={styles.primaryBtn}>See the anime</a>
          <CopyLinkButton title={list.name} className={styles.ghostBtn} />
        </div>
      </section>

      <section id="titles" className={styles.titles} aria-label="Anime in this list">
        {count === 0 ? (
          <p className={styles.empty}>This list doesn&apos;t have any anime yet.</p>
        ) : (
          <ol className={styles.grid}>
            {list.items.map((a, i) => (
              <li key={a.id}>
                <Link href={`/anime/${a.slug || a.id}`} className={styles.item}>
                  <span className={styles.itemArt}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.posterUrl} alt="" loading="lazy" />
                    <span className={styles.itemRank}>{String(i + 1).padStart(2, '0')}</span>
                    <CommunityScoreBadge animeId={a.id} variant="overlay" />
                  </span>
                  <strong className={styles.itemTitle}>{a.title}</strong>
                  <span className={styles.itemMeta}>{[a.year, a.type, ...a.genres.slice(0, 2)].filter(Boolean).join(' · ')}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}

        <div className={styles.cta}>
          <h2>Make your own collection</h2>
          <p>Group anime into collections — a mood, a genre, a weekend binge — and share them with friends.</p>
          <Link href="/collections/new" className={styles.primaryBtn}>
            Make a collection on OTAKUVA
          </Link>
        </div>
      </section>
    </div>
  );
}
