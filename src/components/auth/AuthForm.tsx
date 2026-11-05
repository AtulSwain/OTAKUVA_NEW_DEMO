'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, ShieldCheck, ArrowLeft, AtSign, KeyRound, Pencil, Smartphone } from 'lucide-react';
import { useAuth, type AuthResult } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PhoneOtpFlow } from './PhoneOtpFlow';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, validateUsername } from '../../lib/identity/username';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_STRENGTH_LABEL, passwordStrength, validatePassword } from '../../lib/identity/password';
import { CHANNEL_NAME_MAX, CHANNEL_URL_MAX, channelProblem } from '../../lib/creator/channelRules';
import styles from '../ui/AuthModal.module.css';
import seg from './AuthForm.module.css';
import otp from './PhoneOtpFlow.module.css';

export type AuthMode = 'login' | 'register' | 'creator';
const MODE_LABEL: Record<AuthMode, string> = { login: 'Sign In', register: 'Create Account', creator: 'Creator' };

type UsernameStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string };

const USERNAME_CHECK_DEBOUNCE_MS = 400;

/** Live "is this username free?" check, debounced, with stale responses ignored. */
function useUsernameAvailability(username: string, enabled: boolean): UsernameStatus {
  const [status, setStatus] = useState<UsernameStatus>({ kind: 'idle' });

  useEffect(() => {
    const trimmed = username.trim();
    if (!enabled || !trimmed) {
      setStatus({ kind: 'idle' });
      return;
    }
    const invalid = validateUsername(trimmed);
    if (invalid) {
      setStatus({ kind: 'unavailable', message: invalid });
      return;
    }
    setStatus({ kind: 'checking' });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/username-available?username=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) setStatus({ kind: 'error', message: data.error || 'Could not check this username.' });
        else if (data.available) setStatus({ kind: 'available' });
        else setStatus({ kind: 'unavailable', message: data.error || 'This username has been taken.' });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setStatus({ kind: 'error', message: 'Could not check this username.' });
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [username, enabled]);

  return status;
}

/** Password field with a show/hide toggle. */
function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className={seg.pwWrap}>
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        className={`${styles.input} ${seg.pwInput} ${invalid ? styles.inputBad : ''}`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        maxLength={PASSWORD_MAX_LENGTH}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="none"
      />
      <button type="button" className={seg.eye} onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'}>
        {shown ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}


/**
 * Opens once the phone is verified: choose a password and confirm it.
 * `onSubmit` gets the password; it returns the server's answer.
 */
function PasswordPanel({
  phoneLabel,
  username,
  submitLabel,
  onSubmit,
  onRestart,
  blocked = false,
  focus = true,
}: {
  phoneLabel: string;
  username?: string;
  submitLabel: string;
  onSubmit: (password: string) => Promise<AuthResult>;
  onRestart: () => void;
  /** True while something else on the form (e.g. the username) isn't ready. */
  blocked?: boolean;
  /** Focus the password box on open (off when another field comes first). */
  focus?: boolean;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = password ? validatePassword(password, username) : null;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length > 0 && !problem && confirm === password && !blocked;
  const strength = passwordStrength(password, username);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await onSubmit(password);
      if (!res.success) {
        setError(res.error || 'Something went wrong.');
        if (res.code === 'PASS_INVALID' || res.code === 'PASS_USED') onRestart();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={seg.panel} onSubmit={submit} noValidate>
      <div className={seg.verified}>
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          <strong>{phoneLabel}</strong> verified
        </span>
        <button type="button" className={seg.verifiedChange} onClick={onRestart}>
          Change
        </button>
      </div>

      <div className={styles.inputGroup}>
        <label className={styles.label} htmlFor="new-password">
          New password
        </label>
        <PasswordInput id="new-password" value={password} onChange={setPassword} placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`} autoComplete="new-password" autoFocus={focus} invalid={Boolean(problem)} />
        <div className={seg.meter} data-level={strength} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className={seg.strengthRow} aria-live="polite">
          {password ? (
            <>
              <span className={seg.strengthWord} data-level={strength}>
                {PASSWORD_STRENGTH_LABEL[strength]}
              </span>
              <span className={`${styles.fieldNote} ${problem ? styles.bad : ''}`}>
                {problem ?? (strength < 3 ? 'Longer, with UPPER + lower case, numbers and a symbol, is stronger.' : 'Great password.')}
              </span>
            </>
          ) : (
            <span className={styles.fieldNote}>{PASSWORD_MIN_LENGTH}+ characters, with a letter and a number.</span>
          )}
        </p>
      </div>

      <div className={styles.inputGroup}>
        <label className={styles.label} htmlFor="confirm-password">
          Re-enter new password
        </label>
        <PasswordInput id="confirm-password" value={confirm} onChange={setConfirm} placeholder="Type it again" autoComplete="new-password" invalid={mismatch} />
        <p className={`${styles.fieldNote} ${mismatch ? styles.bad : confirm && !mismatch ? styles.ok : ''}`} aria-live="polite">
          {mismatch ? "Passwords don't match." : confirm && confirm === password ? 'Passwords match.' : ' '}
        </p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <button type="submit" className={styles.submitBtn} disabled={!ready || busy}>
        {busy ? (
          <span className={styles.loadingSpan}>
            <Loader2 size={15} className={styles.spin} />
            <span>Saving…</span>
          </span>
        ) : (
          submitLabel
        )}
      </button>
    </form>
  );
}

// ── Google sign-in (2026-11-04, owner) ─────────────────────────────────
// Replaces phone/SMS: Google confirms the email, then a new member picks a
// username + password on /auth/google. Server: src/app/api/auth/google/**.

export type GoogleIntent = 'login' | 'register' | 'creator' | 'reset' | 'link';

/** Where to come back to after Google: this page, unless it's an auth page. */
function returnPath(): string {
  if (typeof window === 'undefined') return '/';
  const { pathname, search } = window.location;
  if (pathname.startsWith('/welcome') || pathname.startsWith('/auth') || pathname.startsWith('/forgot-password')) return '/';
  return pathname + search;
}

export function startGoogle(intent: GoogleIntent, next?: string) {
  window.location.href = `/api/auth/google?intent=${intent}&next=${encodeURIComponent(next ?? returnPath())}`;
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function GoogleButton({ intent, label, next }: { intent: GoogleIntent; label?: string; next?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={seg.googleBtn}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        startGoogle(intent, next);
      }}
    >
      {busy ? <Loader2 size={16} className={styles.spin} /> : <GoogleMark />}
      <span>{label ?? 'Continue with Google'}</span>
    </button>
  );
}

const GOOGLE_ERRORS: Record<string, string> = {
  NOT_CONFIGURED: 'Google sign-in isn’t set up on this server yet.',
  CANCELLED: 'Google sign-in was cancelled.',
  STATE_MISMATCH: 'That sign-in link expired. Please try again.',
  EMAIL_NOT_VERIFIED: 'Google hasn’t verified that email address.',
  GOOGLE_FAILED: 'Google sign-in didn’t work. Please try again.',
  NO_ACCOUNT: 'No OTAKUVA account uses that Google email. Create an account instead.',
  EMAIL_IN_USE: 'That Google email already belongs to another OTAKUVA account.',
  SIGNED_OUT: 'Sign in first, then verify your email.',
  RATE_LIMITED: 'Too many codes were sent to that email. Try again in a few minutes.',
  EMAIL_NOT_CONFIGURED: 'We can’t send email codes right now. Please try again later.',
  EMAIL_SEND_FAILED: 'We couldn’t send the code to your Gmail. Please try again.',
};

export function googleErrorText(code: string | null | undefined): string | null {
  if (!code) return null;
  return GOOGLE_ERRORS[code] ?? 'Google sign-in didn’t work. Please try again.';
}

type GooglePending = { email: string; name: string | null; intent: GoogleIntent; username: string | null };

/**
 * The page Google returns to (/auth/google): new members choose a username
 * (+ channel for creators) and a password; "forgot / change password" sets a
 * new password. Both sign this device in.
 */
export function GoogleFinish({ onDone, compact = false }: { onDone: (res: AuthResult, intent: GoogleIntent) => void; /** Card already shows a heading (landing look). */ compact?: boolean }) {
  const { registerWithGoogle, resetPasswordWithGoogle, refreshUser } = useAuth();
  const { showToast } = useToast();
  const [pending, setPending] = useState<GooglePending | null | undefined>(undefined);
  const [username, setUsername] = useState('');
  const [channelName, setChannelName] = useState('');
  const [channelUrl, setChannelUrl] = useState('');

  useEffect(() => {
    fetch('/api/auth/google/pending', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setPending(d?.pending ?? null))
      .catch(() => setPending(null));
  }, []);

  const signingUp = pending?.intent === 'register' || pending?.intent === 'creator';
  const creator = pending?.intent === 'creator';
  const usernameStatus = useUsernameAvailability(username, Boolean(signingUp));
  const channelError = creator ? channelProblem(channelName, channelUrl) : null;
  const showChannelError = Boolean(channelError && (channelName.trim() || channelUrl.trim()));

  if (pending === undefined) {
    return (
      <p className={styles.fieldNote}>
        <Loader2 size={14} className={styles.spin} /> Loading…
      </p>
    );
  }
  if (pending === null) {
    return (
      <div className={seg.stack}>
        <p className={styles.fieldNote}>Your Google sign-in expired. Please start again.</p>
        <GoogleButton intent="login" next="/" />
      </div>
    );
  }

  const restart = () => startGoogle(pending.intent === 'reset' ? 'reset' : pending.intent, '/');

  if (pending.intent === 'reset') {
    return (
      <div className={seg.stack}>
        <div>
          {!compact && <p className={seg.stepTitle}>Choose a new password</p>}
          <p className={styles.fieldNote}>
            Your username is <strong>@{pending.username}</strong>. Type your new password twice — other devices will be signed out.
          </p>
        </div>
        <PasswordPanel
          phoneLabel={pending.email}
          username={pending.username ?? undefined}
          submitLabel="Save password & sign in"
          onRestart={restart}
          onSubmit={async (pw) => {
            const res = await resetPasswordWithGoogle(pw);
            if (res.success) {
              showToast('New password saved. Other devices have been signed out.', 'success', 6000);
              onDone(res, 'reset');
            }
            return res;
          }}
        />
      </div>
    );
  }

  const create = async (pw: string): Promise<AuthResult> => {
    const res = await registerWithGoogle(username.trim(), pw);
    if (!res.success) return res;
    if (!creator) {
      showToast(`Welcome to OTAKUVA, ${username.trim()}!`, 'success');
      onDone(res, 'register');
      return res;
    }
    let role = res.role;
    try {
      const up = await fetch('/api/creator/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelName: channelName.trim(), channelUrl: channelUrl.trim() || undefined }),
      });
      if (up.ok) {
        role = 'CREATOR';
        await refreshUser();
        showToast(`Welcome to OTAKUVA, ${channelName.trim()}! Creator mode is on.`, 'success');
      } else {
        const data = await up.json().catch(() => ({}));
        showToast(`Your account is ready, but creator mode didn't turn on: ${data.error || 'try "Become a creator" from your menu.'}`, 'error', 8000);
      }
    } catch {
      showToast('Your account is ready, but creator mode didn\'t turn on. Use "Become a creator" from your menu.', 'error', 8000);
    }
    onDone({ ...res, role }, 'creator');
    return res;
  };

  return (
    <div className={seg.stack}>
      {!compact && (
        <div>
          <p className={seg.stepTitle}>{creator ? 'Set up your creator account' : 'Create your account'}</p>
          <p className={styles.fieldNote}>Choose a username and a password. You’ll sign in with these.</p>
        </div>
      )}
      <div className={styles.inputGroup}>
        <label className={styles.label} htmlFor="google-username">
          Username
        </label>
        <div className={styles.inputWithStatus}>
          <input
            id="google-username"
            type="text"
            className={`${styles.input} ${usernameStatus.kind === 'available' ? styles.inputOk : usernameStatus.kind === 'unavailable' ? styles.inputBad : ''}`}
            placeholder="e.g. otaku_collector"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={USERNAME_MAX_LENGTH}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            aria-describedby="google-username-status"
          />
          <span className={styles.statusIcon} aria-hidden="true">
            {usernameStatus.kind === 'checking' && <Loader2 size={15} className={styles.spin} />}
            {usernameStatus.kind === 'available' && <CheckCircle2 size={16} className={styles.ok} />}
            {usernameStatus.kind === 'unavailable' && <XCircle size={16} className={styles.bad} />}
          </span>
        </div>
        <p
          id="google-username-status"
          className={`${styles.fieldNote} ${usernameStatus.kind === 'available' ? styles.ok : usernameStatus.kind === 'unavailable' ? styles.bad : ''}`}
          aria-live="polite"
        >
          {usernameStatus.kind === 'available'
            ? 'Username is available.'
            : usernameStatus.kind === 'unavailable' || usernameStatus.kind === 'error'
            ? usernameStatus.message
            : usernameStatus.kind === 'checking'
            ? 'Checking…'
            : `At least ${USERNAME_MIN_LENGTH} characters: letters, numbers, _ and .`}
        </p>
      </div>
      {creator && (
        <>
          <div className={styles.inputGroup}>
            <label className={styles.label} htmlFor="google-channel-name">
              Channel name
            </label>
            <input id="google-channel-name" type="text" className={styles.input} placeholder="e.g. Anime Unboxed" value={channelName} onChange={(e) => setChannelName(e.target.value)} maxLength={CHANNEL_NAME_MAX} />
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label} htmlFor="google-channel-url">
              Channel link
            </label>
            <input
              id="google-channel-url"
              type="url"
              inputMode="url"
              className={styles.input}
              placeholder="https://youtube.com/@yourchannel"
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
              maxLength={CHANNEL_URL_MAX}
              autoCapitalize="none"
              spellCheck={false}
            />
            <p className={`${styles.fieldNote} ${showChannelError ? styles.bad : ''}`} aria-live="polite">
              {showChannelError ? channelError : 'YouTube, Instagram, TikTok, X… a full https:// link.'}
            </p>
          </div>
        </>
      )}
      <PasswordPanel
        phoneLabel={pending.email}
        username={username.trim() || undefined}
        submitLabel={creator ? 'Join as creator' : 'Create Account'}
        blocked={usernameStatus.kind !== 'available' || Boolean(channelError)}
        focus={false}
        onRestart={restart}
        onSubmit={create}
      />
      <p className={seg.consent}>
        By creating an account you agree to our{' '}
        <a href="/terms" target="_blank" rel="noopener">
          Terms
        </a>{' '}
        and{' '}
        <a href="/privacy" target="_blank" rel="noopener">
          Privacy Policy
        </a>
        . Your email is never shown to anyone.
      </p>
    </div>
  );
}

/**
 * Email sign-up (2026-11-04, owner): email → 6-digit code by email → then the
 * same username + password step as Google (GoogleFinish), and a welcome email.
 */
export function EmailSignup({
  intent,
  autoFocus,
  onDone,
  onVerified,
  fromGoogle,
}: {
  intent: 'register' | 'creator';
  autoFocus?: boolean;
  onDone: (res: AuthResult) => void;
  onVerified?: () => void;
  /** After "Sign up with Google" (2026-11-05): Google picked this email and a code was already sent to it. */
  fromGoogle?: { email: string; devCode?: string | null };
}) {
  const { showToast } = useToast();
  const [step, setStep] = useState<'email' | 'code' | 'finish'>(fromGoogle ? 'code' : 'email');
  const [email, setEmail] = useState(fromGoogle?.email ?? '');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(fromGoogle?.devCode ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(fromGoogle ? 30 : 0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/email/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), intent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not send the code.');
        return;
      }
      setDevCode(typeof data.devCode === 'string' ? data.devCode : null);
      setCode('');
      setStep('code');
      setCooldown(30);
      showToast(`Code sent to ${data.email || email.trim()}`, 'success');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || code.trim().length !== 6) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/email/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'That code didn’t work.');
        if (data.code === 'CODE_EXPIRED' && !fromGoogle) setStep('email');
        return;
      }
      setStep('finish');
      onVerified?.();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'finish') return <GoogleFinish compact onDone={(res) => onDone(res)} />;

  const stepState = (n: number) => {
    const cur = step === 'email' ? 1 : 2;
    return { 'data-on': cur === n ? 'true' : undefined, 'data-done': cur > n ? 'true' : undefined };
  };

  return (
    <div className={seg.stack}>
      <ol className={seg.steps} aria-label="Steps">
        <li {...stepState(1)}>{fromGoogle ? 'Google' : 'Email'}</li>
        <li {...stepState(2)}>Code</li>
        <li {...stepState(3)}>Username &amp; password</li>
      </ol>

      {step === 'email' ? (
        <form className={seg.stack} onSubmit={sendCode} noValidate>
          <div className={styles.inputGroup}>
            <label className={styles.label} htmlFor="signup-email">
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              inputMode="email"
              className={styles.input}
              placeholder="you@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus={autoFocus}
            />
            <p className={styles.fieldNote}>We’ll email you a 6-digit code.</p>
          </div>
          {error && <div className={styles.errorBox}>{error}</div>}
          <button type="submit" className={styles.submitBtn} disabled={busy || !email.includes('@')}>
            {busy ? (
              <span className={styles.loadingSpan}>
                <Loader2 size={15} className={styles.spin} />
                <span>Sending…</span>
              </span>
            ) : (
              'Send code'
            )}
          </button>
        </form>
      ) : (
        <form className={seg.stack} onSubmit={verify} noValidate>
          <div className={styles.inputGroup}>
            <label className={styles.label} htmlFor="signup-code">
              Code sent to {email.trim()}
            </label>
            <input
              id="signup-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className={`${styles.input} ${seg.codeInput}`}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              autoFocus
            />
            <p className={styles.fieldNote}>
              {devCode ? (
                <>
                  Email isn’t set up on this computer — your code is <strong>{devCode}</strong>.
                </>
              ) : (
                'Check your inbox (and spam). The code expires in 10 minutes.'
              )}
            </p>
          </div>
          {error && <div className={styles.errorBox}>{error}</div>}
          <button type="submit" className={styles.submitBtn} disabled={busy || code.length !== 6}>
            {busy ? (
              <span className={styles.loadingSpan}>
                <Loader2 size={15} className={styles.spin} />
                <span>Checking…</span>
              </span>
            ) : (
              'Verify code'
            )}
          </button>
          <div className={seg.codeLinks}>
            {fromGoogle ? (
              <button type="button" className={seg.altLink} onClick={() => startGoogle(intent, '/')}>
                Use another Google account
              </button>
            ) : (
              <button type="button" className={seg.altLink} onClick={() => { setStep('email'); setError(null); }}>
                Change email
              </button>
            )}
            <button type="button" className={seg.altLink} onClick={() => sendCode()} disabled={cooldown > 0 || busy}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Back from "Continue with Gmail" (2026-11-05, owner): the Create Account tab
 * opens on the code box for the Gmail Google returned. If the code cookie is
 * gone (expired / another browser), it falls back to the normal email form.
 */
function GmailPendingSignup({
  intent,
  devCode,
  onDone,
  onVerified,
}: {
  intent: 'register' | 'creator';
  devCode?: string | null;
  onDone: (res: AuthResult) => void;
  onVerified?: () => void;
}) {
  const [pending, setPending] = useState<{ email: string; intent: 'register' | 'creator' } | null | undefined>(undefined);
  useEffect(() => {
    fetch('/api/auth/email/pending', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setPending(d?.pending ?? null))
      .catch(() => setPending(null));
  }, []);
  if (pending === undefined) {
    return (
      <p className={styles.fieldNote}>
        <Loader2 size={14} className={styles.spin} /> Loading…
      </p>
    );
  }
  if (!pending) return <EmailSignup intent={intent} onDone={onDone} onVerified={onVerified} />;
  return <EmailSignup intent={pending.intent} autoFocus fromGoogle={{ email: pending.email, devCode }} onDone={onDone} onVerified={onVerified} />;
}

/**
 * Forgot / change password (2026-11-02, owner): mobile number → SMS code →
 * new password typed twice (strength meter: Very weak / Moderate / Strong).
 * Used from the sign-in form and from Settings. Saving signs this device
 * in and signs every other device out (passwordChangedAt).
 */
export function PasswordResetFlow({
  autoFocus,
  onDone,
  onNoAccount,
  title = 'Reset your password',
  note = 'Enter the mobile number on your account. We’ll text you a code, then you choose a new password.',
  submitLabel = 'Save password & sign in',
}: {
  autoFocus?: boolean;
  onDone?: (res: AuthResult) => void;
  onNoAccount?: () => void;
  title?: string;
  note?: string;
  submitLabel?: string;
}) {
  const { verifyPhoneCode, resetPasswordWithPhone } = useAuth();
  const { showToast } = useToast();
  const [verified, setVerified] = useState<{ pass: string; label: string } | null>(null);
  const [flowKey, setFlowKey] = useState(0);
  const [otpStep, setOtpStep] = useState<'phone' | 'code'>('phone');
  const restart = () => {
    setVerified(null);
    setOtpStep('phone');
    setFlowKey((k) => k + 1);
  };
  const step = verified ? 3 : otpStep === 'code' ? 2 : 1;
  const stepState = (n: number) => ({ 'data-on': step === n ? 'true' : undefined, 'data-done': step > n ? 'true' : undefined });

  const verify = async (phone: string, country: string, code: string): Promise<AuthResult> => {
    const res = await verifyPhoneCode('reset', phone, country, code);
    if (res.success && res.pass) setVerified({ pass: res.pass, label: phone.trim() });
    return res;
  };

  const save = async (pw: string): Promise<AuthResult> => {
    if (!verified) return { success: false, error: 'Verify your phone first.' };
    const res = await resetPasswordWithPhone(verified.pass, pw);
    if (res.success) {
      showToast('New password saved. Other devices have been signed out.', 'success', 6000);
      onDone?.(res);
    }
    return res;
  };

  return (
    <div className={seg.stack}>
      <ol className={seg.steps} aria-label="Steps">
        <li {...stepState(1)} aria-current={step === 1 ? 'step' : undefined}>Mobile number</li>
        <li {...stepState(2)} aria-current={step === 2 ? 'step' : undefined}>SMS code</li>
        <li {...stepState(3)} aria-current={step === 3 ? 'step' : undefined}>New password</li>
      </ol>
      <div>
        <p className={seg.stepTitle}>{title}</p>
        <p className={styles.fieldNote}>{verified ? 'Type your new password twice.' : step === 2 ? 'Type the 6-digit code we texted you.' : note}</p>
      </div>
      {!verified ? (
        <PhoneOtpFlow
          key={`reset-${flowKey}`}
          purpose="reset"
          submitLabel="Verify code"
          autoFocus={autoFocus}
          onSubmitCode={verify}
          onStepChange={setOtpStep}
          onErrorCode={(code) => {
            if (code === 'PHONE_NOT_REGISTERED') onNoAccount?.();
          }}
        />
      ) : (
        <PasswordPanel phoneLabel={verified.label} submitLabel={submitLabel} onSubmit={save} onRestart={restart} />
      )}
    </div>
  );
}

/** New username typed twice, with the live availability check. */
function UsernamePanel({
  accountLabel,
  currentUsername,
  onSubmit,
  onRestart,
}: {
  accountLabel: string;
  currentUsername?: string;
  onSubmit: (username: string) => Promise<AuthResult>;
  onRestart: () => void;
}) {
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useUsernameAvailability(name, true);
  const same = Boolean(currentUsername) && name.trim() === currentUsername;
  const mismatch = confirm.length > 0 && confirm.trim() !== name.trim();
  const ready = status.kind === 'available' && !same && confirm.trim() === name.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await onSubmit(name.trim());
      if (!res.success) {
        setError(res.error || 'Something went wrong.');
        if (res.code === 'PASS_INVALID') onRestart();
      }
    } finally {
      setBusy(false);
    }
  };

  const bad = same || status.kind === 'unavailable' || status.kind === 'error';
  const good = status.kind === 'available' && !same;
  const note = same
    ? 'That is already your username.'
    : status.kind === 'available'
    ? 'Username is available.'
    : status.kind === 'unavailable' || status.kind === 'error'
    ? status.message
    : status.kind === 'checking'
    ? 'Checking…'
    : `At least ${USERNAME_MIN_LENGTH} characters: letters, numbers, _ and .`;

  return (
    <form className={seg.panel} onSubmit={submit} noValidate>
      <div className={seg.verified}>
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          <strong>{accountLabel}</strong> verified
        </span>
        <button type="button" className={seg.verifiedChange} onClick={onRestart}>
          Start over
        </button>
      </div>
      <div className={styles.inputGroup}>
        <label className={styles.label} htmlFor="new-username">
          New username
        </label>
        <div className={styles.inputWithStatus}>
          <input
            id="new-username"
            type="text"
            className={`${styles.input} ${good ? styles.inputOk : bad ? styles.inputBad : ''}`}
            placeholder="e.g. otaku_collector"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={USERNAME_MAX_LENGTH}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
          <span className={styles.statusIcon} aria-hidden="true">
            {status.kind === 'checking' && <Loader2 size={15} className={styles.spin} />}
            {good && <CheckCircle2 size={16} className={styles.ok} />}
            {bad && <XCircle size={16} className={styles.bad} />}
          </span>
        </div>
        <p className={`${styles.fieldNote} ${good ? styles.ok : bad ? styles.bad : ''}`} aria-live="polite">
          {note}
        </p>
      </div>
      <div className={styles.inputGroup}>
        <label className={styles.label} htmlFor="confirm-username">
          Re-enter new username
        </label>
        <input
          id="confirm-username"
          type="text"
          className={`${styles.input} ${mismatch ? styles.inputBad : ''}`}
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          maxLength={USERNAME_MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className={`${styles.fieldNote} ${mismatch ? styles.bad : confirm && !mismatch ? styles.ok : ''}`} aria-live="polite">
          {mismatch ? "Usernames don't match." : confirm && !mismatch ? 'Usernames match.' : ' '}
        </p>
      </div>
      {error && <div className={styles.errorBox}>{error}</div>}
      <button type="submit" className={styles.submitBtn} disabled={!ready || busy}>
        {busy ? (
          <span className={styles.loadingSpan}>
            <Loader2 size={15} className={styles.spin} />
            <span>Saving…</span>
          </span>
        ) : (
          'Save username & sign in'
        )}
      </button>
    </form>
  );
}

const RESEND_SEC = 30;

/** Username → code texted to that account's number (shown masked) → code. */
function UsernameCodeStep({
  autoFocus,
  onVerified,
  onStepChange,
}: {
  autoFocus?: boolean;
  onVerified: (v: { pass: string; username: string; maskedPhone?: string }) => void;
  onStepChange: (step: 'phone' | 'code') => void;
}) {
  const { requestOtp, verifyResetCode } = useAuth();
  const [username, setUsername] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [mockCode, setMockCode] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);
  useEffect(() => {
    onStepChange(sentTo ? 'code' : 'phone');
  }, [sentTo, onStepChange]);

  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await requestOtp({ purpose: 'reset', username: username.trim() });
      if (!res.success) {
        setError(res.error || 'Could not send the code.');
        return;
      }
      setSentTo(res.maskedPhone ?? 'your mobile number');
      setMockCode(res.mockCode ?? null);
      setDevMode(res.devMode === true);
      setCode(res.mockCode ?? '');
      setResendIn(RESEND_SEC);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await verifyResetCode({ username: username.trim() }, code);
      if (!res.success || !res.pass) {
        setError(res.error || "That code didn't work.");
        return;
      }
      onVerified({ pass: res.pass, username: res.username ?? username.trim(), maskedPhone: res.maskedPhone });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={otp.flow}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        void (sentTo ? verify() : send());
      }}
    >
      {!sentTo ? (
        <div className={otp.group}>
          <label className={otp.label} htmlFor="recover-username">
            Username
          </label>
          <input
            id="recover-username"
            type="text"
            className={otp.input}
            placeholder="your_username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={autoFocus}
          />
          <p className={otp.hint}>We&apos;ll text a code to the mobile number on this account.</p>
        </div>
      ) : (
        <div className={otp.group}>
          <div className={otp.sentRow}>
            <span className={otp.sentTo}>
              Code sent to <strong>{sentTo}</strong>
            </span>
            <button
              type="button"
              className={otp.linkBtn}
              onClick={() => {
                setSentTo(null);
                setError(null);
              }}
            >
              <Pencil size={11} aria-hidden="true" /> Change
            </button>
          </div>
          <label className={otp.label} htmlFor="recover-code">
            Verification code
          </label>
          <input
            id="recover-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className={`${otp.input} ${otp.codeInput}`}
            placeholder="••••••"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus
          />
          {mockCode ? (
            <p className={otp.devNote}>
              Test mode: no SMS was sent. Your code is <strong>{mockCode}</strong> (filled in for you).
            </p>
          ) : devMode ? (
            <p className={otp.devNote}>Development mode: no SMS was sent. The code is in the server log.</p>
          ) : null}
          <button type="button" className={otp.linkBtn} disabled={resendIn > 0 || busy} onClick={() => void send()}>
            {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
          </button>
        </div>
      )}
      {error && (
        <div className={otp.error} role="alert">
          {error}
        </div>
      )}
      <button type="submit" className={otp.submit} disabled={busy || (sentTo ? code.length !== 6 : !username.trim())}>
        {busy ? (
          <span className={otp.loading}>
            <Loader2 size={15} className={otp.spin} aria-hidden="true" />
            <span>{sentTo ? 'Verifying…' : 'Sending…'}</span>
          </span>
        ) : sentTo ? (
          'Verify code'
        ) : (
          'Send code'
        )}
      </button>
    </form>
  );
}

/**
 * Forgot password or username (2026-11-03, owner):
 *   1 Account — your username, or (forgot it?) your mobile number
 *   2 Code    — SMS to the number on the account
 *   3 Reset   — choose Reset username / Reset password, type it twice
 * Saving signs this device in. A new password also signs every other
 * device out (passwordChangedAt); a new username doesn't.
 */
export function AccountRecoveryFlow({
  autoFocus,
  onDone,
  onNoAccount,
}: {
  autoFocus?: boolean;
  onDone?: (res: AuthResult) => void;
  onNoAccount?: () => void;
}) {
  const { verifyResetCode, resetPasswordWithPhone, resetUsernameWithPhone } = useAuth();
  const { showToast } = useToast();
  const [by, setBy] = useState<'username' | 'phone'>('username');
  const [verified, setVerified] = useState<{ pass: string; username: string; maskedPhone?: string } | null>(null);
  const [choice, setChoice] = useState<'username' | 'password' | null>(null);
  const [otpStep, setOtpStep] = useState<'phone' | 'code'>('phone');
  const [flowKey, setFlowKey] = useState(0);

  const restart = () => {
    setVerified(null);
    setChoice(null);
    setOtpStep('phone');
    setFlowKey((k) => k + 1);
  };
  const step = verified ? 3 : otpStep === 'code' ? 2 : 1;
  const stepState = (n: number) => ({ 'data-on': step === n ? 'true' : undefined, 'data-done': step > n ? 'true' : undefined });

  const verifyByPhone = async (phone: string, country: string, code: string): Promise<AuthResult> => {
    const res = await verifyResetCode({ phone, country }, code);
    if (res.success && res.pass) setVerified({ pass: res.pass, username: res.username ?? '', maskedPhone: res.maskedPhone });
    return res;
  };

  const savePassword = async (pw: string): Promise<AuthResult> => {
    if (!verified) return { success: false, error: 'Verify your phone first.' };
    const res = await resetPasswordWithPhone(verified.pass, pw);
    if (res.success) {
      showToast('New password saved. Other devices have been signed out.', 'success', 6000);
      onDone?.(res);
    }
    return res;
  };

  const saveUsername = async (name: string): Promise<AuthResult> => {
    if (!verified) return { success: false, error: 'Verify your phone first.' };
    const res = await resetUsernameWithPhone(verified.pass, name);
    if (res.success) {
      showToast(`Your username is now @${name}.`, 'success', 6000);
      onDone?.(res);
    }
    return res;
  };

  const accountLabel = verified?.username ? `@${verified.username}` : verified?.maskedPhone ?? 'Your account';

  return (
    <div className={seg.stack}>
      <ol className={seg.steps} aria-label="Steps">
        <li {...stepState(1)} aria-current={step === 1 ? 'step' : undefined}>Account</li>
        <li {...stepState(2)} aria-current={step === 2 ? 'step' : undefined}>SMS code</li>
        <li {...stepState(3)} aria-current={step === 3 ? 'step' : undefined}>Reset</li>
      </ol>

      {!verified && (
        <>
          <div>
            <p className={seg.stepTitle}>Forgot your password or username?</p>
            <p className={styles.fieldNote}>
              {step === 2
                ? 'Type the 6-digit code we texted you.'
                : by === 'username'
                ? 'Enter your username and we’ll text a code to the number on your account.'
                : 'Enter the mobile number you registered with.'}
            </p>
          </div>
          {by === 'username' ? (
            <UsernameCodeStep key={`u-${flowKey}`} autoFocus={autoFocus} onVerified={setVerified} onStepChange={setOtpStep} />
          ) : (
            <PhoneOtpFlow
              key={`p-${flowKey}`}
              purpose="reset"
              submitLabel="Verify code"
              autoFocus
              onSubmitCode={verifyByPhone}
              onStepChange={setOtpStep}
              onErrorCode={(code) => {
                if (code === 'PHONE_NOT_REGISTERED') onNoAccount?.();
              }}
            />
          )}
          {step === 1 && (
            <button
              type="button"
              className={seg.altLink}
              onClick={() => {
                setBy((b) => (b === 'username' ? 'phone' : 'username'));
                setFlowKey((k) => k + 1);
              }}
            >
              {by === 'username' ? (
                <>
                  <Smartphone size={14} aria-hidden="true" /> Forgot your username? Use your mobile number
                </>
              ) : (
                <>
                  <AtSign size={14} aria-hidden="true" /> Remember your username? Use it instead
                </>
              )}
            </button>
          )}
        </>
      )}

      {verified && !choice && (
        <div className={seg.panel}>
          <div className={seg.verified}>
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              {verified.username ? (
                <>
                  Your username is <strong>@{verified.username}</strong>
                </>
              ) : (
                <>
                  <strong>{accountLabel}</strong> verified
                </>
              )}
            </span>
            <button type="button" className={seg.verifiedChange} onClick={restart}>
              Start over
            </button>
          </div>
          <p className={seg.stepTitle}>What would you like to reset?</p>
          <div className={seg.choiceGrid}>
            <button type="button" className={seg.choice} onClick={() => setChoice('username')}>
              <AtSign size={20} aria-hidden="true" />
              <span className={seg.choiceTitle}>Reset username</span>
              <span className={seg.choiceNote}>Pick a new name. Your password stays the same.</span>
            </button>
            <button type="button" className={seg.choice} onClick={() => setChoice('password')}>
              <KeyRound size={20} aria-hidden="true" />
              <span className={seg.choiceTitle}>Reset password</span>
              <span className={seg.choiceNote}>Choose a new password. Other devices get signed out.</span>
            </button>
          </div>
        </div>
      )}

      {verified && choice && (
        <>
          <button type="button" className={seg.back} onClick={() => setChoice(null)}>
            <ArrowLeft size={14} aria-hidden="true" /> Choose something else
          </button>
          {choice === 'username' ? (
            <UsernamePanel accountLabel={accountLabel} currentUsername={verified.username} onSubmit={saveUsername} onRestart={restart} />
          ) : (
            <PasswordPanel phoneLabel={accountLabel} username={verified.username} submitLabel="Save password & sign in" onSubmit={savePassword} onRestart={restart} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The sign-in / sign-up form, shared by the AuthModal pop-up and the
 * /welcome landing page. Since 2026-11-04 (owner) there is no phone/SMS:
 *   Sign In        — username + password, or "Continue with Google"
 *   Create Account — "Continue with Google" (verifies the email) → on
 *                    /auth/google: username + password
 *   Creator        — same, plus channel name + link there, then the creator
 *                    upgrade (POST /api/creator/upgrade)
 *   Forgot         — Google confirms the email → new password (username shown)
 */
export function AuthForm({
  mode,
  onModeChange,
  onSignedIn,
  autoFocus = true,
  footer,
  modes = ['login', 'register'],
  segmented = false,
  gmailSignup = null,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  /** Runs after a successful sign-in or sign-up. */
  onSignedIn?: (res: AuthResult) => void;
  autoFocus?: boolean;
  /** Rendered at the end of the form (e.g. the modal's "Continue Exploring"). */
  footer?: React.ReactNode;
  /** Which tabs to offer. "creator" = normal sign-up + the existing creator upgrade. */
  modes?: AuthMode[];
  /** Pill tabs with a sliding highlight (landing page). */
  segmented?: boolean;
  /** Came back from "Continue with Gmail": open on the code box (dev: the code, when email isn't set up). */
  gmailSignup?: { devCode?: string | null } | null;
}) {
  const { loginWithPassword } = useAuth();
  const { showToast } = useToast();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  // Switching tabs leaves the Gmail code step (it stays valid; the form can be reopened from Gmail).
  const [gmailDismissed, setGmailDismissed] = useState(false);

  const signingUp = mode === 'register' || mode === 'creator';

  const switchMode = (next: AuthMode) => {
    setForgot(false);
    setEmailVerified(false);
    setGmailDismissed(true);
    setLoginError(null);
    onModeChange(next);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setLoginError(null);
    setSubmitting(true);
    try {
      const res = await loginWithPassword(identifier.trim(), password);
      if (res.gate) return; // control-center key: the browser is leaving for /control
      if (!res.success) {
        setLoginError(res.error || 'Could not sign in.');
        if (res.code === 'NO_PASSWORD') setForgot(true);
      } else {
        showToast('Signed in.', 'success');
        onSignedIn?.(res);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {segmented ? (
        <div className={seg.segment} role="tablist" style={{ ['--count' as string]: modes.length, ['--index' as string]: Math.max(0, modes.indexOf(mode)) }}>
          <span className={seg.thumb} aria-hidden="true" />
          {modes.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? seg.tabOn : seg.tab} onClick={() => (mode !== m || forgot) && switchMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.tabs}>
          {modes.map((m) => (
            <button key={m} type="button" className={`${styles.tabBtn} ${mode === m ? styles.tabBtnActive : ''}`} onClick={() => switchMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      <div className={styles.form}>
        {mode === 'login' && !forgot && (
          <form className={seg.stack} onSubmit={handleLogin} noValidate>
            <div className={styles.inputGroup}>
              <label className={styles.label} htmlFor="login-identifier">
                Username
              </label>
              <input
                id="login-identifier"
                type="text"
                className={styles.input}
                placeholder="your_username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus={autoFocus}
              />
            </div>
            <div className={styles.inputGroup}>
              <div className={seg.labelRow}>
                <label className={styles.label} htmlFor="login-password">
                  Password
                </label>
                <button
                  type="button"
                  className={seg.forgotLink}
                  onClick={() => {
                    setForgot(true);
                    setLoginError(null);
                  }}
                >
                  Forgot password or username?
                </button>
              </div>
              <PasswordInput id="login-password" value={password} onChange={setPassword} placeholder="Your password" autoComplete="current-password" />
            </div>
            {loginError && <div className={styles.errorBox}>{loginError}</div>}
            <button type="submit" className={styles.submitBtn} disabled={submitting || !password}>
              {submitting ? (
                <span className={styles.loadingSpan}>
                  <Loader2 size={15} className={styles.spin} />
                  <span>Signing in…</span>
                </span>
              ) : (
                'Sign In'
              )}
            </button>
            <div className={seg.orRow} aria-hidden="true">
              <span>or</span>
            </div>
            <GoogleButton intent="login" label="Sign in with Google" />
          </form>
        )}

        {mode === 'login' && forgot && (
          <div className={seg.stack}>
            <button type="button" className={seg.back} onClick={() => setForgot(false)}>
              <ArrowLeft size={14} aria-hidden="true" /> Back to sign in
            </button>
            <div>
              <p className={seg.stepTitle}>Forgot password or username?</p>
              <p className={styles.fieldNote}>
                Confirm it’s you with the Google account you signed up with. We’ll show your username and you can choose a new password.
              </p>
            </div>
            <GoogleButton intent="reset" label="Verify with Google" next="/" />
          </div>
        )}

        {signingUp && (
          <div className={seg.stack}>
            {gmailSignup && !gmailDismissed ? (
              <GmailPendingSignup
                key={`gmail-${mode}`}
                intent={mode === 'creator' ? 'creator' : 'register'}
                devCode={gmailSignup.devCode}
                onDone={(res) => onSignedIn?.(res)}
                onVerified={() => setEmailVerified(true)}
              />
            ) : (
              <>
                {/* Option 1: type an email → Send code. */}
                <EmailSignup key={mode} intent={mode === 'creator' ? 'creator' : 'register'} autoFocus={autoFocus} onDone={(res) => onSignedIn?.(res)} onVerified={() => setEmailVerified(true)} />
                {!emailVerified && (
                  <>
                    <div className={seg.orRow} aria-hidden="true">
                      <span>or</span>
                    </div>
                    {/* Option 2: pick the Gmail account directly; the code then goes to it. */}
                    <GoogleButton intent={mode === 'creator' ? 'creator' : 'register'} label="Continue with Gmail" />
                  </>
                )}
              </>
            )}
            <p className={seg.consent}>
              By creating an account you agree to our{' '}
              <a href="/terms" target="_blank" rel="noopener">
                Terms
              </a>{' '}
              and{' '}
              <a href="/privacy" target="_blank" rel="noopener">
                Privacy Policy
              </a>
              . Your email is never shown to anyone.
            </p>
          </div>
        )}
        {mode === 'login' && (
          <p className={seg.consent}>
            <a href="/privacy" target="_blank" rel="noopener">
              Privacy Policy
            </a>{' '}
            ·{' '}
            <a href="/terms" target="_blank" rel="noopener">
              Terms
            </a>
          </p>
        )}
        {footer}
      </div>
    </>
  );
}
