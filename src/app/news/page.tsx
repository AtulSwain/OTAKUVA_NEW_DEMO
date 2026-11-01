'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Newspaper, Search, Sparkles, TrendingUp, Clock, Flame, RefreshCw, Building2, Film } from 'lucide-react';
import { sanitizePublicEntityName } from '../../lib/normalizers';
import { useAuth } from '../../context/AuthContext';
import { hasMinRole } from '../../lib/roles';
import styles from './news.module.css';

const CATEGORIES = [
  { id: 'ALL', label: 'All News' },
  { id: 'ANIME', label: 'Anime & Series' },
  { id: 'PRODUCTION', label: 'Production' },
  { id: 'ANNOUNCEMENT', label: 'Announcements' },
  { id: 'TRAILER', label: 'Trailers & PV' },
  { id: 'CAST', label: 'Voice Cast' },
  { id: 'STAFF', label: 'Staff & Creators' },
  { id: 'STUDIO', label: 'Studios' },
  { id: 'INDUSTRY', label: 'Industry & Box Office' },
  { id: 'MANGA', label: 'Manga & Print' },
];

export default function NewsPage() {
  const [activeTab, setActiveTab] = useState<'FOR_YOU' | 'TRENDING' | 'LATEST'>('FOR_YOU');
  const [trendingWindow, setTrendingWindow] = useState<'1h' | '6h' | '24h' | '7d'>('24h');
  const [articles, setArticles] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const { user } = useAuth();
  // Syncing is a newsroom action (POST /api/news requires NEWS_EDITOR+), so
  // the button is only shown to people who can actually use it.
  const canSyncNews = Boolean(user && hasMinRole(user.role, 'NEWS_EDITOR'));
  const [feedMeta, setFeedMeta] = useState<any>(null);

  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Load News based on Active Tab & Filters
  const loadNews = React.useCallback(async () => {
    setIsLoading(true);
    try {
      if (searchQuery.trim()) {
        const params = new URLSearchParams();
        params.set('q', searchQuery.trim());
        if (selectedCategory !== 'ALL') params.set('category', selectedCategory);
        const res = await fetch(`/api/news/search?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setArticles(data.results || []);
          setFeedMeta({ total: data.total, isSearch: true });
        }
      } else if (activeTab === 'FOR_YOU') {
        const params = new URLSearchParams();
        if (selectedCategory !== 'ALL') params.set('category', selectedCategory);
        const res = await fetch(`/api/news/feed?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setArticles(data.feed || []);
          setFeedMeta({ isPersonalized: data.isPersonalized, tier: data.confidenceTier });
        }
      } else if (activeTab === 'TRENDING') {
        const params = new URLSearchParams();
        params.set('window', trendingWindow);
        if (selectedCategory !== 'ALL') params.set('category', selectedCategory);
        const res = await fetch(`/api/news/trending?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setArticles(data.articles || []);
          setFeedMeta({ window: data.window });
        }
      } else {
        // LATEST
        const params = new URLSearchParams();
        if (selectedCategory !== 'ALL') params.set('category', selectedCategory);
        const res = await fetch(`/api/news?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setArticles(data.articles || []);
          setFeedMeta({ total: data.total });
        }
      }
    } catch (err) {
      console.error('Error loading news:', err);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, selectedCategory, activeTab, trendingWindow]);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  // Autocomplete fetch on query change
  useEffect(() => {
    if (searchQuery.trim().length >= 2) {
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/news/autocomplete?q=${encodeURIComponent(searchQuery.trim())}`);
          if (res.ok) {
            const data = await res.json();
            setSuggestions(data.suggestions || []);
            setShowSuggestions(true);
          }
        } catch {
          setSuggestions([]);
        }
      }, 200);
      return () => clearTimeout(timer);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [searchQuery]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    loadNews();
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await fetch('/api/news', { method: 'POST' });
      await loadNews();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncing(false);
    }
  };

  // Lead with the newest story that has a picture (when browsing everything); the rest go in the grid.
  const showLead = !searchQuery && selectedCategory === 'ALL' && !isLoading;
  const leadIndex = showLead ? articles.slice(0, 6).findIndex((a) => a.imageUrl) : -1;
  const lead = leadIndex >= 0 ? articles[leadIndex] : null;
  const rest = lead ? articles.filter((_, i) => i !== leadIndex) : articles;
  const view = (article: any) => ({
    title: sanitizePublicEntityName(article.displayTitle || article.title),
    summary: article.displaySummary || article.summary,
    category: article.displayCategory || article.category,
    time: formatTimeAgo(article.publishedAt),
    href: `/news/${article.slug || article.id}`,
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Newsroom</p>
          <h1 className={styles.title}>Anime news</h1>
        </div>
        {canSyncNews && (
          <button type="button" className={styles.syncBtn} onClick={handleManualSync} disabled={isSyncing} title="Refresh verified feed from providers">
            <RefreshCw size={13} className={isSyncing ? styles.spin : ''} />
            <span>{isSyncing ? 'Syncing…' : 'Sync feed'}</span>
          </button>
        )}
      </header>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="News feed">
          {(
            [
              ['FOR_YOU', 'For you', Sparkles],
              ['TRENDING', 'Trending', TrendingUp],
              ['LATEST', 'Latest', Clock],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id && !searchQuery}
              className={`${styles.tab} ${activeTab === id && !searchQuery ? styles.tabActive : ''}`}
              onClick={() => {
                setSearchQuery('');
                setActiveTab(id);
              }}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <div className={styles.searchWrap} ref={searchContainerRef}>
          <form className={styles.searchForm} onSubmit={handleSearchSubmit} role="search">
            <Search size={15} className={styles.searchIcon} aria-hidden="true" />
            <input
              type="text"
              placeholder="Search news, anime, studios, cast…"
              aria-label="Search news"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              className={styles.searchInput}
            />
          </form>
          {showSuggestions && suggestions.length > 0 && (
            <div className={styles.suggestions}>
              {suggestions.map((sug) => (
                <Link
                  key={`${sug.type}_${sug.id}`}
                  href={sug.type === 'ANIME' ? `/anime/${sug.slug || sug.id}` : sug.type === 'STUDIO' ? `/studio/${sug.slug}` : `/news/${sug.slug || sug.id}`}
                  className={styles.suggestion}
                  onClick={() => setShowSuggestions(false)}
                >
                  <span className={styles.suggestionIcon}>
                    {sug.type === 'ANIME' ? <Film size={14} /> : sug.type === 'STUDIO' ? <Building2 size={14} /> : <Newspaper size={14} />}
                  </span>
                  <span className={styles.suggestionText}>
                    <strong>{sug.title}</strong>
                    <span>{sug.subtitle}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeTab === 'TRENDING' && !searchQuery && (
        <div className={styles.windowRow}>
          <span>Window</span>
          {(['1h', '6h', '24h', '7d'] as const).map((w) => (
            <button key={w} type="button" className={`${styles.chip} ${trendingWindow === w ? styles.chipActive : ''}`} onClick={() => setTrendingWindow(w)}>
              {w === '1h' ? 'Past hour' : w === '6h' ? '6 hours' : w === '24h' ? 'Today' : 'This week'}
            </button>
          ))}
        </div>
      )}

      <div className={styles.categories} role="group" aria-label="Category">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            aria-pressed={selectedCategory === cat.id}
            className={`${styles.chip} ${selectedCategory === cat.id ? styles.chipActive : ''}`}
            onClick={() => setSelectedCategory(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {activeTab === 'FOR_YOU' && !searchQuery && feedMeta && (
        <p className={styles.feedNote}>
          <Sparkles size={13} aria-hidden="true" />
          {feedMeta.isPersonalized
            ? 'Personalised from the anime you track and the studios you follow.'
            : 'Showing the latest headlines. Track and rate anime to personalise this feed.'}
        </p>
      )}

      {isLoading ? (
        <div className={styles.grid}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={styles.skeleton}>
              <span className={styles.skeletonImg} />
              <span className={styles.skeletonLine} />
              <span className={styles.skeletonLineShort} />
            </div>
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className={styles.empty}>
          <Newspaper size={32} aria-hidden="true" />
          <h3>No stories found</h3>
          <p>Nothing matches this category or search yet.</p>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => {
              setSelectedCategory('ALL');
              setSearchQuery('');
            }}
          >
            Reset filters
          </button>
        </div>
      ) : (
        <>
          {lead && (() => {
            const v = view(lead);
            return (
              <Link href={v.href} className={styles.lead}>
                <span className={styles.leadImg}>
                  <Image src={lead.imageUrl} alt="" fill className={styles.cover} unoptimized sizes="(max-width: 900px) 100vw, 60vw" />
                </span>
                <span className={styles.leadBody}>
                  <span className={styles.cat}>{v.category}</span>
                  <strong className={styles.leadTitle}>{v.title}</strong>
                  <span className={styles.meta}>
                    {lead.sourceName} · {v.time}
                  </span>
                  {lead.relatedAnime?.[0] && <span className={styles.related}>About {lead.relatedAnime[0].canonicalTitle}</span>}
                </span>
              </Link>
            );
          })()}

          <div className={styles.grid}>
            {rest.map((article) => {
              const v = view(article);
              return (
                <Link key={article.id} href={v.href} className={`${styles.card} ${article.imageUrl ? '' : styles.cardText}`}>
                  {article.imageUrl && (
                    <span className={styles.cardImg}>
                      <Image src={article.imageUrl} alt="" fill className={styles.cover} unoptimized sizes="(max-width: 600px) 100vw, 25vw" />
                    </span>
                  )}
                  <span className={styles.cardBody}>
                    <span className={styles.cat}>
                      {v.category}
                      {article.trendingExplanation && (
                        <span className={styles.trending}>
                          <Flame size={10} aria-hidden="true" /> {article.trendingExplanation}
                        </span>
                      )}
                    </span>
                    <strong className={styles.cardTitle}>{v.title}</strong>
                    <span className={styles.meta}>
                      {article.sourceName} · {v.time}
                    </span>
                    {feedMeta?.isPersonalized && article.personalizationReason && activeTab === 'FOR_YOU' && (
                      <span className={styles.reason}>
                        <Sparkles size={10} aria-hidden="true" /> {article.personalizationReason}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function formatTimeAgo(dateInput: string | Date): string {
  const date = new Date(dateInput);
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMs < 60000) return 'Just now';
  if (diffHours < 1) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
