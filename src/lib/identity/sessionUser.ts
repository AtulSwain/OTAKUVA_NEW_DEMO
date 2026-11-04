import { maskPhone } from './phoneNumber';
import { isPhoneVerificationRequired } from './identityConfig';

/** The fields every auth response (register, login, me, phone link) returns for the signed-in user. */
export interface SessionUserSource {
  id: string;
  username: string;
  displayName?: string | null;
  email: string | null;
  role: string;
  avatarUrl: string | null;
  bannerUrl?: string | null;
  bio: string | null;
  createdAt: Date;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  emailVerifiedAt?: Date | null;
}

/**
 * Shapes a user row for the client. The full phone number is never sent
 * back — it is cached in localStorage by AuthContext — only a masked form
 * for display.
 */
export function toSessionUser(user: SessionUserSource, role: string = user.role) {
  return {
    id: user.id,
    username: user.username,
    /** Optional public name ("Victor Winters"); null when not set. */
    displayName: user.displayName ?? null,
    email: user.email,
    role,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl ?? null,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
    /** "Verified" account: Google-confirmed email (2026-11-04) or an older verified phone. Name kept for client compat. */
    phoneVerified: user.phoneVerifiedAt !== null || (user.emailVerifiedAt ?? null) !== null,
    emailVerified: (user.emailVerifiedAt ?? null) !== null,
    /** Whether the site currently requires a verified phone to rate/review/post. */
    phoneVerificationRequired: isPhoneVerificationRequired(),
    phoneMasked: user.phoneVerifiedAt ? maskPhone(user.phone) : null,
  };
}

export const SESSION_USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  email: true,
  role: true,
  avatarUrl: true,
  bannerUrl: true,
  bio: true,
  createdAt: true,
  phone: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,
} as const;
