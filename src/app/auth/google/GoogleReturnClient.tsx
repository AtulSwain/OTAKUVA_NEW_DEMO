'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { EmailSignup, GoogleButton, GoogleFinish, googleErrorText } from '../../../components/auth/AuthForm';
import type { LandingPoster } from '../../../lib/landing/landingPosters';
import { LandingShell } from '../../welcome/LandingShell';
import styles from '../../welcome/welcome.module.css';

function Inner({ posters }: { posters: LandingPoster[] }) {
  const search = useSearchParams();
  const get = (k: string) => search?.get(k) ?? null;
  const errorCode = get('error');
  const error = googleErrorText(errorCode);
  const step = get('step');
  const nextParam = get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const [leaving, setLeaving] = useState(false);
  // step=code (2026-11-05): new member — Google picked the email, a code was emailed to it.
  const [codeFor, setCodeFor] = useState<{ email: string; intent: 'register' | 'creator' } | null | undefined>(undefined);
  const [codeOk, setCodeOk] = useState(false);
  useEffect(() => {
    if (step !== 'code' || error) return;
    fetch('/api/auth/email/pending', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setCodeFor(d?.pending ?? null))
      .catch(() => setCodeFor(null));
  }, [step, error]);

  // Full page load so the server renders with the session cookie just set.
  const go = (path: string) => {
    setLeaving(true);
    window.location.replace(path);
  };

  const head = error
    ? { title: 'That didn’t work', lede: error }
    : step === 'code' && !codeOk
    ? { title: 'Check your email', lede: codeFor ? `We sent a 6-digit code to ${codeFor.email}. Enter it to continue.` : 'We sent a 6-digit code to your Google email.' }
    : step === 'reset'
    ? { title: 'New password', lede: 'Google confirmed it’s you. Choose a new password.' }
    : { title: 'One last step', lede: 'Google confirmed your email. Pick your username and password.' };

  return (
    <LandingShell posters={posters} leaving={leaving} labelledBy="google-title">
      <h1 id="google-title" className={styles.title}>
        {head.title}
      </h1>
      <p className={styles.lede}>{head.lede}</p>

      <div className={styles.form}>
        {error ? (
          <GoogleButton
            intent={errorCode === 'NO_ACCOUNT' ? 'register' : 'login'}
            next="/"
            label={errorCode === 'NO_ACCOUNT' ? 'Sign up with Google' : 'Try again with Google'}
          />
        ) : step === 'code' ? (
          codeFor === undefined ? null : codeFor === null ? (
            <GoogleButton intent="register" next="/" label="Code expired — start again with Google" />
          ) : (
            <EmailSignup
              intent={codeFor.intent}
              autoFocus
              fromGoogle={{ email: codeFor.email, devCode: get('dev') }}
              onVerified={() => setCodeOk(true)}
              onDone={(res) => go(res.role === 'CREATOR' || codeFor.intent === 'creator' ? '/creator' : next)}
            />
          )
        ) : (
          <GoogleFinish compact onDone={(_res, intent) => go(intent === 'creator' ? '/creator' : next)} />
        )}
      </div>

      <Link href="/welcome" className={styles.guest}>
        Back to sign in
      </Link>
    </LandingShell>
  );
}

export function GoogleReturnClient({ posters }: { posters: LandingPoster[] }) {
  return (
    <Suspense fallback={null}>
      <Inner posters={posters} />
    </Suspense>
  );
}
