'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useIsomorphicLayoutEffect } from '../lib/useIsomorphicLayoutEffect';

export interface AuthUser {
  id: string;
  username: string;
  /** Optional public name ("Victor Winters"); the username stays the handle. */
  displayName?: string | null;
  /** Null for accounts created by phone sign-up. */
  email?: string | null;
  role: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bio?: string | null;
  /** False until a phone number is verified by SMS code; gates rating, reviewing and posting. */
  phoneVerified?: boolean;
  /** e.g. "+91 ••••••3210" — the full number never reaches the client. */
  phoneMasked?: string | null;
  /** False while phone verification is switched off site-wide; no prompts are shown then. */
  phoneVerificationRequired?: boolean;
}

export type AuthIntent =
  | { type: 'RATE_ANIME'; animeId: string; animeTitle?: string; score: number }
  | { type: 'OPEN_RATING_MODAL'; animeId: string; animeTitle?: string; defaultScore?: number }
  | { type: 'ADD_TO_LIBRARY'; animeId: string; animeTitle?: string; status: 'watching' | 'completed' | 'plan_to_watch' | 'on_hold' | 'dropped' }
  | { type: 'ADVANCE_EPISODE'; animeId: string; animeTitle?: string; episodeNumber: number }
  | { type: 'TOGGLE_FAVORITE'; animeId: string; animeTitle?: string }
  | { type: 'WRITE_REVIEW'; animeId: string; animeTitle?: string }
  | { type: 'START_DISCUSSION'; animeId?: string; animeTitle?: string }
  | { type: 'CUSTOM'; animeId?: string; animeTitle?: string; callback?: () => void; description?: string };

export type OtpPurpose = 'register' | 'login' | 'link' | 'reset';

/** `code` is the API's machine-readable error code (e.g. PHONE_IN_USE), when there is one. */
export interface AuthResult {
  success: boolean;
  error?: string;
  code?: string;
  /** Development only: the SMS provider's own error, so a misconfiguration is visible in the form. */
  devDetail?: string;
  /** The signed-in account's platform role (sign-in only), e.g. to open the creator dashboard. */
  role?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  /** Texts a one-time code. `username` is required for 'register'. */
  requestOtp: (args: { purpose: OtpPurpose; phone: string; country: string; username?: string }) => Promise<AuthResult & { devMode?: boolean; mockCode?: string }>;
  loginWithPhone: (phone: string, country: string, code: string) => Promise<AuthResult>;
  /** The sign-in: username (or a legacy account's email) + password. */
  loginWithPassword: (identifier: string, password: string) => Promise<AuthResult>;
  /** Checks an SMS code; returns a short-lived pass proving the phone (sign-up / forgot password). */
  verifyPhoneCode: (purpose: 'register' | 'reset', phone: string, country: string, code: string) => Promise<AuthResult & { pass?: string }>;
  /** Creates the account from a verified phone pass + password, and signs in. */
  register: (username: string, password: string, pass: string) => Promise<AuthResult>;
  /** Sets a new password from a verified phone pass ("Forgot password"), and signs in. */
  resetPasswordWithPhone: (pass: string, password: string) => Promise<AuthResult>;
  /** Replaces the signed-in user after a server-side change (e.g. phone linked). */
  setSessionUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
  showAuthModal: boolean;
  authModalMode: 'login' | 'register';
  pendingIntent: AuthIntent | null;
  intentMessage: string | null;
  openAuthModal: (mode?: 'login' | 'register') => void;
  openAuthModalWithIntent: (intent: AuthIntent, customMessage?: string, mode?: 'login' | 'register') => void;
  consumePendingIntent: () => AuthIntent | null;
  closeAuthModal: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // The server always renders signed-out, so the first client render must
  // too. The cached identity is applied right after hydration (before paint)
  // and /api/auth/me then confirms or clears it. Reading localStorage in the
  // useState initializer made every signed-in page fail hydration.
  const [user, setUser] = useState<AuthUser | null>(null);
  useIsomorphicLayoutEffect(() => {
    try {
      const cached = localStorage.getItem('otakuva_user');
      if (cached) setUser((current) => current ?? JSON.parse(cached));
    } catch {
      // ignore parse/storage errors
    }
  }, []);
  const [isLoading, setIsLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [pendingIntent, setPendingIntent] = useState<AuthIntent | null>(null);
  const [intentMessage, setIntentMessage] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        const activeUser = data.user || null;
        setUser(activeUser);
        if (typeof window !== 'undefined') {
          if (activeUser) {
            localStorage.setItem('otakuva_user', JSON.stringify(activeUser));
          } else {
            localStorage.removeItem('otakuva_user');
          }
        }
      } else {
        setUser(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('otakuva_user');
        }
      }
    } catch (err) {
      // In case of transient network error, keep hydrated user if any
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();

    // Multi-tab synchronization: sync user session when another tab signs in or out
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'otakuva_user') {
        if (e.newValue) {
          try {
            setUser(JSON.parse(e.newValue));
          } catch {
            fetchSession();
          }
        } else {
          setUser(null);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchSession();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const presenceHeartbeat = window.setInterval(() => {
      if (document.visibilityState === 'visible' && localStorage.getItem('otakuva_user')) {
        fetchSession();
      }
    }, 2 * 60 * 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(presenceHeartbeat);
    };
  }, [fetchSession]);

  const applySession = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
    if (typeof window !== 'undefined') {
      localStorage.setItem('otakuva_user', JSON.stringify(nextUser));
    }
  }, []);

  const postAuth = async (url: string, payload: unknown): Promise<{ ok: boolean; data: any }> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } catch {
      return { ok: false, data: { error: 'Could not reach the server. Check your connection and try again.' } };
    }
  };

  const finishSignIn = (ok: boolean, data: any, fallbackError: string): AuthResult => {
    if (!ok || !data.user) {
      return { success: false, error: data.error || fallbackError, code: data.code };
    }
    applySession(data.user);
    setShowAuthModal(false);
    return { success: true, role: data.user.role };
  };

  const requestOtp: AuthContextType['requestOtp'] = async (args) => {
    const { ok, data } = await postAuth('/api/auth/phone/send-otp', args);
    if (!ok) return { success: false, error: data.error || 'Could not send the code.', code: data.code, devDetail: data.devDetail };
    return { success: true, devMode: data.devMode === true, mockCode: typeof data.mockCode === 'string' ? data.mockCode : undefined };
  };

  const loginWithPhone = async (phone: string, country: string, code: string) => {
    const { ok, data } = await postAuth('/api/auth/login', { phone, country, code });
    return finishSignIn(ok, data, 'Failed to sign in.');
  };

  const loginWithPassword = async (identifier: string, password: string) => {
    const { ok, data } = await postAuth('/api/auth/login', { identifier, password });
    return finishSignIn(ok, data, 'Failed to sign in.');
  };

  const verifyPhoneCode: AuthContextType['verifyPhoneCode'] = async (purpose, phone, country, code) => {
    const { ok, data } = await postAuth('/api/auth/phone/verify-code', { purpose, phone, country, code });
    if (!ok || typeof data.pass !== 'string') return { success: false, error: data.error || "That code didn't work.", code: data.code };
    return { success: true, pass: data.pass };
  };

  const register = async (username: string, password: string, pass: string) => {
    const { ok, data } = await postAuth('/api/auth/register', { username, password, pass });
    return finishSignIn(ok, data, 'Failed to create account.');
  };

  const resetPasswordWithPhone = async (pass: string, password: string) => {
    const { ok, data } = await postAuth('/api/auth/password-reset/phone', { pass, password });
    return finishSignIn(ok, data, 'Could not save the new password.');
  };

  const logout = async () => {
    const currentUserId = user?.id;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setPendingIntent(null);
      setIntentMessage(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('otakuva_user');
        if (currentUserId) {
          localStorage.removeItem(`otakuva_library_${currentUserId}`);
        }
      }
      window.location.reload();
    }
  };

  const openAuthModal = (mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setIntentMessage(null);
    setShowAuthModal(true);
  };

  const openAuthModalWithIntent = (
    intent: AuthIntent,
    customMessage?: string,
    mode: 'login' | 'register' = 'login'
  ) => {
    setPendingIntent(intent);
    setIntentMessage(
      customMessage ||
        (intent.type === 'RATE_ANIME'
          ? `Sign in to submit your rating (${intent.score.toFixed(1)}/10)`
          : intent.type === 'ADD_TO_LIBRARY'
          ? 'Sign in to add this anime to your personal library'
          : intent.type === 'TOGGLE_FAVORITE'
          ? 'Sign in to favorite this anime'
          : intent.type === 'WRITE_REVIEW'
          ? 'Sign in to write a community review'
          : intent.type === 'START_DISCUSSION'
          ? 'Sign in to start a forum discussion'
          : 'Sign in to continue')
    );
    setAuthModalMode(mode);
    setShowAuthModal(true);
  };

  const consumePendingIntent = () => {
    const current = pendingIntent;
    setPendingIntent(null);
    setIntentMessage(null);
    return current;
  };

  const closeAuthModal = () => {
    setShowAuthModal(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        requestOtp,
        loginWithPhone,
        loginWithPassword,
        verifyPhoneCode,
        register,
        resetPasswordWithPhone,
        setSessionUser: applySession,
        logout,
        showAuthModal,
        authModalMode,
        pendingIntent,
        intentMessage,
        openAuthModal,
        openAuthModalWithIntent,
        consumePendingIntent,
        closeAuthModal,
        refreshUser: fetchSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
