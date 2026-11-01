'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  Bookmark,
  Share2,
  ExternalLink,
  Clock,
  Calendar,
  MessageSquare,
  Building2,
  Film,
  User,
  Check,
  Send,
  Sparkles,
  Shield,
  Layers,
  ChevronLeft,
  ChevronRight,
  Flame,
  Users,
  ArrowRight,
} from 'lucide-react';
import styles from './reader.module.css';
import { ViewBeacon } from '../../../components/analytics/ViewBeacon';

export default function NewsReaderPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;

  const [article, setArticle] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaved, setIsSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Comments state for user discussion

  useEffect(() => {
    async function loadArticle() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/news/${slug}`);
        if (res.ok) {
          const data = await res.json();
          const loaded = data.article || data;
          setArticle(loaded);

          // Track article open event asynchronously
          if (loaded.id) {
            fetch('/api/news/track', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                eventType: 'NEWS_OPENED',
                articleId: loaded.id,
                metadata: { slug: loaded.slug, title: loaded.title },
              }),
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.error('Error fetching article:', err);
      } finally {
        setIsLoading(false);
      }
    }
    if (slug) loadArticle();
  }, [slug]);

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);

      if (article?.id) {
        fetch('/api/news/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'NEWS_SHARED',
            articleId: article.id,
          }),
        }).catch(() => {});
      }
    }
  };

  const handleToggleSave = () => {
    setIsSaved(!isSaved);
  };

  const handleSourceClick = () => {
    if (article?.id) {
      fetch('/api/news/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'NEWS_SOURCE_OPENED',
          articleId: article.id,
          metadata: { sourceName: article.sourceName, url: article.canonicalUrl || article.sourceUrl },
        }),
      }).catch(() => {});
    }
  };

  if (isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingHeader} />
        <div className={styles.loadingHero} />
        <div className={styles.loadingBody} />
      </div>
    );
  }

  if (!article) {
    return (
      <div className={styles.notFoundContainer}>
        <h2>Article Not Found</h2>
        <p>The requested news article could not be retrieved from the catalog.</p>
        <Link href="/news" className={styles.backLinkBtn}>
          <ArrowLeft size={14} aria-hidden="true" /> Return to News Platform
        </Link>
      </div>
    );
  }

  const publishFormatted = new Date(article.publishedAt).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const displayTitle = article.displayTitle || article.title;
  const displaySummary = article.displaySummary || article.summary;
  const displayCategory = article.displayCategory || article.category;
  const targetUrl = article.canonicalUrl || article.sourceUrl || '#';
  const isOwnStory = article.provider === 'INTERNAL';
  // The source's own opening paragraphs, copied verbatim at ingestion
  // (src/lib/engine/news/articleExcerpt.ts). Never rewritten here.
  const excerpt: string[] =
    !isOwnStory && article.contentType === 'SOURCE_EXCERPT' && article.content
      ? String(article.content).split(/\n{2,}/).map((p: string) => p.trim()).filter(Boolean)
      : [];

  return (
    <div className={styles.readerWrapper}>
      <ViewBeacon kind="news" id={article.id} />
      {/* 1. Top Reader Navigation Header */}
      <header className={styles.readerHeader}>
        <div className={styles.headerLeft}>
          <Link href="/news" className={styles.backBtn} aria-label="Back to News Platform">
            <ArrowLeft size={16} />
            <span>News Platform</span>
          </Link>
          <span className={styles.headerDivider}>/</span>
          <span className={styles.categoryBadge}>{displayCategory}</span>
          <span className={styles.sourceTag}>
            <Building2 size={12} />
            {article.sourceName}
          </span>
        </div>

        <div className={styles.headerRight}>
          <button
            type="button"
            className={`${styles.actionIconBtn} ${isSaved ? styles.actionIconBtnActive : ''}`}
            onClick={handleToggleSave}
            title={isSaved ? 'Remove from Saved' : 'Save Article'}
          >
            <Bookmark size={14} fill={isSaved ? '#FFFFFF' : 'none'} />
            <span className={styles.btnLabel}>{isSaved ? 'Saved' : 'Save'}</span>
          </button>

          <button
            type="button"
            className={styles.actionIconBtn}
            onClick={handleShare}
            title="Copy link to story"
          >
            {copied ? <Check size={14} className={styles.checkIcon} /> : <Share2 size={14} />}
            <span className={styles.btnLabel}>{copied ? 'Copied' : 'Share'}</span>
          </button>
        </div>
      </header>

      {/* Transparency Banner */}
      <div className={styles.transparencyBanner}>
        <Shield size={13} className={styles.shieldIcon} />
        <span>
          You are viewing structured reporting on <strong>OTAKUVA</strong>. Original source attribution:{' '}
          <strong>{article.sourceName}</strong>.
        </span>
      </div>

      {/* 2. Full-Screen Editorial Hero */}
      <section className={styles.heroSection}>
        <div className={styles.heroMetaRow}>
          <span className={styles.heroCategory}>{displayCategory}</span>
          <span className={styles.metaDot}>•</span>
          <span className={styles.heroDate}>{publishFormatted}</span>
          {article.contentType && (
            <>
              <span className={styles.metaDot}>•</span>
              <span className={styles.contentTypeBadge}>
                {article.contentType === 'OTAKUVA_EDITORIAL'
                  ? 'Editorial'
                  : article.contentType === 'SOURCE_EXCERPT'
                  ? 'Source excerpt'
                  : article.contentType === 'LICENSED_CONTENT'
                  ? 'Licensed'
                  : 'Source Metadata'}
              </span>
            </>
          )}
        </div>

        <h1 className={styles.heroTitle}>{displayTitle}</h1>

        {/* The feed's one-line teaser repeats the opening, so it's only shown when there's no excerpt. */}
        {displaySummary && excerpt.length === 0 && (
          <p className={styles.heroSubtitle}>{displaySummary}</p>
        )}

        <div className={styles.bylineRow}>
          <div className={styles.authorGroup}>
            <div className={styles.authorAvatar}>
              <User size={14} />
            </div>
            <span className={styles.authorName}>
              Reported by <strong>{article.author || article.sourceName}</strong>
            </span>
          </div>
          <span className={styles.bylineSource}>Source: {article.sourceName}</span>
        </div>

        {article.imageUrl && (
          <div className={styles.heroImageContainer}>
            <Image
              src={article.imageUrl}
              alt={displayTitle}
              fill
              priority
              className={styles.heroImg}
              unoptimized
            />
            <div className={styles.imageOverlayGradient} />
            <span className={styles.imageCaption}>
              Visual assets and production artwork courtesy of {article.sourceName}
            </span>
          </div>
        )}
      </section>

      {/* 3. Main Reading Content & Structured Knowledge Rails */}
      <div className={styles.contentLayout}>
        <main className={styles.articleMain}>
          {/* Linked entities only. This box and the body below used to add
              canned copy ("Primary Focus", "Coverage Scope", two paragraphs
              about "meticulous visual and musical composition") presented
              as the source's reporting — invented text attributed to a real
              publication. Only what the source/our entity links say is shown. */}
          {((article.relatedStudios && article.relatedStudios.length > 0) ||
            (article.relatedAnime && article.relatedAnime.length > 0)) && (
            <div className={styles.keyHighlightsBox}>
              <div className={styles.highlightsHeader}>
                <Sparkles size={14} />
                <span>MENTIONED IN THIS STORY</span>
              </div>
              <ul className={styles.highlightsList}>
                {article.relatedStudios && article.relatedStudios.length > 0 && (
                  <li>
                    <strong>Animation Studio:</strong>{' '}
                    {article.relatedStudios.map((s: any) => s.name).join(', ')}.
                  </li>
                )}
                {article.relatedAnime && article.relatedAnime.length > 0 && (
                  <li>
                    <strong>Associated Franchise:</strong>{' '}
                    {article.relatedAnime.map((a: any) => a.canonicalTitle).join(', ')}.
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* The source's summary is already shown under the headline; no body
              text is written in its place (the full story is linked below).
              OTAKUVA's own stories (written in the control center, provider
              INTERNAL) show their full text here instead, with no source link. */}
          {isOwnStory && article.content && (
            <div className={styles.ownStoryBody}>
              {String(article.content)
                .split(/\n{2,}/)
                .map((para: string, i: number) => (
                  <p key={i}>{para}</p>
                ))}
            </div>
          )}

          {/* Opening of the source's article, word for word, then the link to the rest. */}
          {excerpt.length > 0 && (
            <section className={styles.sourceExcerpt} aria-label={`Opening of the article on ${article.sourceName}`}>
              <span className={styles.excerptLabel}>
                <Building2 size={12} aria-hidden="true" /> From {article.sourceName}
              </span>
              <div className={styles.excerptBody}>
                {excerpt.map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </section>
          )}

          {!isOwnStory && (
          <div className={styles.readOriginalBanner}>
            <div className={styles.readOriginalInfo}>
              <h3 className={styles.readOriginalTitle}>Want to know more?</h3>
              <p className={styles.readOriginalDesc}>
                Read the full story on <strong>{article.sourceName}</strong> · Published {publishFormatted}
              </p>
            </div>
            <a
              href={targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.readOriginalActionBtn}
              onClick={handleSourceClick}
            >
              <span>Visit {article.sourceName}</span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
          )}

          {/* Syndicated Coverage (if clustered) */}
          {article.syndicatedReports && article.syndicatedReports.length > 0 && (
            <div className={styles.syndicatedBox}>
              <div className={styles.syndicatedHeader}>
                <Layers size={14} />
                <span>MORE COVERAGE ON THIS STORY</span>
              </div>
              <div className={styles.syndicatedList}>
                {article.syndicatedReports.map((rep: any) => (
                  <Link key={rep.id} href={`/news/${rep.slug || rep.id}`} className={styles.syndicatedItem}>
                    <span className={styles.syndicatedSource}>{rep.sourceName}</span>
                    <span className={styles.syndicatedTitle}>{rep.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Talk about it: news comments aren't stored, so this starts a real (saved) discussion. */}
          <section className={styles.discussionSection}>
            <div className={styles.discussionHeader}>
              <div className={styles.discussionTitleWrap}>
                <MessageSquare size={16} />
                <h3>Discuss this story</h3>
              </div>
            </div>
            <p className={styles.discussPrompt}>Start a thread about this news in Discussions — everyone can read and reply.</p>
            <Link href={`/discussions?new=1&title=${encodeURIComponent(article.title || '')}`} className={styles.discussBtn}>
              <Send size={13} aria-hidden="true" /> Start a discussion
            </Link>
          </section>
        </main>

        {/* 4. Connected Knowledge Rails & Entities */}
        <aside className={styles.entitiesSidebar}>
          {/* Related Anime Entity */}
          {article.relatedAnime && article.relatedAnime.length > 0 && (
            <div className={styles.sidebarCard}>
              <div className={styles.sidebarHeader}>
                <Film size={14} />
                <h4>Related Anime</h4>
              </div>
              <div className={styles.entityItems}>
                {article.relatedAnime.map((anime: any) => (
                  <Link key={anime.id} href={`/anime/${anime.slug || anime.id}`} className={styles.entityItem}>
                    {anime.posterUrl && (
                      <div className={styles.entityPosterWrap}>
                        <Image src={anime.posterUrl} alt={anime.canonicalTitle} fill className={styles.entityPoster} unoptimized />
                      </div>
                    )}
                    <div className={styles.entityMeta}>
                      <span className={styles.entityTitle}>{anime.canonicalTitle}</span>
                      <span className={styles.entitySubtitle}>View Catalog Page <ArrowRight size={13} aria-hidden="true" /></span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Related Studio Entity */}
          {article.relatedStudios && article.relatedStudios.length > 0 && (
            <div className={styles.sidebarCard}>
              <div className={styles.sidebarHeader}>
                <Building2 size={14} />
                <h4>Animation Studio</h4>
              </div>
              <div className={styles.entityItems}>
                {article.relatedStudios.map((studio: any) => (
                  <Link key={studio.id} href={`/studio/${studio.slug}`} className={styles.entityItem}>
                    <div className={styles.entityMeta}>
                      <span className={styles.entityTitle}>{studio.name}</span>
                      <span className={styles.entitySubtitle}>Explore Studio Portfolio <ArrowRight size={13} aria-hidden="true" /></span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Related People */}
          {article.relatedPeople && article.relatedPeople.length > 0 && (
            <div className={styles.sidebarCard}>
              <div className={styles.sidebarHeader}>
                <User size={14} />
                <h4>Credited Staff &amp; Cast</h4>
              </div>
              <div className={styles.entityItems}>
                {article.relatedPeople.map((person: any) => (
                  <div key={person.id} className={styles.personItem}>
                    <span className={styles.entityTitle}>{person.name}</span>
                    {person.nameKanji && <span className={styles.kanjiTag}>{person.nameKanji}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Community Hub Connection */}
          {article.relatedAnime && article.relatedAnime.length > 0 && (
            <div className={styles.sidebarCard}>
              <div className={styles.sidebarHeader}>
                <Users size={14} />
                <h4>Community Hub</h4>
              </div>
              <p className={styles.communityPromoText}>
                Discuss this anime in dedicated fan communities and real-time chat rooms.
              </p>
              <Link href={`/anime/${article.relatedAnime[0].slug || article.relatedAnime[0].id}`} className={styles.communityJoinBtn}>
                Join Community Discussions
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
