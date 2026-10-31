'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ThemePicker } from '../ui/ThemePicker';
import { InstallAppButton } from '../pwa/InstallPrompt';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  Search,
  Plus,
  User,
  LogOut,
  Settings,
  Bookmark,
  Clock,
  ChevronDown,
  MoreHorizontal,
  X,
  Flame,
  Calendar,
  Trophy,
  Layers,
  Building2,
  Clapperboard,
  Users2,
  FolderTree,
  Newspaper,
  Users,
  Heart,
  Star,
  MessageSquare,
  Bell,
  Home as HomeIcon,
  LayoutGrid,
  Popcorn,
  Gem,
  Award,
  TrendingUp,
  Compass,
  CalendarDays,
  PenLine,
  BarChart3,
  Palette,
  type LucideIcon,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { BROWSE_GENRES } from '../../lib/browse';
import { hasMinRole, isCreator } from '../../lib/roles';
import styles from './Header.module.css';

// Category shortcuts shown in the phone/tablet menu; each opens /browse on that list.
const MOBILE_CATEGORIES = [
  { tab: 'top100', label: 'Top 100', hint: 'Best of all time', icon: Trophy },
  { tab: 'binge', label: 'Binge-Worthy', hint: 'Easy to finish', icon: Popcorn },
  { tab: 'viewed', label: 'Most Popular', hint: 'Most followed', icon: Flame },
  { tab: 'gems', label: 'Hidden Gems', hint: 'Easy to miss', icon: Gem },
  { tab: 'movies', label: 'Best Movies', hint: 'Top films', icon: Clapperboard },
  { tab: 'awards', label: 'Award Winners', hint: 'Anime of the Year', icon: Award },
  { tab: 'choice', label: 'OTAKUVA Choice', hint: 'Our picks', icon: null },
  { tab: 'monthly', label: 'Airing Now', hint: 'This season', icon: TrendingUp },
] as const;

// Phone menu (⋯): every destination the bottom bar (Home, Explore, Schedule,
// Library, Profile) doesn't already cover.
const MOBILE_QUICK_LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/top-picks', label: 'Top Picks', icon: Trophy },
  { href: '/browse', label: 'Browse', icon: LayoutGrid },
  { href: '/seasonal', label: 'Seasonal', icon: CalendarDays },
  { href: '/rankings', label: 'Rankings', icon: BarChart3 },
  { href: '/studios', label: 'Studios', icon: Building2 },
  { href: '/artists', label: 'Creators', icon: Palette },
  { href: '/production', label: 'Production', icon: Clapperboard },
  { href: '/collections', label: 'Collections', icon: Layers },
  { href: '/news', label: 'News', icon: Newspaper },
  { href: '/articles', label: 'Articles', icon: PenLine },
  { href: '/community', label: 'Community', icon: Users },
  { href: '/discussions', label: 'Discussions', icon: MessageSquare },
];

interface HeaderProps {
  onOpenSearch: () => void;
  onQuickAdd: () => void;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const Header: React.FC<HeaderProps> = ({ onOpenSearch, onQuickAdd }) => {
  const pathname = usePathname();
  const { user, openAuthModal, logout } = useAuth();
  
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [isMegaMenuOpen, setIsMegaMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);

  const headerRef = useRef<HTMLDivElement>(null);
  const megaMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Notifications are per-user and server-owned. Fetched only for a signed-in
  // user and cleared on sign-out, so one account's tray never leaks to the next.
  const loadNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  }, [user]);

  useEffect(() => {
    loadNotifications();
    // Keep the bell current on a tab left open (e.g. a hyped show premiering,
    // 2026-10-25): refresh every 5 minutes while the tab is visible, and when
    // the member comes back to it.
    if (!user) return;
    const tick = () => {
      if (document.visibilityState === 'visible') loadNotifications();
    };
    // Every minute: a hyped show's premiere notice arrives within a minute of going live.
    const timer = window.setInterval(tick, 60 * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [loadNotifications, user]);

  // Unread OTAKUVA Chat total (DMs + anime rooms), summed client-side from
  // the same per-conversation unreadCount ChatList uses — refetched whenever
  // the user navigates so the badge doesn't go stale while reading a thread.
  useEffect(() => {
    if (!user) {
      setChatUnreadCount(0);
      return;
    }
    let cancelled = false;
    fetch('/api/conversations', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const total = (data?.conversations || []).reduce((sum: number, c: any) => sum + (c.unreadCount || 0), 0);
        setChatUnreadCount(total);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, pathname]);

  // Opening the tray marks everything read via the POST the API already exposes.
  const handleToggleNotifications = async () => {
    const opening = !isNotifOpen;
    setIsNotifOpen(opening);
    if (!opening || !user) return;

    await loadNotifications();
    if (unreadCount > 0) {
      try {
        await fetch('/api/notifications', { method: 'POST' });
        setUnreadCount(0);
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      } catch (err) {
        console.error('Failed to mark notifications read:', err);
      }
    }
  };

  // Show the shortcut that actually works on this machine (Cmd+K vs Ctrl+K).
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  // Scroll listener for sticky compacting
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Click outside to close menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (megaMenuRef.current && !megaMenuRef.current.contains(e.target as Node)) {
        setIsMegaMenuOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setIsMegaMenuOpen(false);
    setIsUserMenuOpen(false);
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const isLinkActive = (href: string) => {
    if (!pathname) return false;
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const isExploreGroupActive = ['/seasonal', '/schedule', '/rankings', '/collections'].some((p) =>
    pathname?.startsWith(p) ?? false
  );

  return (
    <header
      className={`${styles.header} ${pathname === '/' ? styles.headerHome : ''} ${isScrolled ? styles.headerScrolled : ''}`}
      ref={headerRef}
    >
      <div className={styles.headerInner}>
        {/* Left: Brand & Mobile Menu Button */}
        <div className={styles.leftGroup}>
          <button
            type="button"
            className={styles.mobileMenuBtn}
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X size={20} /> : <MoreHorizontal size={20} />}
          </button>

          <Link href="/" className={styles.brandLink} aria-label="OTAKUVA home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/otakuva-mark.png"
              srcSet="/brand/otakuva-mark.png 1x, /brand/otakuva-mark@2x.png 2x"
              alt=""
              width={44}
              height={34}
              className={styles.brandMark}
            />
            <span className={styles.brandWordmark}>OTAKUVA</span>
          </Link>
        </div>

        {/* Center: Desktop Top Navigation */}
        <nav className={styles.navlinks} aria-label="Main Navigation">
          <Link
            href="/"
            className={`${styles.navLink} ${pathname === '/' ? styles.navLinkActive : ''}`}
          >
            <HomeIcon className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Home</span>
          </Link>

          <Link
            href="/top-picks"
            className={`${styles.navLink} ${isLinkActive('/top-picks') ? styles.navLinkActive : ''}`}
          >
            <Trophy className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Top Picks</span>
          </Link>

          <Link
            href="/browse"
            className={`${styles.navLink} ${styles.navLinkMid} ${isLinkActive('/browse') ? styles.navLinkActive : ''}`}
          >
            <LayoutGrid className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Browse</span>
          </Link>

          <Link
            href="/anime"
            className={`${styles.navLink} ${styles.navLinkMid} ${isLinkActive('/anime') ? styles.navLinkActive : ''}`}
          >
            <Compass className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Explore</span>
          </Link>

          <Link
            href="/studios"
            className={`${styles.navLink} ${isLinkActive('/studios') || isLinkActive('/studio') ? styles.navLinkActive : ''}`}
          >
            <Building2 className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Studios</span>
          </Link>

          <Link
            href="/schedule"
            className={`${styles.navLink} ${isLinkActive('/schedule') ? styles.navLinkActive : ''}`}
          >
            <CalendarDays className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Schedule</span>
          </Link>

          <Link
            href="/news"
            className={`${styles.navLink} ${isLinkActive('/news') ? styles.navLinkActive : ''}`}
          >
            <Newspaper className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>News</span>
          </Link>

          <Link
            href="/articles"
            className={`${styles.navLink} ${isLinkActive('/articles') ? styles.navLinkActive : ''}`}
          >
            <PenLine className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Articles</span>
          </Link>

          <Link
            href="/community"
            className={`${styles.navLink} ${styles.navLinkMid} ${styles.navLinkWithBadge} ${isLinkActive('/community') || isLinkActive('/spaces') ? styles.navLinkActive : ''}`}
            aria-label={chatUnreadCount > 0 ? `Community, ${chatUnreadCount} unread chat messages` : 'Community'}
          >
            <Users className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Community</span>
            {chatUnreadCount > 0 && (
              <span className={styles.chatUnreadBadge}>{chatUnreadCount > 9 ? '9+' : chatUnreadCount}</span>
            )}
          </Link>

          <Link
            href="/library"
            className={`${styles.navLink} ${styles.navLinkWide} ${isLinkActive('/library') ? styles.navLinkActive : ''}`}
          >
            <Bookmark className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Library</span>
          </Link>

          <Link
            href="/profile/you"
            className={`${styles.navLink} ${styles.navLinkWide} ${isLinkActive('/profile') ? styles.navLinkActive : ''}`}
          >
            <User className={styles.navIcon} size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Profile</span>
          </Link>
        </nav>

        {/* Right: Search and profile */}
        <div className={styles.rightGroup}>
          {/* Signed in (owner, 2026-10-24): no header search — creators get a
              shortcut to their dashboard in its place, other members get
              nothing extra. Signed out: search, except on the homepage
              (its masthead has one). Ctrl/Cmd+K still opens search for all. */}
          {user && isCreator(user.role) && (
            <Link
              href={`/profile/${encodeURIComponent(user.username)}?tab=dashboard`}
              className={`${styles.creatorBtn} ${(pathname?.startsWith('/creator') || pathname === `/profile/${user.username}`) ? styles.creatorBtnActive : ''}`}
              aria-label="Creator dashboard"
              title="Creator dashboard"
            >
              <Clapperboard size={17} aria-hidden="true" />
            </Link>
          )}
          {!user && pathname !== '/' && (
            <button
              type="button"
              className={styles.searchTrigger}
              onClick={onOpenSearch}
              aria-label={`Search (${isMac ? 'Cmd' : 'Ctrl'}+K)`}
            >
              <Search size={14} />
              <span className={styles.searchLabel}>Search titles, genres, studios</span>
              <kbd className={styles.searchKbd}>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
          )}

          {/* Notification tray — where a community owner sees join requests */}
          {user && (
            <div className={styles.notifWrapper} ref={notifRef}>
              <button
                type="button"
                className={styles.notifTrigger}
                onClick={handleToggleNotifications}
                aria-expanded={isNotifOpen}
                aria-label={
                  unreadCount > 0
                    ? `Notifications, ${unreadCount} unread`
                    : 'Notifications'
                }
              >
                <Bell size={14} />
                {unreadCount > 0 && (
                  <span className={styles.notifBadge}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {isNotifOpen && (
                <div className={styles.notifDropdown}>
                  <div className={styles.notifHeader}>
                    <span>Notifications</span>
                    <span className={styles.notifHeaderMeta}>
                      {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                    </span>
                  </div>

                  {notifications.length === 0 ? (
                    <div className={styles.notifEmpty}>Nothing here yet.</div>
                  ) : (
                    <div className={styles.notifList}>
                      {notifications.map((n) =>
                        n.linkUrl ? (
                          <Link
                            key={n.id}
                            href={n.linkUrl}
                            className={styles.notifItem}
                            onClick={() => setIsNotifOpen(false)}
                          >
                            <span className={styles.notifItemTitle}>{n.title}</span>
                            {n.body && <span className={styles.notifItemBody}>{n.body}</span>}
                            <span className={styles.notifItemTime}>{relativeTime(n.createdAt)}</span>
                          </Link>
                        ) : (
                          <div key={n.id} className={styles.notifItem}>
                            <span className={styles.notifItemTitle}>{n.title}</span>
                            {n.body && <span className={styles.notifItemBody}>{n.body}</span>}
                            <span className={styles.notifItemTime}>{relativeTime(n.createdAt)}</span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {user ? (
            <div className={styles.userMenuWrapper} ref={userMenuRef}>
              <button
                type="button"
                className={styles.userTrigger}
                onClick={() => setIsUserMenuOpen((prev) => !prev)}
                aria-expanded={isUserMenuOpen}
                aria-label="User Account Menu"
              >
                <div className={styles.userAvatar}>
                  <span>{user.username.slice(0, 2).toUpperCase()}</span>
                </div>
                <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
              </button>

              {isUserMenuOpen && (
                <div className={styles.userDropdown}>
                  <Link
                    href={`/profile/${user.username || 'you'}`}
                    className={styles.dropdownLink}
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    <User size={14} />
                    <span>My Profile</span>
                  </Link>

                  <Link
                    href="/library"
                    className={styles.dropdownLink}
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    <Bookmark size={14} />
                    <span>My Library</span>
                  </Link>

                  <Link
                    href="/library?status=favorites"
                    className={styles.dropdownLink}
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    <Heart size={14} />
                    <span>Favorites</span>
                  </Link>

                  <Link
                    href="/history"
                    className={styles.dropdownLink}
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    <Clock size={14} />
                    <span>Watch History</span>
                  </Link>

                  <Link
                    href="/settings"
                    className={styles.dropdownLink}
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    <Settings size={14} />
                    <span>Settings</span>
                  </Link>

                  {/* Creator Mode: the dashboard for creators, the way in for everyone else. */}
                  <Link
                    href={isCreator(user.role) ? `/profile/${encodeURIComponent(user.username)}?tab=dashboard` : '/creator'}
                    className={styles.dropdownLink}
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    <Clapperboard size={14} />
                    <span>{isCreator(user.role) ? 'Creator dashboard' : 'Become a creator'}</span>
                  </Link>

                  {/* The owner's admin panel — only shown to ADMIN / SUPER_ADMIN accounts. */}
                  {hasMinRole(user.role, 'ADMIN') && (
                    <Link href="/control" className={styles.dropdownLink} onClick={() => setIsUserMenuOpen(false)}>
                      <ShieldCheck size={14} />
                      <span>Control center</span>
                    </Link>
                  )}

                  {/* Only shown when this device/browser can install the app. */}
                  <InstallAppButton className={styles.dropdownLink} onDone={() => setIsUserMenuOpen(false)} />

                  <div className={styles.dropdownDivider} />
                  <div className={styles.themeRow}>
                    <span className={styles.themeLabel}>Theme</span>
                    <ThemePicker compact />
                  </div>

                  <div className={styles.dropdownDivider} />

                  <button
                    type="button"
                    className={styles.dropdownLink}
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      logout();
                    }}
                    style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <LogOut size={14} />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className={styles.authBtn}
              onClick={() => openAuthModal()}
              aria-label="Sign In"
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Mobile Slide-Down Navigation Overlay */}
      {/* Portalled to <body>: the header's backdrop-filter would otherwise
          become the containing block for this fixed overlay and squash it. */}
      {isMobileMenuOpen && typeof document !== 'undefined' && createPortal(
        <div className={styles.mobileOverlay} role="dialog" aria-modal="true" aria-label="Menu">
          <nav className={styles.mobileQuickGrid} aria-label="More pages">
            {MOBILE_QUICK_LINKS.map(({ href, label, icon: Icon }) => {
              const active = isLinkActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`${styles.mobileQuick} ${active ? styles.mobileQuickActive : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <span className={styles.mobileQuickIcon} aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <span className={styles.mobileQuickLabel}>{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className={styles.mobileNavGroup}>
            <span className={styles.mobileGroupLabel}>Top Picks</span>
            <div className={styles.mobileCatGrid}>
              {MOBILE_CATEGORIES.map((cat) => (
                <Link
                  key={cat.tab}
                  href={`/top-picks?tab=${cat.tab}`}
                  className={styles.mobileCat}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <span className={styles.mobileCatIcon} aria-hidden="true">
                    {cat.icon ? (
                      <cat.icon size={18} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src="/brand/otakuva-mark.png" alt="" width={24} height={19} />
                    )}
                  </span>
                  <strong>{cat.label}</strong>
                  <span>{cat.hint}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className={styles.mobileNavGroup}>
            <span className={styles.mobileGroupLabel}>Genres</span>
            <div className={styles.mobileChipRow}>
              {BROWSE_GENRES.map((g) => (
                <Link
                  key={g}
                  href={`/anime?genre=${encodeURIComponent(g)}`}
                  className={styles.mobileChip}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {g}
                </Link>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
};
