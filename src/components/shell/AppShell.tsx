'use client';

import React, { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Footer } from './Footer';
import { SearchModal } from '../ui/SearchModal';
import { QuickLogModal } from '../ui/QuickLogModal';
import { ToastProvider } from '../../context/ToastContext';
import { ToastContainer } from '../ui/ToastContainer';
import { LibraryProvider } from '../../context/LibraryContext';
import { AuthProvider } from '../../context/AuthContext';
import { AuthModal } from '../ui/AuthModal';
import { BadgeEventHost } from '../badges/BadgeEventHost';
import { VerifyPhoneBanner } from '../auth/VerifyPhoneBanner';
import { VerifyPhonePrompt } from '../auth/VerifyPhonePrompt';
import { InstallPrompt } from '../pwa/InstallPrompt';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: React.ReactNode;
}

const ShellContent: React.FC<AppShellProps> = ({ children }) => {
  const pathname = usePathname() || '';
  // Home and single-anime pages open with a full-bleed hero under the header.
  const isBleed =
    pathname === '/' ||
    (/^\/anime\/[^/]+$/.test(pathname) && !['/anime/airing', '/anime/rankings', '/anime/seasonal'].includes(pathname)) ||
    // Profiles: the banner runs edge to edge; the page constrains its own content.
    /^\/profile\/[^/]+$/.test(pathname) ||
    // Shared lists (/l/<token>): full-bleed poster card with its own glow.
    /^\/l\/[^/]+$/.test(pathname);
  // Catalog / directory pages fill the same width as the header instead of a
  // narrow centred column (owner, 2026-10-20).
  const isWide =
    !isBleed &&
    (pathname === '/anime' ||
      pathname === '/studios' ||
      // News feed lines up with the header like the homepage (clean pass, 2026-10-25).
      pathname === '/news' ||
      // Creator dashboard + community management fill the screen too (owner, 2026-10-24).
      pathname === '/creator' ||
      pathname.startsWith('/creator/communities/') ||
      ['/browse', '/top-picks', '/seasonal', '/rankings', '/artists'].some((p) => pathname === p || pathname.startsWith(`${p}/`)));
  // A single community (/community/<slug>) is its own full-screen workspace,
  // Discord-style: no site header, footer or bottom nav around it.
  // The /welcome landing page and the /control admin console are full-screen too.
  const isImmersive = /^\/community\/(?!create(?:\/|$))[^/]+\/?$/.test(pathname) || pathname === '/welcome' || pathname.startsWith('/auth/') || pathname === '/control' || pathname.startsWith('/control/');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState(false);

  // Page change: the new page fades in instead of
  // snapping in (2026-11-06). Web Animations API on the content wrapper, so
  // nothing remounts and no layout state is lost. Off for reduced motion.
  const contentRef = useRef<HTMLDivElement>(null);
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    const el = contentRef.current;
    if (!el || typeof el.animate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.animate(
      // Opacity only: a transform here would briefly re-anchor any
      // position:fixed bar inside the page (sticky action bars, sheets).
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
    );
  }, [pathname]);

  // Global Keyboard shortcut listener: Cmd+K / Ctrl+K & Cmd+L / Ctrl+L
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // "/" opens search unless the user is already typing somewhere.
        const el = e.target as HTMLElement | null;
        const typing = el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
        if (!typing) {
          e.preventDefault();
          setIsSearchOpen(true);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setIsQuickLogOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={styles.layoutRoot}>
      {isImmersive ? (
        // The community workspace renders its own <main> and navigation.
        children
      ) : (
        <>
          {/* 1. Global Dark + Grey Top Navigation Bar */}
          <Header
            onOpenSearch={() => setIsSearchOpen(true)}
            onQuickAdd={() => setIsQuickLogOpen(true)}
          />

          {/* 2. Main Content Viewport */}
          <main className={styles.contentArea}>
            <div ref={contentRef} className={isBleed ? styles.contentBleed : isWide ? `${styles.contentInner} ${styles.contentWide}` : styles.contentInner}>{children}</div>
          </main>

          {/* 3. Dark Footer */}
          <Footer />

          {/* 4. Responsive Mobile Bottom Navigation */}
          <BottomNav />
        </>
      )}

      {/* 5. Command Palette Dialog */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />

      {/* 6. Quick Watch Log Dialog */}
      <QuickLogModal
        isOpen={isQuickLogOpen}
        onClose={() => setIsQuickLogOpen(false)}
      />

      {/* 7. Authentication Modal */}
      <AuthModal />

      {/* 8. Floating Micro-interaction Toast Container */}
      <ToastContainer />

      {/* 9. Reviewer-badge unlock / milestone toasts and completion prompt */}
      <BadgeEventHost />

      {/* 10. "Verify your email" prompt for signed-in, unverified accounts */}
      <VerifyPhoneBanner />
      <VerifyPhonePrompt />
      <InstallPrompt />
    </div>
  );
};

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <ToastProvider>
      <AuthProvider>
        <LibraryProvider>
          <ShellContent>{children}</ShellContent>
        </LibraryProvider>
      </AuthProvider>
    </ToastProvider>
  );
};
