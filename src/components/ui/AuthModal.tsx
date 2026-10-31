'use client';

import React from 'react';
import { X, Bookmark, Star, Users, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth, type AuthResult } from '../../context/AuthContext';
import { isCreator } from '../../lib/roles';
import { AuthForm } from '../auth/AuthForm';
import styles from './AuthModal.module.css';

/** The sign-in pop-up. The form itself is `AuthForm` (shared with /welcome). */
export const AuthModal: React.FC = () => {
  const { showAuthModal, authModalMode, intentMessage, closeAuthModal, openAuthModal } = useAuth();
  const router = useRouter();

  if (!showAuthModal) return null;

  // One sign-in for everyone (owner, 2026-10-24: no user/creator choice
  // here). A creator account opens its dashboard afterwards — unless the
  // window was opened for an action (rate, follow…), which then continues.
  // Becoming a creator is the explicit step on /creator.
  const afterSignIn = (res: AuthResult) => {
    if (!intentMessage && isCreator(res.role)) {
      router.push('/creator');
      return;
    }
    // Re-render the server parts of the current page (homepage welcome,
    // "You are tracking", …) with the new session instead of leaving the
    // signed-out version on screen until a manual refresh.
    router.refresh();
  };

  return (
    <div className={styles.overlay} onClick={closeAuthModal} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleBox}>
            <span className={styles.brandTag}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/otakuva-mark.png" alt="" width={36} height={28} className={styles.brandMark} />
              OTAKUVA
            </span>
            <h2 className={styles.title}>{authModalMode === 'login' ? 'SIGN IN TO OTAKUVA' : 'JOIN OTAKUVA'}</h2>
            <p className={styles.subtitle}>Create your personal anime profile.</p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={closeAuthModal} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        {/* Action Intent Banner */}
        {intentMessage && (
          <div className={styles.intentBanner}>
            <span className={styles.intentDot} />
            <span>{intentMessage}</span>
          </div>
        )}

        {/* 3 Core Value Propositions */}
        <div className={styles.valueProps}>
          <div className={styles.propItem}>
            <Bookmark size={13} className={styles.propIcon} />
            <span>Track what you watch.</span>
          </div>
          <div className={styles.propItem}>
            <Star size={13} className={styles.propIcon} />
            <span>Rate what you love.</span>
          </div>
          <div className={styles.propItem}>
            <Users size={13} className={styles.propIcon} />
            <span>Join the community.</span>
          </div>
        </div>

        <AuthForm
          mode={authModalMode}
          onModeChange={(m) => openAuthModal(m === 'register' ? 'register' : 'login')}
          onSignedIn={afterSignIn}
          footer={
            <button type="button" className={styles.exploreBtn} onClick={closeAuthModal}>
              <span>Continue Exploring</span>
              <ArrowRight size={13} />
            </button>
          }
        />
      </div>
    </div>
  );
};
