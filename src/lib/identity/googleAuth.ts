import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { NextRequest } from 'next/server';

/**
 * Google sign-in (2026-11-04, owner): replaces phone/SMS verification.
 * Google proves the person owns their email address; OTAKUVA then asks for a
 * username + password (new accounts) and everyone signs in with those (or
 * the Google button again).
 *
 * Plain OAuth 2.0 authorization-code flow, server side only — the client
 * secret never reaches the browser. Env: GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET, optional GOOGLE_REDIRECT_URI (defaults to
 * <site>/api/auth/google/callback — add that exact URL in Google Cloud).
 */

export type GoogleIntent = 'login' | 'register' | 'creator' | 'reset' | 'link';
export const GOOGLE_INTENTS: GoogleIntent[] = ['login', 'register', 'creator', 'reset', 'link'];

export const GOOGLE_STATE_COOKIE = 'otakuva_gstate';
export const GOOGLE_PASS_COOKIE = 'otakuva_gpass';
export const GOOGLE_PASS_TTL_SEC = 15 * 60;

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

/** The site's own origin as the browser sees it. */
export function siteOrigin(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (process.env.NODE_ENV === 'production' && fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      // fall through
    }
  }
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || request.nextUrl.host;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.nextUrl.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export function googleRedirectUri(request: NextRequest): string {
  return process.env.GOOGLE_REDIRECT_URI?.trim() || `${siteOrigin(request)}/api/auth/google/callback`;
}

/** Only same-site paths ("/settings"), never "//evil.com" or absolute URLs. */
export function safeNextPath(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next.slice(0, 500);
}

export function newOAuthState(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function googleAuthorizeUrl(request: NextRequest, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: googleRedirectUri(request),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
}

/** Exchanges the code and reads the verified email. Throws on anything unexpected. */
export async function fetchGoogleProfile(request: NextRequest, code: string): Promise<GoogleProfile> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      redirect_uri: googleRedirectUri(request),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status})`);
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error('Google returned no access token');

  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!infoRes.ok) throw new Error(`Google userinfo failed (${infoRes.status})`);
  const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean | string; name?: string };
  const verified = info.email_verified === true || info.email_verified === 'true';
  if (!info.sub || !info.email || !verified) throw new Error('GOOGLE_EMAIL_NOT_VERIFIED');
  return { sub: info.sub, email: info.email.trim().toLowerCase(), name: info.name?.trim() || null };
}

// ── Google pass ────────────────────────────────────────────────────────
// After Google confirms the email, the browser holds a short-lived signed
// pass (httpOnly cookie) until the person has chosen a username/password.
// Own audience, so it can never act as a session.
const GOOGLE_PASS_AUDIENCE = 'otakuva-google-pass';

export interface GooglePass {
  email: string;
  name: string | null;
  intent: GoogleIntent;
  /** Set for 'reset': the account the email belongs to. */
  userId?: string;
  issuedAt: Date;
}

function secret(): string {
  // Same rules as the session secret (src/lib/auth.ts).
  const s = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set in production.');
    return s;
  }
  return s || 'anilog_super_secret_jwt_key_2026';
}

export function signGooglePass(p: Omit<GooglePass, 'issuedAt'>): string {
  return jwt.sign({ email: p.email, name: p.name, intent: p.intent, uid: p.userId }, secret(), {
    expiresIn: GOOGLE_PASS_TTL_SEC,
    algorithm: 'HS256',
    audience: GOOGLE_PASS_AUDIENCE,
  });
}

export function verifyGooglePass(pass: unknown): GooglePass | null {
  if (typeof pass !== 'string' || !pass) return null;
  try {
    const p = jwt.verify(pass, secret(), { algorithms: ['HS256'], audience: GOOGLE_PASS_AUDIENCE }) as {
      email?: unknown;
      name?: unknown;
      intent?: unknown;
      uid?: unknown;
      iat?: number;
    };
    if (typeof p.email !== 'string' || typeof p.iat !== 'number' || !GOOGLE_INTENTS.includes(p.intent as GoogleIntent)) return null;
    return {
      email: p.email,
      name: typeof p.name === 'string' ? p.name : null,
      intent: p.intent as GoogleIntent,
      userId: typeof p.uid === 'string' ? p.uid : undefined,
      issuedAt: new Date(p.iat * 1000),
    };
  } catch {
    return null;
  }
}

export function googlePassCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: GOOGLE_PASS_TTL_SEC,
  };
}
