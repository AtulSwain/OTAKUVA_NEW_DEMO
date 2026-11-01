'use client';

import React, { useEffect, useState } from 'react';
import { Check, Copy, LifeBuoy, Mail } from 'lucide-react';
import { SUPPORT_EMAIL, supportMailto, supportRequestMailto } from '../../lib/support';
import styles from './Footer.module.css';

/**
 * "Need a Hand?" — the support contact in the footer, under the brand line.
 * Real mailto: links only (no form, no backend); the address can be copied.
 */
export function SupportContact() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
    } catch {
      // Clipboard blocked (http, old browser): select the address so it can be copied by hand.
      const el = document.getElementById('support-email-address');
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
    <section className={styles.support} aria-labelledby="footer-support-title">
      <div className={styles.supportHead}>
        <span className={styles.supportIcon} aria-hidden="true">
          <LifeBuoy size={18} />
        </span>
        <h2 id="footer-support-title" className={styles.supportTitle}>
          Need a Hand?
        </h2>
      </div>
      <p className={styles.supportText}>
        Have a question, found something that&apos;s not working, or need assistance? We&apos;re here to help. Reach out to our
        support team and we&apos;ll do our best to assist you.
      </p>
      <div className={styles.supportEmailRow}>
        <a id="support-email-address" href={supportMailto()} className={styles.supportEmail}>
          {SUPPORT_EMAIL}
        </a>
        <button type="button" className={styles.supportCopy} onClick={copy} aria-label={copied ? 'Email address copied' : 'Copy email address'}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <span className={styles.srOnly} aria-live="polite">
          {copied ? 'Email address copied' : ''}
        </span>
      </div>
      <a href={supportRequestMailto()} className={styles.supportCta}>
        <Mail size={16} aria-hidden="true" />
        Contact Support
      </a>
    </section>
  );
}
