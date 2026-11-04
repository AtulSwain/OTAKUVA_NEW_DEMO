'use client';

import Link from 'next/link';
import { GoogleButton } from '../../components/auth/AuthForm';
import { PageHead } from '../../components/ui/PageHead';
import styles from './forgot.module.css';

/**
 * Forgot password or username (2026-11-04: Google instead of SMS). Google
 * confirms the account's email; the next page shows the username and takes a
 * new password.
 */
export default function ForgotPasswordPage() {
  return (
    <div className={styles.page}>
      <PageHead kicker="Account help" title="Forgot password or username" />
      <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0 }}>Confirm it’s you with the Google account you signed up with. We’ll show your username and you can choose a new password.</p>
        <GoogleButton intent="reset" label="Verify with Google" next="/" />
      </div>
      <p className={styles.note}>
        Can’t use that Google account any more? <Link href="/support">Contact support</Link>.
      </p>
    </div>
  );
}
