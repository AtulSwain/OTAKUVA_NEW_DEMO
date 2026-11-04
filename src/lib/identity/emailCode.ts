import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Email sign-up codes (2026-11-04, owner): a new member types their email,
 * gets a 6-digit code by email, types it, then picks a username + password.
 *
 * Stateless: the code's hash (never the code) travels in a signed httpOnly
 * cookie for 10 minutes. Wrong guesses are capped per email by the auth rate
 * limiter (5 per 15 min), so a 6-digit code can't be brute-forced.
 * On success the browser gets the same "verified email" pass Google sign-in
 * uses (googleAuth.ts), so both paths finish on one form.
 */

export const EMAIL_CODE_COOKIE = 'otakuva_ecode';
export const EMAIL_CODE_TTL_SEC = 10 * 60;
const AUDIENCE = 'otakuva-email-code';

export type EmailCodeIntent = 'register' | 'creator';

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set in production.');
    return s;
  }
  return s || 'anilog_super_secret_jwt_key_2026';
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

/** Lower-cased, trimmed email, or null when it isn't a plausible address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function newEmailCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode(email: string, code: string): string {
  return crypto.createHmac('sha256', secret()).update(`${email}:${code}`).digest('hex');
}

export function signEmailCodeTicket(email: string, code: string, intent: EmailCodeIntent): string {
  return jwt.sign({ email, h: hashCode(email, code), intent }, secret(), {
    expiresIn: EMAIL_CODE_TTL_SEC,
    algorithm: 'HS256',
    audience: AUDIENCE,
  });
}

export function readEmailCodeTicket(ticket: unknown): { email: string; hash: string; intent: EmailCodeIntent } | null {
  if (typeof ticket !== 'string' || !ticket) return null;
  try {
    const p = jwt.verify(ticket, secret(), { algorithms: ['HS256'], audience: AUDIENCE }) as { email?: unknown; h?: unknown; intent?: unknown };
    if (typeof p.email !== 'string' || typeof p.h !== 'string') return null;
    return { email: p.email, hash: p.h, intent: p.intent === 'creator' ? 'creator' : 'register' };
  } catch {
    return null;
  }
}

export function codeMatches(email: string, code: unknown, hash: string): boolean {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return false;
  const a = Buffer.from(hashCode(email, code.trim()), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function emailCodeCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: EMAIL_CODE_TTL_SEC,
  };
}
