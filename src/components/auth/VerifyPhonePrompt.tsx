'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MailCheck, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { GoogleButton } from './AuthForm';
import styles from './VerifyPhonePrompt.module.css';

const EVENT = 'otakuva:verify-phone-required';

/**
 * Open the "verify your phone first" dialog from anywhere (rate/review
 * buttons, or after the API answers PHONE_NOT_VERIFIED). The server
 * enforces the rule regardless; this lets the user fix it on the spot.
 */
export function promptPhoneVerification(reason: 'rate' | 'review' | 'post' = 'rate') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { reason } }));
}

const REASON_TEXT: Record<string, string> = {
  rate: 'rate anime',
  review: 'write reviews',
  post: 'post in the community',
};

/** Mounted once (AppShell). Links and verifies a phone on the signed-in account. */
export function VerifyPhonePrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('rate');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onRequired = (e: Event) => {
      setReason((e as CustomEvent).detail?.reason || 'rate');
      setOpen(true);
    };
    window.addEventListener(EVENT, onRequired);
    return () => window.removeEventListener(EVENT, onRequired);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (open && user?.phoneVerified) close();
  }, [open, user?.phoneVerified, close]);

  if (!open || !user) return null;


  return (
    <div className={styles.overlay} onClick={close}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="verify-phone-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles.close} onClick={close} aria-label="Close">
          <X size={18} />
        </button>

        <div className={styles.iconWrap} aria-hidden="true">
          <span className={styles.ring} />
          <MailCheck size={30} className={styles.icon} />
        </div>

        <h2 id="verify-phone-title" className={styles.title}>
          Verify your email first
        </h2>
        <p className={styles.text}>
          To {REASON_TEXT[reason] ?? REASON_TEXT.rate}, confirm your email with Google. Each email can back only one
          account, which keeps ratings fair.
        </p>

        <div className={styles.flowWrap}>
          <GoogleButton intent="link" label="Verify with Google" />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={close}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
