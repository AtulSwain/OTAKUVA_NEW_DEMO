/**
 * Trailer links (2026-11-01, owner): an anime's official trailer plays inside
 * OTAKUVA (embedded player in TrailerModal), never by sending the viewer off
 * to YouTube. Only a trailer the provider recorded for that exact anime is
 * used — no search-based stand-ins. No trailer → the page says so.
 *
 * Pure: safe to import from client components.
 */
import { youtubeVideoId } from './heroArt';

/** Canonical link for a provider's trailer record ({ site, id }), or null. */
export function providerTrailerUrl(site?: string | null, id?: string | null): string | null {
  if (!id || !site) return null;
  const s = site.toLowerCase();
  if (s === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  if (s === 'dailymotion' && /^[A-Za-z0-9]+$/.test(id)) return `https://www.dailymotion.com/video/${id}`;
  return null;
}

function dailymotionVideoId(url: string): string | null {
  const m = url.match(/(?:dailymotion\.com\/(?:embed\/)?video\/|dai\.ly\/)([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

/**
 * Embedded-player address for a stored trailer link, or null when it isn't a
 * link we can play in-page. YouTube uses the privacy-enhanced domain;
 * `playsinline` keeps it in the page on iPhones instead of going fullscreen.
 */
export function trailerEmbedUrl(url?: string | null): string | null {
  if (typeof url !== 'string' || !url) return null;
  const yt = youtubeVideoId(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  const dm = dailymotionVideoId(url);
  if (dm) return `https://www.dailymotion.com/embed/video/${dm}?autoplay=1`;
  return null;
}
