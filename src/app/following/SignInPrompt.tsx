'use client';

import { useAuth } from '../../context/AuthContext';
import styles from './following.module.css';

export function SignInPrompt() {
  const { openAuthModal } = useAuth();
  return (
    <div className={styles.empty}>
      <p>Sign in to see what the people you follow are watching and writing.</p>
      <button type="button" className={styles.cta} onClick={() => openAuthModal('login')}>
        Sign in
      </button>
    </div>
  );
}
