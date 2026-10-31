'use client';

/**
 * "Install OTAKUVA": a banner on every page (phones, tablets and laptops)
 * plus `InstallAppButton` for the account menu. Chrome/Edge/Samsung get the
 * real one-tap install dialog; iPhone/iPad and other browsers get a short
 * how-to sheet, since they don't let a website trigger the install itself.
 * Hidden once the app is installed. Closing the banner hides it for 14 days;
 * the menu entry stays available.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Download, MoreVertical, PlusSquare, Share, X } from 'lucide-react';
import { INSTALLABLE, promptInstall, useInstallPlatform, type InstallPlatform } from '../../lib/pwa/installState';
import styles from './InstallPrompt.module.css';

const DISMISS_KEY = 'otakuva-install-dismissed-at';
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;
// Pages where a floating banner would get in the way.
const HIDDEN_ON = [/^\/control/, /^\/welcome/];

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function rememberDismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode: just hide for this visit */
  }
}

/** Step-by-step sheet for platforms without a one-tap install. */
function InstallSteps({ platform, onClose }: { platform: InstallPlatform; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const steps =
    platform === 'ios'
      ? [
          { icon: <Share size={16} />, text: <>Tap the <strong>Share</strong> button in your browser (the square with an arrow).</> },
          { icon: <PlusSquare size={16} />, text: <>Scroll down and tap <strong>Add to Home Screen</strong>.</> },
          { icon: <Download size={16} />, text: <>Tap <strong>Add</strong>. OTAKUVA appears on your home screen like an app.</> },
        ]
      : platform === 'safari-mac'
        ? [
            { icon: <Share size={16} />, text: <>In the menu bar choose <strong>File → Add to Dock</strong> (or the Share button → <strong>Add to Dock</strong>).</> },
            { icon: <Download size={16} />, text: <>Click <strong>Add</strong>. OTAKUVA opens from your Dock like an app.</> },
          ]
        : [
            { icon: <MoreVertical size={16} />, text: <>Open your browser menu (<strong>⋮</strong> at the top right).</> },
            { icon: <Download size={16} />, text: <>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</> },
            { icon: <PlusSquare size={16} />, text: <>Confirm. OTAKUVA appears on your home screen like an app.</> },
          ];

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="install-steps-title" onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        <div className={styles.sheetHead}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/app-icons/192.png" alt="" width={48} height={48} className={styles.appIcon} />
          <div>
            <h2 id="install-steps-title" className={styles.sheetTitle}>Install OTAKUVA</h2>
            <p className={styles.sheetSub}>Free · opens full screen · one tap from your home screen</p>
          </div>
        </div>
        <ol className={styles.steps}>
          {steps.map((step, i) => (
            <li key={i}>
              <span className={styles.stepIcon}>{step.icon}</span>
              <span>{step.text}</span>
            </li>
          ))}
        </ol>
        <button type="button" className={styles.done} onClick={onClose}>Got it</button>
      </div>
    </div>,
    document.body,
  );
}

/** Starts the install: the browser dialog where possible, else the how-to sheet. */
function useInstallAction() {
  const platform = useInstallPlatform();
  const [showSteps, setShowSteps] = useState(false);
  const start = async () => {
    if (platform === 'prompt') await promptInstall();
    else setShowSteps(true);
  };
  const steps = showSteps ? <InstallSteps platform={platform} onClose={() => setShowSteps(false)} /> : null;
  return { platform, start, steps };
}

export function InstallPrompt() {
  const pathname = usePathname() || '/';
  const mounted = useMounted();
  const { platform, start, steps } = useInstallAction();
  const [dismissed, setDismissed] = useState(true);

  // Read the 14-day dismissal after mount (localStorage isn't there on the server).
  useEffect(() => setDismissed(recentlyDismissed()), []);

  if (!mounted) return null;
  // Laptops only see the banner when the browser can actually install in one click.
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const offer = platform === 'prompt' || (isTouch && INSTALLABLE.includes(platform));
  if (!offer || HIDDEN_ON.some((re) => re.test(pathname))) return steps;
  if (dismissed) return steps;

  const close = () => {
    rememberDismiss();
    setDismissed(true);
  };

  return (
    <>
      <aside className={styles.prompt} aria-label="Install OTAKUVA">
        <button className={styles.closeSmall} type="button" onClick={close} aria-label="Not now">
          <X size={15} />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/app-icons/192.png" alt="" width={40} height={40} className={styles.appIcon} />
        <div className={styles.copy}>
          <strong>Install the OTAKUVA app</strong>
          <span>Full screen, faster to open, right on your home screen.</span>
        </div>
        <button type="button" className={styles.install} onClick={() => void start()}>
          <Download size={14} /> Install
        </button>
      </aside>
      {steps}
    </>
  );
}

/** "Install app" entry for menus; renders nothing when install isn't possible. */
export function InstallAppButton({ className, onDone }: { className?: string; onDone?: () => void }) {
  const mounted = useMounted();
  const { platform, start, steps } = useInstallAction();
  if (!mounted || !INSTALLABLE.includes(platform)) return steps;
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          void start().then(() => onDone?.());
        }}
        style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
      >
        <Download size={14} />
        <span>Install app</span>
      </button>
      {steps}
    </>
  );
}
