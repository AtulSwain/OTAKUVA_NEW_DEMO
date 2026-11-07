import Link from 'next/link';
import type { Metadata } from 'next';
import { BookOpen, Layers, MessageSquare, PenLine } from 'lucide-react';
import { getAuthUserFromCookies } from '../../lib/auth';
import { getFollowingFeed, type FollowingFeedKind } from '../../lib/social/followingFeed';
import { PageHead } from '../../components/ui/PageHead';
import { UserAvatar } from '../../components/ui/UserAvatar';
import { SignInPrompt } from './SignInPrompt';
import styles from './following.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Following', robots: { index: false, follow: false } };

const KIND: Record<FollowingFeedKind, { verb: string; icon: typeof BookOpen }> = {
  REVIEW: { verb: 'reviewed', icon: BookOpen },
  ARTICLE: { verb: 'wrote an article', icon: PenLine },
  COLLECTION: { verb: 'made a collection', icon: Layers },
  DISCUSSION: { verb: 'started a discussion', icon: MessageSquare },
};

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** /following — what the people you follow published, newest first (2026-11-06). */
export default async function FollowingPage({ searchParams }: { searchParams: { before?: string } }) {
  const user = await getAuthUserFromCookies();
  if (!user) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Your feed" title="Following" />
        <SignInPrompt />
      </div>
    );
  }
  const before = searchParams.before && !Number.isNaN(Date.parse(searchParams.before)) ? new Date(searchParams.before) : null;
  const { items, nextCursor, followingCount } = await getFollowingFeed(user.id, { before, limit: 30 });

  return (
    <div className={styles.page}>
      <PageHead kicker="Your feed" title="Following" />
      {followingCount === 0 ? (
        <div className={styles.empty}>
          <p>You aren&apos;t following anyone yet.</p>
          <p className={styles.muted}>Follow members from their profile or right from their reviews, and what they publish shows up here.</p>
          <Link href="/discussions" className={styles.cta}>
            Find people in Discussions
          </Link>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <p>{before ? 'That is everything.' : 'Nothing new from the people you follow yet.'}</p>
        </div>
      ) : (
        <ol className={styles.feed}>
          {items.map((it) => {
            const { verb, icon: Icon } = KIND[it.kind];
            const profile = `/profile/${encodeURIComponent(it.user.username)}`;
            return (
              <li key={it.id} className={styles.item}>
                <Link href={profile} className={styles.avatar} aria-label={`@${it.user.username}`}>
                  <UserAvatar username={it.user.username} avatarUrl={it.user.avatarUrl} size={40} />
                </Link>
                <div className={styles.body}>
                  <p className={styles.line}>
                    <Link href={profile} className={styles.who}>
                      {it.user.displayName || it.user.username}
                    </Link>{' '}
                    <span className={styles.verb}>
                      <Icon size={13} aria-hidden="true" /> {verb}
                      {it.kind === 'REVIEW' && it.anime ? ` ${it.anime.title}` : ''}
                    </span>
                    <time className={styles.time} dateTime={it.at}>
                      {DATE.format(new Date(it.at))}
                    </time>
                  </p>
                  <Link href={it.href} className={styles.card}>
                    {it.anime?.posterUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.anime.posterUrl} alt="" className={styles.poster} loading="lazy" />
                    )}
                    <span className={styles.cardText}>
                      <strong>{it.title}</strong>
                      {it.spoiler ? (
                        <span className={styles.spoiler}>Contains spoilers. Open to read.</span>
                      ) : (
                        it.excerpt && <span className={styles.excerpt}>{it.excerpt}</span>
                      )}
                    </span>
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {nextCursor && (
        <div className={styles.more}>
          <Link href={`/following?before=${encodeURIComponent(nextCursor)}`} className={styles.cta}>
            Older
          </Link>
        </div>
      )}
    </div>
  );
}
