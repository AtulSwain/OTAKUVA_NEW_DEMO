'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Pages always open at the top (2026-11-05, owner: a refresh used to land
 * around "This season" on the homepage, and opening an anime from far down
 * the homepage opened it far down too).
 *
 * Why it happened: pages stream in section by section. The browser restored
 * the old scroll position on refresh (animated, because html has
 * scroll-behavior: smooth), and "scroll anchoring" then kept following
 * content as it was inserted, so the page drifted down. On a client-side
 * navigation the new page started a little below the top (~200px) and
 * anchoring followed the streamed sections down the same way.
 *
 * Fix: (1) SCROLL_INIT_SCRIPT (src/lib/scroll/scrollInit.ts), inline in <head>, turns off the browser's
 * automatic scroll restoration and starts at the top; (2) globals.css sets
 * overflow-anchor: none; (3) this component jumps to the top whenever the
 * path changes. Links to a section (#reviews, #episodes…) are left alone so
 * they still land on that section. Query-only changes (?tab=, filters) don't
 * scroll.
 */
export function ScrollReset() {
  const pathname = usePathname();
  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}
