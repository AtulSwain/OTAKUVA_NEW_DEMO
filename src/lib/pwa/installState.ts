'use client';

/**
 * "Install OTAKUVA" state, shared by the install banner and the account-menu
 * entry. Browsers fire `beforeinstallprompt` once, early, so it is captured
 * at module load and kept here for whichever button the visitor taps later.
 *
 * How each platform installs:
 *   - prompt          Chrome / Edge / Samsung on Android, Windows, macOS,
 *                     ChromeOS, Android tablets: one-tap install dialog.
 *   - ios             iPhone / iPad (any browser): Share → Add to Home Screen.
 *   - safari-mac      Safari 17+ on macOS: File → Add to Dock.
 *   - android-manual  Android browser that hasn't offered the dialog (yet):
 *                     browser menu → Install app / Add to Home screen.
 *   - installed       already running as the installed app.
 *   - unsupported     e.g. Firefox on a laptop: nothing to offer.
 */
import { useSyncExternalStore } from 'react';

export type InstallPlatform = 'prompt' | 'ios' | 'safari-mac' | 'android-manual' | 'installed' | 'unsupported';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferredPrompt: PromptEvent | null = null;
let installedNow = false;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  // Some browsers only offer installation once a service worker is active.
  if ('serviceWorker' in navigator) {
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's mini-infobar from appearing; our button shows instead.
    event.preventDefault();
    deferredPrompt = event as PromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedNow = true;
    emit();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    installedNow ||
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function detectPlatform(): InstallPlatform {
  if (typeof window === 'undefined') return 'unsupported';
  if (isStandalone()) return 'installed';
  if (deferredPrompt) return 'prompt';
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  const isIos = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (isIos) return 'ios';
  const isAndroid = /android/i.test(ua);
  if (isAndroid && !/firefox/i.test(ua)) return 'android-manual';
  const isSafariMac = /macintosh/i.test(ua) && /safari/i.test(ua) && !/chrome|chromium|edg|firefox|opr/i.test(ua);
  if (isSafariMac) return 'safari-mac';
  return 'unsupported';
}

/** Opens the browser's install dialog. Resolves true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferredPrompt;
  if (!event) return false;
  await event.prompt();
  const choice = await event.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  // A prompt event can only be used once.
  deferredPrompt = null;
  if (choice.outcome === 'accepted') installedNow = true;
  emit();
  return choice.outcome === 'accepted';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = typeof window !== 'undefined' ? window.matchMedia?.('(display-mode: standalone)') : null;
  media?.addEventListener?.('change', emit);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener?.('change', emit);
  };
}

/** Current install platform; 'unsupported' during server render. */
export function useInstallPlatform(): InstallPlatform {
  useSyncExternalStore(subscribe, () => version, () => -1);
  return typeof window === 'undefined' ? 'unsupported' : detectPlatform();
}

export const INSTALLABLE: InstallPlatform[] = ['prompt', 'ios', 'safari-mac', 'android-manual'];
