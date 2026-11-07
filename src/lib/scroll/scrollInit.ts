/**
 * Runs inline in <head> before the page paints (2026-11-05): turns off the
 * browser's automatic scroll restoration so a refresh starts at the top
 * (unless the link points at a section, e.g. #reviews). See
 * src/components/shell/ScrollReset.tsx for the full story.
 */
export const SCROLL_INIT_SCRIPT =
  "try{if('scrollRestoration' in history)history.scrollRestoration='manual';if(!location.hash)window.scrollTo(0,0)}catch(e){}";
