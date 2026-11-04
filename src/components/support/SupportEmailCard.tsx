'use client';

import React, { useEffect, useState } from 'react';
import { Check, Copy, Mail } from 'lucide-react';
import { SUPPORT_EMAIL, supportMailto, supportRequestMailto } from '../../lib/support';
import styles from './SupportEmailCard.module.css';

/**
 * The support address with Copy + "Contact Support" (a pre-addressed email).
 * mailto: links only — no form, no backend. Moved off the footer onto
 * /support and /about (2026-11-03, owner).
 */
export function SupportEmailCard({
  title = 'Email support',
  email = SUPPORT_EMAIL,
  ctaLabel = 'Contact Support',
  ctaHref,
  id = 'support-email-address',
}: {
  title?: string;
  /** Another address (e.g. the business one); defaults to support. */
  email?: string;
  ctaLabel?: string;
  ctaHref?: string;
  id?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
    } catch {
      // Clipboard blocked (http, old browser): select the address so it can be copied by hand.
      const el = document.getElementById(id);
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  return (
    <div className={styles.card}>
      <span className={styles.icon} aria-hidden="true">
        <Mail size={18} />
      </span>
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        <div className={styles.row}>
          <a id={id} href={email === SUPPORT_EMAIL ? supportMailto() : `mailto:${email}`} className={styles.email}>
            {email}
          </a>
          <button type="button" className={styles.copy} onClick={copy} aria-label={copied ? 'Email address copied' : 'Copy email address'}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <span className={styles.srOnly} aria-live="polite">
            {copied ? 'Email address copied' : ''}
          </span>
        </div>
      </div>
      <a href={ctaHref ?? supportRequestMailto()} className={styles.cta}>
        {ctaLabel}
      </a>
    </div>
  );
}
