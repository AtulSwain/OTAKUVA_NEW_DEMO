'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CommunityScoreBadge } from '../rating/CommunityScoreBadge';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, X, Film, Layers, Building2, Users2, Newspaper, MessageSquareHeart, Calendar, Trophy, Bookmark, Clock, Settings, ArrowRight, CornerDownLeft, Loader2 } from 'lucide-react';
import { AnimePoster } from './AnimePoster';
import { sanitizePublicEntityName } from '../../lib/normalizers';
import { formatAnimeStatus } from '../../lib/anime/animeStatus';
import styles from './SearchModal.module.css';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandAction {
  id: string;
  label: string;
  category: 'COMMAND';
  href: string;
  icon: React.ElementType;
}

const TYPE_LABEL: Record<string, string> = { TV: 'TV', TV_SHORT: 'TV short', TV_SPECIAL: 'TV special', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special' };
const formatType = (t?: string | null) => (t ? TYPE_LABEL[t] ?? t : 'TV');

const COMMAND_ACTIONS: CommandAction[] = [
  { id: 'cmd_explore', label: 'Explore Anime Catalog', category: 'COMMAND', href: '/anime', icon: Search },
  { id: 'cmd_airing', label: 'View Airing Schedule', category: 'COMMAND', href: '/schedule', icon: Calendar },
  { id: 'cmd_collections', label: 'Curated Collections', category: 'COMMAND', href: '/collections', icon: Bookmark },
  { id: 'cmd_rankings', label: 'View All-Time Rankings', category: 'COMMAND', href: '/rankings', icon: Trophy },
  { id: 'cmd_news', label: 'Latest Anime News & Industry Stories', category: 'COMMAND', href: '/news', icon: Newspaper },
  { id: 'cmd_spaces', label: 'Anime Communities', category: 'COMMAND', href: '/community', icon: MessageSquareHeart },
  { id: 'cmd_studios', label: 'Browse Production Studios', category: 'COMMAND', href: '/studios', icon: Building2 },
  { id: 'cmd_people', label: 'Creators & Voice Cast Encyclopedia', category: 'COMMAND', href: '/artists', icon: Users2 },
  { id: 'cmd_library', label: 'Open My Library', category: 'COMMAND', href: '/library', icon: Bookmark },
  { id: 'cmd_history', label: 'View Watch History', category: 'COMMAND', href: '/history', icon: Clock },
  { id: 'cmd_settings', label: 'System Settings', category: 'COMMAND', href: '/settings', icon: Settings },
];

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose }) => {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'ANIME' | 'STUDIOS' | 'PEOPLE' | 'NEWS' | 'SPACES'>('ALL');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [data, setData] = useState<{
    anime: any[];
    studios: any[];
    people: any[];
    news: any[];
    communities: any[];
    franchises: any[];
    characters?: any[];
  }>({
    anime: [],
    studios: [],
    people: [],
    news: [],
    communities: [],
    franchises: [],
    characters: [],
  });

  const inputRef = useRef<HTMLInputElement>(null);

  // Load recent searches from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('otakuva_recent_searches');
        if (saved) {
          setRecentSearches(JSON.parse(saved).slice(0, 5));
        }
      } catch {}
    }
  }, []);

  const saveRecentSearch = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed || typeof window === 'undefined') return;
    try {
      const updated = [trimmed, ...recentSearches.filter((s) => s.toLowerCase() !== trimmed.toLowerCase())].slice(0, 5);
      setRecentSearches(updated);
      localStorage.setItem('otakuva_recent_searches', JSON.stringify(updated));
    } catch {}
  };

  const clearRecentSearches = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRecentSearches([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('otakuva_recent_searches');
    }
  };

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setQuery('');
      setActiveTab('ALL');
    }
  }, [isOpen]);

  // While open: stop the page behind from scrolling (matters on phones) and
  // hand focus back to the control that opened the search when it closes.
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [isOpen]);

  // Keep the keyboard-selected result in view.
  useEffect(() => {
    if (!isOpen) return;
    document.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, isOpen]);

  // Global Esc key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Live multi-entity search
  useEffect(() => {
    if (!isOpen) return;

    setIsLoading(true);
    let isCancelled = false;

    const timer = setTimeout(async () => {
      try {
        const q = query.trim();
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const json = await res.json();
          if (!isCancelled) {
            setData(json);
            setSelectedIndex(0);
          }
        }
      } catch (err) {
        console.error('Command search error:', err);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }, 150);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [query, isOpen]);

  // Filter entities according to activeTab
  const visibleAnime = activeTab === 'ALL' || activeTab === 'ANIME' ? data.anime : [];
  const visibleStudios = activeTab === 'ALL' || activeTab === 'STUDIOS' ? data.studios : [];
  const visiblePeople = activeTab === 'ALL' || activeTab === 'PEOPLE' ? data.people : [];
  const visibleCharacters = activeTab === 'ALL' || activeTab === 'PEOPLE' ? (data.characters || []) : [];
  const visibleNews = activeTab === 'ALL' || activeTab === 'NEWS' ? data.news : [];
  const visibleCommunities = activeTab === 'ALL' || activeTab === 'SPACES' ? data.communities : [];
  // Franchise has no dedicated tab (a small, secondary result type) — shown
  // only in the combined ALL view.
  const visibleFranchises = activeTab === 'ALL' ? (data.franchises || []) : [];

  // Build flattened selectable list for keyboard navigation
  const flatItems: Array<{ id: string; href: string }> = [];

  if (query.trim() === '' && activeTab === 'ALL') {
    COMMAND_ACTIONS.forEach((cmd) => flatItems.push({ id: cmd.id, href: cmd.href }));
  }

  visibleAnime.forEach((a) => flatItems.push({ id: `anime_${a.id}`, href: `/anime/${a.slug || a.id}` }));
  visibleStudios.forEach((s) => flatItems.push({ id: `studio_${s.id}`, href: `/studios/${s.slug || s.id}` }));
  visiblePeople.forEach((p) => flatItems.push({ id: `person_${p.id}`, href: `/people/${p.slug || p.id}` }));
  visibleCharacters.forEach((c) => flatItems.push({ id: `char_${c.id}`, href: `/character/${c.slug || c.id}` }));
  visibleNews.forEach((n) => flatItems.push({ id: `news_${n.id}`, href: `/news/${n.slug || n.id}` }));
  visibleCommunities.forEach((c) => flatItems.push({ id: `comm_${c.id}`, href: `/community/${c.slug || c.id}` }));
  visibleFranchises.forEach((f) => flatItems.push({ id: `franchise_${f.id}`, href: `/franchise/${f.slug || f.id}` }));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < flatItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : flatItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[selectedIndex]) {
        if (query.trim()) saveRecentSearch(query.trim());
        router.push(flatItems[selectedIndex].href);
        onClose();
      } else if (query.trim()) {
        saveRecentSearch(query.trim());
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
        onClose();
      }
    }
  };

  const handleItemClick = (href: string) => {
    if (query.trim()) saveRecentSearch(query.trim());
    router.push(href);
    onClose();
  };

  if (!isOpen) return null;

  const totalResultsCount =
    visibleAnime.length + visibleStudios.length + visiblePeople.length + visibleCharacters.length + visibleNews.length + visibleCommunities.length + visibleFranchises.length;

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label="Search">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Search Header & Input */}
        <div className={styles.inputRow}>
          {isLoading ? (
            <Loader2 size={20} className={styles.spinIcon} />
          ) : (
            <Search size={20} className={styles.searchIcon} />
          )}
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Search anime, studios, artists, news and spaces"
            className={styles.input}
            placeholder="Search anime, studios, news"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query ? (
            <button
              aria-label="Clear search"
              type="button"
              className={styles.clearBtn}
              onClick={() => setQuery('')}
            >
              <X size={16} />
            </button>
          ) : (
            <kbd className={styles.kbdTag}>ESC</kbd>
          )}
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
        </div>

        {/* Entity Category Filter Tabs */}
        <div className={styles.tabFilterRow}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'ALL' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('ALL')}
          >
            All
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'ANIME' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('ANIME')}
          >
            Anime {data.anime?.length > 0 ? `(${data.anime.length})` : ''}
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'STUDIOS' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('STUDIOS')}
          >
            Studios {data.studios?.length > 0 ? `(${data.studios.length})` : ''}
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'PEOPLE' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('PEOPLE')}
          >
            People {data.people?.length + (data.characters?.length ?? 0) > 0 ? `(${data.people.length + (data.characters?.length ?? 0)})` : ''}
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'NEWS' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('NEWS')}
          >
            News {data.news?.length > 0 ? `(${data.news.length})` : ''}
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'SPACES' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('SPACES')}
          >
            Spaces {data.communities?.length > 0 ? `(${data.communities.length})` : ''}
          </button>
        </div>

        {/* Results & Suggestions Scrollable Area */}
        <div className={styles.resultsContainer} role="listbox" aria-label="Search results">
          {/* Recent Searches (when query is empty) */}
          {query.trim() === '' && recentSearches.length > 0 && (
            <div className={styles.resultGroup}>
              <div className={styles.groupHeadingRow}>
                <span className={styles.groupHeading}>Recent Searches</span>
                <button type="button" className={styles.clearRecentBtn} onClick={clearRecentSearches}>
                  Clear
                </button>
              </div>
              <div className={styles.recentTagsRow}>
                {recentSearches.map((term) => (
                  <button
                    key={term}
                    type="button"
                    className={styles.recentTag}
                    onClick={() => {
                      setQuery(term);
                    }}
                  >
                    <Clock size={12} className={styles.recentIcon} />
                    <span>{term}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick Commands (when query is empty and on ALL tab) */}
          {query.trim() === '' && activeTab === 'ALL' && (
            <div className={styles.resultGroup}>
              <span className={styles.groupHeading}>Quick Commands</span>
              <div className={styles.commandsGrid}>
                {COMMAND_ACTIONS.map((cmd, idx) => {
                  const Icon = cmd.icon;
                  const isSelected = selectedIndex === idx;
                  return (
                    <div
                      key={cmd.id}
                      onClick={() => handleItemClick(cmd.href)}
                      role="option"
                      aria-selected={isSelected}
                      data-active={isSelected ? 'true' : undefined}
                      className={`${styles.commandActionItem} ${isSelected ? styles.commandActionItemActive : ''}`}
                    >
                      <div className={styles.commandIconBox}>
                        <Icon size={15} />
                      </div>
                      <span className={styles.commandLabel}>{cmd.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No results state */}
          {query.trim() !== '' && !isLoading && totalResultsCount === 0 && (
            <div className={styles.noResultsState}>
              <p className={styles.noResultsTitle}>No results found for &ldquo;{query}&rdquo;</p>
              <p className={styles.noResultsDesc}>
                Try checking for typos, searching by alternate Japanese titles, or exploring the general catalog.
              </p>
              <Link
                href={`/search?q=${encodeURIComponent(query)}`}
                onClick={onClose}
                className={styles.catalogSearchLink}
              >
                See all catalog results for &ldquo;{query}&rdquo; <ArrowRight size={13} />
              </Link>
            </div>
          )}

          {/* Group 1: Anime — the best match as a "Top result" card, then the
              other title matches, then shows related by tag/genre. */}
          {visibleAnime.length > 0 && (() => {
            const hasQuery = query.trim() !== '';
            const top = hasQuery ? visibleAnime[0] : null;
            const rest = hasQuery ? visibleAnime.slice(1) : visibleAnime;
            const matching = rest.filter((a) => a.match !== 'related');
            const related = rest.filter((a) => a.match === 'related');
            const row = (anime: any) => {
              const itemIndex = flatItems.findIndex((x) => x.id === `anime_${anime.id}`);
              const isSelected = selectedIndex === itemIndex;
              return (
                <div
                  key={anime.id}
                  onClick={() => handleItemClick(`/anime/${anime.slug || anime.id}`)}
                  role="option"
                  aria-selected={isSelected}
                  data-active={isSelected ? 'true' : undefined}
                  className={`${styles.resultItem} ${isSelected ? styles.resultItemActive : ''}`}
                >
                  <AnimePoster src={anime.posterUrl} alt={anime.title} width={36} height={50} className={styles.resultPoster} />
                  <div className={styles.resultInfo}>
                    <div className={styles.titleLine}>
                      <span className={styles.resultTitle}>{sanitizePublicEntityName(anime.title)}</span>
                      <CommunityScoreBadge animeId={anime.id} />
                    </div>
                    <div className={styles.resultMeta}>
                      <span className={styles.metaBadge}>{formatType(anime.type)}</span>
                      {anime.year && <span>{anime.year}</span>}
                    </div>
                  </div>
                  <ArrowRight size={14} className={styles.itemArrow} />
                </div>
              );
            };
            const topIndex = top ? flatItems.findIndex((x) => x.id === `anime_${top.id}`) : -1;
            const topSelected = top ? selectedIndex === topIndex : false;
            const topMeta = top
              ? [formatType(top.type), top.year, top.episodes && top.type !== 'MOVIE' ? `${top.episodes} episodes` : null, formatAnimeStatus(top.status)].filter(Boolean)
              : [];
            const topArt = top ? String(top.bannerUrl || top.posterUrl || '').replace(/"/g, '%22') : '';
            return (
              <>
                {top && (
                  <div className={styles.resultGroup}>
                    <span className={styles.groupHeading}>{top.match === 'exact' ? 'Top result' : 'Best match'}</span>
                    <div
                      onClick={() => handleItemClick(`/anime/${top.slug || top.id}`)}
                      role="option"
                      aria-selected={topSelected}
                      data-active={topSelected ? 'true' : undefined}
                      className={`${styles.topResult} ${topSelected ? styles.topResultActive : ''}`}
                    >
                      {topArt && (
                        <div
                          className={styles.topArt}
                          aria-hidden="true"
                          style={{ backgroundImage: `url("${topArt}")` }}
                          data-banner={top.bannerUrl ? 'true' : undefined}
                        />
                      )}
                      <AnimePoster src={top.posterUrl} alt={top.title} width={72} height={100} className={styles.topPoster} />
                      <div className={styles.topInfo}>
                        <span className={styles.topTitle}>{sanitizePublicEntityName(top.title)}</span>
                        <span className={styles.topMeta}>{topMeta.join(' · ')}</span>
                        <span className={styles.topBadge}>
                          <CommunityScoreBadge animeId={top.id} />
                        </span>
                      </div>
                      <span className={styles.topOpen}>
                        Open <ArrowRight size={14} />
                      </span>
                    </div>
                  </div>
                )}
                {matching.length > 0 && (
                  <div className={styles.resultGroup}>
                    <span className={styles.groupHeading}>{hasQuery ? `Anime matching “${query.trim()}”` : 'Anime'}</span>
                    {matching.map(row)}
                  </div>
                )}
                {related.length > 0 && (
                  <div className={styles.resultGroup}>
                    <span className={styles.groupHeading}>Related anime</span>
                    {related.map(row)}
                  </div>
                )}
                {hasQuery && (
                  <Link
                    href={`/search?q=${encodeURIComponent(query.trim())}`}
                    onClick={() => {
                      saveRecentSearch(query.trim());
                      onClose();
                    }}
                    className={styles.seeAllLink}
                  >
                    See all anime for &ldquo;{query.trim()}&rdquo; <ArrowRight size={13} />
                  </Link>
                )}
              </>
            );
          })()}

          {/* Group 2: Studio Results */}
          {visibleStudios.length > 0 && (
            <div className={styles.resultGroup}>
              <span className={styles.groupHeading}>Studios</span>
              {visibleStudios.map((studio) => {
                const itemIndex = flatItems.findIndex((x) => x.id === `studio_${studio.id}`);
                const isSelected = selectedIndex === itemIndex;
                return (
                  <div
                    key={studio.id}
                    onClick={() => handleItemClick(`/studios/${studio.slug || studio.id}`)}
                    role="option"
                    aria-selected={isSelected}
                    data-active={isSelected ? 'true' : undefined}
                    className={`${styles.resultItem} ${isSelected ? styles.resultItemActive : ''}`}
                  >
                    <div className={styles.resultAvatar}>
                      <Building2 size={16} />
                    </div>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{sanitizePublicEntityName(studio.name)}</span>
                      <div className={styles.resultMeta}>
                        <span className={styles.metaBadge}>Studio</span>
                        {studio.animeCount ? <span>{studio.animeCount} anime</span> : null}
                      </div>
                    </div>
                    <ArrowRight size={14} className={styles.itemArrow} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Group 3: People / Creators Results */}
          {visiblePeople.length > 0 && (
            <div className={styles.resultGroup}>
              <span className={styles.groupHeading}>People & Creators</span>
              {visiblePeople.map((person) => {
                const itemIndex = flatItems.findIndex((x) => x.id === `person_${person.id}`);
                const isSelected = selectedIndex === itemIndex;
                return (
                  <div
                    key={person.id}
                    onClick={() => handleItemClick(`/people/${person.slug || person.id}`)}
                    role="option"
                    aria-selected={isSelected}
                    data-active={isSelected ? 'true' : undefined}
                    className={`${styles.resultItem} ${isSelected ? styles.resultItemActive : ''}`}
                  >
                    <div className={styles.resultAvatar}>
                      <Users2 size={16} />
                    </div>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{sanitizePublicEntityName(person.name)}</span>
                      <div className={styles.resultMeta}>
                        <span className={styles.metaBadge}>Person</span>
                        <span>{person.primaryRole || 'Staff & Cast'}</span>
                      </div>
                    </div>
                    <ArrowRight size={14} className={styles.itemArrow} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Characters (2026-11-06) */}
          {visibleCharacters.length > 0 && (
            <div className={styles.resultGroup}>
              <span className={styles.groupHeading}>Characters</span>
              {visibleCharacters.map((c) => {
                const itemIndex = flatItems.findIndex((x) => x.id === `char_${c.id}`);
                const isSelected = selectedIndex === itemIndex;
                return (
                  <div
                    key={c.id}
                    onClick={() => handleItemClick(`/character/${c.slug || c.id}`)}
                    role="option"
                    aria-selected={isSelected}
                    data-active={isSelected ? 'true' : undefined}
                    className={`${styles.resultItem} ${isSelected ? styles.resultItemActive : ''}`}
                  >
                    <div
                      className={styles.resultAvatar}
                      style={c.imageUrl ? { backgroundImage: `url("${c.imageUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center top' } : undefined}
                    >
                      {!c.imageUrl && <Users2 size={16} />}
                    </div>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{sanitizePublicEntityName(c.name)}</span>
                      <div className={styles.resultMeta}>
                        <span className={styles.metaBadge}>Character</span>
                        {c.anime && <span>{c.anime.title}</span>}
                      </div>
                    </div>
                    <ArrowRight size={14} className={styles.itemArrow} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Group 4: Editorial & News */}
          {visibleNews.length > 0 && (
            <div className={styles.resultGroup}>
              <span className={styles.groupHeading}>News & Editorial</span>
              {visibleNews.map((news) => {
                const itemIndex = flatItems.findIndex((x) => x.id === `news_${news.id}`);
                const isSelected = selectedIndex === itemIndex;
                return (
                  <div
                    key={news.id}
                    onClick={() => handleItemClick(`/news/${news.slug || news.id}`)}
                    role="option"
                    aria-selected={isSelected}
                    data-active={isSelected ? 'true' : undefined}
                    className={`${styles.resultItem} ${isSelected ? styles.resultItemActive : ''}`}
                  >
                    <div className={styles.resultAvatar}>
                      <Newspaper size={16} />
                    </div>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{sanitizePublicEntityName(news.title)}</span>
                      <div className={styles.resultMeta}>
                        <span className={styles.metaBadge}>News</span>
                        <span>{news.category || 'Industry'}</span>
                      </div>
                    </div>
                    <ArrowRight size={14} className={styles.itemArrow} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Group 5: Spaces & Communities */}
          {visibleCommunities.length > 0 && (
            <div className={styles.resultGroup}>
              <span className={styles.groupHeading}>Spaces & Communities</span>
              {visibleCommunities.map((comm) => {
                const itemIndex = flatItems.findIndex((x) => x.id === `comm_${comm.id}`);
                const isSelected = selectedIndex === itemIndex;
                return (
                  <div
                    key={comm.id}
                    onClick={() => handleItemClick(`/community/${comm.slug || comm.id}`)}
                    role="option"
                    aria-selected={isSelected}
                    data-active={isSelected ? 'true' : undefined}
                    className={`${styles.resultItem} ${isSelected ? styles.resultItemActive : ''}`}
                  >
                    <div className={styles.resultAvatar}>
                      <MessageSquareHeart size={16} />
                    </div>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{sanitizePublicEntityName(comm.name)}</span>
                      <div className={styles.resultMeta}>
                        <span className={styles.metaBadge}>Space</span>
                        <span>{comm.memberCount || 1} members</span>
                      </div>
                    </div>
                    <ArrowRight size={14} className={styles.itemArrow} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Group 6: Franchises */}
          {visibleFranchises.length > 0 && (
            <div className={styles.resultGroup}>
              <span className={styles.groupHeading}>Franchises</span>
              {visibleFranchises.map((franchise) => {
                const itemIndex = flatItems.findIndex((x) => x.id === `franchise_${franchise.id}`);
                const isSelected = selectedIndex === itemIndex;
                return (
                  <div
                    key={franchise.id}
                    onClick={() => handleItemClick(`/franchise/${franchise.slug || franchise.id}`)}
                    role="option"
                    aria-selected={isSelected}
                    data-active={isSelected ? 'true' : undefined}
                    className={`${styles.resultItem} ${isSelected ? styles.resultItemActive : ''}`}
                  >
                    <div className={styles.resultAvatar}>
                      <Layers size={16} />
                    </div>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{sanitizePublicEntityName(franchise.name)}</span>
                      <div className={styles.resultMeta}>
                        <span className={styles.metaBadge}>Franchise</span>
                      </div>
                    </div>
                    <ArrowRight size={14} className={styles.itemArrow} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Command Center Keyboard Footer */}
        <div className={styles.footerRow}>
          <div className={styles.shortcutsList}>
            <span className={styles.shortcutItem}>
              <kbd className={styles.kbdTag}>↑↓</kbd> Navigate
            </span>
            <span className={styles.shortcutItem}>
              <kbd className={styles.kbdTag}>↵</kbd> Select
            </span>
            <span className={styles.shortcutItem}>
              <kbd className={styles.kbdTag}>ESC</kbd> Close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
