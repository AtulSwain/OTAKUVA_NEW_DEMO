'use client';

import React, { useEffect, useState } from 'react';
import { ThemePicker } from '../../components/ui/ThemePicker';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, KeyRound, LogOut, ShieldCheck, ShieldAlert, Trash2, UserRound, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { UserAvatar } from '../../components/ui/UserAvatar';
import { startGoogle } from '../../components/auth/AuthForm';
import styles from './settings.module.css';

/**
 * Account settings — only things that actually work.
 *
 * This page used to show "Spoiler Protection: Enabled", "Notifications:
 * Enabled" and a theme card as fixed labels; none of them could be changed
 * and no such preferences exist in the schema. They were removed rather
 * than faked. What's here is real: account details, profile editing, data
 * export (GET /api/account/export) and account deletion (DELETE
 * /api/account), which the Privacy Policy promised but no page exposed.
 */
export default function SettingsPage() {
  const { user, isLoading, logout, openAuthModal } = useAuth();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setHasPassword(Boolean(d?.user?.hasPassword));
      })
      .catch(() => {
        if (!cancelled) setHasPassword(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (isLoading) {
    return <div className={styles.settingsPage} aria-busy="true" />;
  }

  if (!user) {
    return (
      <div className={styles.settingsPage}>
        <header className={styles.header}>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.subtitle}>Sign in to manage your account, download your data or delete your account.</p>
        </header>
        <div>
          <button type="button" className={styles.primaryBtn} onClick={() => openAuthModal('login')}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.settingsPage}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
      </header>

      {/* Appearance (2026-10-26) — saved on this device only. */}
      <section className={styles.card} aria-labelledby="settings-theme">
        <h2 id="settings-theme" className={styles.cardTitle}>Theme</h2>
        <span className={styles.muted}>Pick the site&apos;s colours. Saved on this device.</span>
        <ThemePicker />
      </section>

      {/* Account */}
      <section className={styles.card} aria-labelledby="settings-account">
        <h2 id="settings-account" className={styles.cardTitle}>Account</h2>
        <div className={styles.accountRow}>
          <UserAvatar username={user.username} avatarUrl={user.avatarUrl} size={56} />
          <div className={styles.accountMeta}>
            <strong className={styles.accountName}>@{user.username}</strong>
            {user.email && <span className={styles.muted}>{user.email}</span>}
          </div>
        </div>

        <dl className={styles.facts}>
          <div className={styles.factRow}>
            <dt>Email</dt>
            <dd>
              {user.emailVerified ? (
                <span className={styles.verified}>
                  <ShieldCheck size={15} aria-hidden="true" /> {user.email} · verified with Google
                </span>
              ) : (
                <button type="button" className={styles.unverified} onClick={() => startGoogle('link', '/settings')} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
                  <ShieldAlert size={15} aria-hidden="true" /> Not verified — verify with Google
                </button>
              )}
            </dd>
          </div>
        </dl>

        <Link href={`/profile/${encodeURIComponent(user.username)}`} className={styles.linkRow}>
          <UserRound size={18} aria-hidden="true" />
          <span>
            <strong>Edit profile</strong>
            <span className={styles.muted}>Avatar, banner and bio are edited on your profile page.</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" className={styles.chevron} />
        </Link>
      </section>

      {/* Password (2026-11-04): Google → new password. */}
      <ChangePassword hasEmail={Boolean(user.emailVerified)} />

      {/* Data */}
      <section className={styles.card} aria-labelledby="settings-data">
        <h2 id="settings-data" className={styles.cardTitle}>Your data</h2>
        <a href="/api/account/export" className={styles.linkRow} download>
          <Download size={18} aria-hidden="true" />
          <span>
            <strong>Download my data</strong>
            <span className={styles.muted}>A JSON file with your library, ratings, reviews, posts and profile.</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" className={styles.chevron} />
        </a>
        <button type="button" className={styles.linkRow} onClick={() => logout()}>
          <LogOut size={18} aria-hidden="true" />
          <span>
            <strong>Sign out</strong>
            <span className={styles.muted}>Signs you out on this device.</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" className={styles.chevron} />
        </button>
      </section>

      <DeleteAccount hasPassword={hasPassword} hasPhone={Boolean(user.phoneMasked)} />

      <p className={styles.footNote}>
        See the <Link href="/privacy">Privacy Policy</Link> and <Link href="/community-guidelines">Community Guidelines</Link>.
      </p>
    </div>
  );
}

function ChangePassword({ hasEmail }: { hasEmail: boolean }) {
  // 2026-11-04: Google confirms it's you, then you type the new password twice
  // on /auth/google. Other devices are signed out.
  return (
    <section className={styles.card} aria-labelledby="settings-password">
      <h2 id="settings-password" className={styles.cardTitle}>Password</h2>
      <button type="button" className={styles.linkRow} onClick={() => startGoogle(hasEmail ? 'reset' : 'link', '/settings')}>
        <KeyRound size={18} aria-hidden="true" />
        <span>
          <strong>Change password</strong>
          <span className={styles.muted}>
            {hasEmail
              ? 'Confirm it’s you with Google, then type your new password twice. Other devices are signed out.'
              : 'Verify your email with Google first, then come back here.'}
          </span>
        </span>
        <ChevronRight size={18} aria-hidden="true" className={styles.chevron} />
      </button>
    </section>
  );
}

function DeleteAccount({ hasPassword, hasPhone }: { hasPassword: boolean | null; hasPhone: boolean }) {
  const router = useRouter();
  const { logout } = useAuth();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [mockCode, setMockCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownedCommunities, setOwnedCommunities] = useState<{ name: string; slug: string }[]>([]);

  // Password accounts confirm with their password; phone sign-up accounts
  // (no password) confirm with a code texted to their own number.
  const usesCode = hasPassword === false && hasPhone;

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/phone/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'reauth' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "We couldn't send the code.");
      setCodeSent(true);
      setMockCode(data.mockCode ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOwnedCommunities([]);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation, ...(usesCode ? { code } : { password }) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(data.ownedCommunities)) setOwnedCommunities(data.ownedCommunities);
        throw new Error(data.error || "We couldn't delete your account.");
      }
      showToast('Your account has been deleted.', 'success');
      await logout().catch(() => {});
      router.push('/');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    confirmation === 'DELETE' && !busy && (usesCode ? code.trim().length >= 4 : hasPassword === false || password.length > 0);

  return (
    <section className={`${styles.card} ${styles.dangerCard}`} aria-labelledby="settings-delete">
      <h2 id="settings-delete" className={styles.cardTitle}>Delete account</h2>
      <p className={styles.muted}>
        Permanently erases your account, library, ratings, reviews and posts. This can&apos;t be undone — download your data first if you want a copy.
      </p>

      {!open ? (
        <div>
          <button type="button" className={styles.dangerBtn} onClick={() => setOpen(true)}>
            <Trash2 size={16} aria-hidden="true" /> Delete my account
          </button>
        </div>
      ) : (
        <form className={styles.deleteForm} onSubmit={submit}>
          {hasPassword === null ? (
            <p className={styles.muted}>Checking how to confirm…</p>
          ) : usesCode ? (
            <div className={styles.field}>
              <label htmlFor="delete-code">Code texted to your phone</label>
              <div className={styles.inline}>
                <input
                  id="delete-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="6-digit code"
                  disabled={!codeSent}
                />
                <button type="button" className={styles.secondaryBtn} onClick={sendCode} disabled={busy}>
                  {codeSent ? 'Resend code' : 'Send code'}
                </button>
              </div>
              {mockCode && <span className={styles.muted}>Test mode code: {mockCode}</span>}
            </div>
          ) : hasPassword ? (
            <div className={styles.field}>
              <label htmlFor="delete-password">Your password</label>
              <input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          ) : null}

          <div className={styles.field}>
            <label htmlFor="delete-confirm">
              Type <strong>DELETE</strong> to confirm
            </label>
            <input id="delete-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
          </div>

          {error && (
            <div className={styles.errorBox} role="alert">
              {error}
              {ownedCommunities.length > 0 && (
                <ul>
                  {ownedCommunities.map((c) => (
                    <li key={c.slug}>
                      <Link href={`/community/${c.slug}`}>{c.name}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className={styles.inline}>
            <button type="submit" className={styles.dangerBtn} disabled={!canSubmit}>
              {busy ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={() => { setOpen(false); setError(null); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
