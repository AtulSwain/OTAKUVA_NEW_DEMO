import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, ArrowLeft } from 'lucide-react';
import { getArticleBySlug } from '../../../lib/articles/articleService';
import { getAuthUserFromCookies } from '../../../lib/auth';
import { hasMinRole } from '../../../lib/roles';
import { getTierBriefs } from '../../../lib/badges/queries';
import { UserAvatar } from '../../../components/ui/UserAvatar';
import BadgeChip from '../../../components/badges/BadgeChip';
import { ArticleActions } from './ArticleActions';
import { ArticleSocial } from './ArticleSocial';
import { prisma } from '../../../lib/prisma';
import styles from '../articles.module.css';
import { resolveMediaUrl } from '../../../lib/mediaResolver';
import { ViewBeacon } from '../../../components/analytics/ViewBeacon';

export const dynamic = 'force-dynamic';

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const article = await getArticleBySlug(params.slug).catch(() => undefined);
  // notFound() here (not only in the page): metadata resolves before the
  // loading skeleton streams, so the response is a real 404, not a 200.
  if (article === null) notFound();
  return article
    ? { title: `${article.title}`, description: article.summary }
    : { title: 'Article not found' };
}

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const article = await getArticleBySlug(params.slug);
  if (!article) notFound();

  const [viewer, briefs] = await Promise.all([getAuthUserFromCookies(), getTierBriefs([article.author.id]).catch(() => null)]);
  const tier = briefs?.get(article.author.id)?.tier ?? null;
  const likedByViewer = viewer
    ? Boolean(await prisma.userArticleLike.findUnique({ where: { articleId_userId: { articleId: article.id, userId: viewer.id } }, select: { id: true } }))
    : false;
  const canRemove = Boolean(viewer && (viewer.id === article.author.id || hasMinRole(viewer.role, 'MODERATOR')));
  const paragraphs = (article.body || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <article className={styles.readPage}>
      <ViewBeacon kind="article" id={article.id} />
      <Link href="/articles" className={styles.back}>
        <ArrowLeft size={15} aria-hidden="true" /> All articles
      </Link>

      <header className={styles.readHeader}>
        {article.anime && (
          <Link href={`/anime/${article.anime.slug}`} className={styles.readAnime}>
            {article.anime.title}
          </Link>
        )}
        <h1 className={styles.readTitle}>{article.title}</h1>
        {article.summary && <p className={styles.readSummary}>{article.summary}</p>}

        {/* Who shared it — always shown: this is member content, not editorial news. */}
        <div className={styles.byline}>
          <Link href={`/profile/${encodeURIComponent(article.author.username)}`} className={styles.bylineAuthor}>
            <UserAvatar username={article.author.username} avatarUrl={article.author.avatarUrl} size={40} />
            <span className={styles.bylineText}>
              <span className={styles.bylineShared}>Shared by</span>
              <strong>@{article.author.username}</strong>
            </span>
          </Link>
          {tier && <BadgeChip tier={tier} />}
          <span className={styles.bylineMeta}>
            {DATE_FORMAT.format(new Date(article.createdAt))} · {article.readMinutes} min read
          </span>
          {canRemove && <ArticleActions slug={article.slug} isAuthor={viewer?.id === article.author.id} />}
        </div>
      </header>

      {article.coverImageUrl && (
        <figure className={styles.readCover}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolveMediaUrl(article.coverImageUrl) || undefined} alt="" />
        </figure>
      )}

      <div className={styles.readBody}>
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {article.links.length > 0 && (
        <section className={styles.sources} aria-label="Sources and links">
          <h2>Sources &amp; links</h2>
          <ul>
            {article.links.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="nofollow ugc noopener noreferrer">
                  <span>{l.label}</span>
                  <span className={styles.sourceHost}>{new URL(l.url).hostname.replace(/^www\./, '')}</span>
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className={styles.disclaimer}>
        Written by an OTAKUVA member, not by OTAKUVA. Check the linked sources before relying on it.
      </p>

      <ArticleSocial
        slug={article.slug}
        initialLikeCount={article.likeCount}
        initialLiked={likedByViewer}
        initialCommentCount={article.commentCount}
      />
    </article>
  );
}
