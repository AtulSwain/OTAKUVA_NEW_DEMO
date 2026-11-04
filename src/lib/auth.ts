import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';
import { Role, hasMinRole } from './roles';
import { isPhoneVerificationRequired } from './identity/identityConfig';

const JWT_EXPIRES_IN = '30d';
const JWT_ALGORITHM = 'HS256';

// This string is public (it is in the repo), so it may only ever sign
// tokens on a developer's machine. In production a missing or short
// AUTH_SECRET must fail closed: sign-in errors out and every token is
// rejected, rather than silently accepting tokens anyone could mint.
// Resolved per call, not at module load, so `next build` (which runs with
// NODE_ENV=production and no secrets) can still import this file.
const DEV_ONLY_SECRET = 'anilog_super_secret_jwt_key_2026';

function getJwtSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.length < 32 || secret === DEV_ONLY_SECRET) {
      throw new Error('AUTH_SECRET must be set to a private value of at least 32 characters in production.');
    }
    return secret;
  }
  return secret || DEV_ONLY_SECRET;
}

export interface TokenPayload {
  userId: string;
  username: string;
  /** Null for phone-only accounts. Informational only — never used for authorization. */
  email?: string | null;
  /** Issued-at (seconds), set by jsonwebtoken. */
  iat?: number;
}

/**
 * A session signed before the account's last password change is dead
 * (2026-11-02): changing or resetting a password signs out every other
 * device. One second of slack because `iat` is whole seconds.
 */
export function isSessionCurrent(payload: TokenPayload, passwordChangedAt: Date | null | undefined, now = Date.now()): boolean {
  if (!passwordChangedAt) return true;
  // A change time in the future is bad data (older rows were written with
  // the DB clock/time zone) — never let it sign everyone out.
  if (passwordChangedAt.getTime() > now + 60_000) return true;
  if (typeof payload.iat !== 'number') return false;
  return payload.iat * 1000 >= passwordChangedAt.getTime() - 1000;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signJwtToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN, algorithm: JWT_ALGORITHM });
}

export function verifyJwtToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGORITHM] }) as TokenPayload;
  } catch (error) {
    return null;
  }
}

// ── Phone-verified passes (2026-10-28) ─────────────────────────────────
// After an SMS code checks out, the client gets a short-lived signed pass
// that says "this phone was verified for <purpose>" — then it sets the
// password and sends the pass along. Signed with the session secret but a
// distinct audience, so a pass can never be used as a session (it has no
// userId) and a session token can never be used as a pass (no audience).
const PHONE_PASS_AUDIENCE = 'otakuva-phone-pass';
export const PHONE_PASS_TTL_SEC = 10 * 60;
export type PhonePassPurpose = 'register' | 'reset';

export function signPhonePass(phone: string, purpose: PhonePassPurpose): string {
  return jwt.sign({ phone, purpose }, getJwtSecret(), {
    expiresIn: PHONE_PASS_TTL_SEC,
    algorithm: JWT_ALGORITHM,
    audience: PHONE_PASS_AUDIENCE,
  });
}

/** The verified phone and when the pass was issued, or null if invalid/expired/wrong purpose. */
export function verifyPhonePass(pass: unknown, purpose: PhonePassPurpose): { phone: string; issuedAt: Date } | null {
  if (typeof pass !== 'string' || !pass) return null;
  try {
    const p = jwt.verify(pass, getJwtSecret(), { algorithms: [JWT_ALGORITHM], audience: PHONE_PASS_AUDIENCE }) as {
      phone?: unknown;
      purpose?: unknown;
      iat?: number;
    };
    if (p.purpose !== purpose || typeof p.phone !== 'string' || typeof p.iat !== 'number') return null;
    return { phone: p.phone, issuedAt: new Date(p.iat * 1000) };
  } catch {
    return null;
  }
}

// ── Control-center gate pass (2026-11-02) ──────────────────────────────
// Step one of the control-center sign-in: the owner's key, typed into the
// ordinary password box, earns this short-lived signed pass (an httpOnly
// cookie). Own audience, so it is never a session and grants nothing alone;
// step two is still an ADMIN account's username + password.
const CONTROL_GATE_AUDIENCE = 'otakuva-control-gate';

export function signControlGatePass(ttlSec: number): string {
  return jwt.sign({ gate: 'control' }, getJwtSecret(), { expiresIn: ttlSec, algorithm: JWT_ALGORITHM, audience: CONTROL_GATE_AUDIENCE });
}

export function verifyControlGatePass(pass: unknown): boolean {
  if (typeof pass !== 'string' || !pass) return false;
  try {
    const p = jwt.verify(pass, getJwtSecret(), { algorithms: [JWT_ALGORITHM], audience: CONTROL_GATE_AUDIENCE }) as { gate?: unknown };
    return p.gate === 'control';
  } catch {
    return false;
  }
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string | null;
  role: string;
  phoneVerifiedAt: Date | null;
  /** Set once Google confirmed the account's email (2026-11-04). */
  emailVerifiedAt: Date | null;
}

function extractTokenFromRequest(request: NextRequest): { token: string | null; fromCookie: boolean } {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return { token: authHeader.substring(7).trim(), fromCookie: false };
  }
  const cookie = request.cookies.get('anilog_token');
  return { token: cookie ? cookie.value : null, fromCookie: true };
}

const CSRF_UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// CSRF defense for the `anilog_token` cookie path. A Bearer header can't be
// attached to a cross-site request by a browser without the target site's
// CORS cooperation, so only the cookie-authenticated path is exposed — a
// browser will happily replay the cookie on a form/fetch submitted from any
// origin. SameSite=Lax on the cookie (see the two `response.cookies.set`
// call sites) already blocks the common case, but it's not a complete
// answer on its own: it depends on browser support, doesn't cover
// same-site-but-different-subdomain attackers, and (per the documented
// "text/plain form built to look like JSON" technique) a same-site CORS
// allowlist doesn't stop a simple, non-preflighted cross-origin form
// submission either. Verifying Origin (falling back to Referer) against
// the app's own origin is the OWASP-recommended lightweight alternative to
// a double-submit token here — the codebase has no shared frontend fetch
// wrapper, so threading a CSRF token header through every one of the ~40
// mutating `fetch()` call sites across components would be a much larger,
// riskier change for the same protection. Browsers always send Origin (or
// at minimum Referer) on a cross-origin-capable POST/PUT/PATCH/DELETE, so
// this doesn't require any frontend change — same-origin requests already
// carry a matching header. See docs/production/ARCHITECTURE.md §3.1.
function isLocalDevHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.local')) return true;
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function isTrustedOrigin(request: NextRequest): boolean {
  const source = request.headers.get('origin') || request.headers.get('referer');
  if (!source) return false;

  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    return false;
  }

  const expectedHosts = new Set<string>([request.nextUrl.host]);
  // The host the browser actually used to reach us. `nextUrl.host` is the
  // server's own configured host (always `localhost:3000` in dev), so without
  // this every legitimate same-origin request from 127.0.0.1, a LAN IP (a
  // phone on the same Wi-Fi) or a proxy/custom domain was rejected as
  // cross-origin. A cross-site attacker cannot make the browser send a
  // matching Origin AND a victim Host, so this doesn't weaken the check.
  for (const headerName of ['host', 'x-forwarded-host']) {
    const value = request.headers.get(headerName)?.split(',')[0]?.trim();
    if (value) expectedHosts.add(value);
  }
  for (const envVar of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL]) {
    if (!envVar) continue;
    try {
      expectedHosts.add(new URL(envVar).host);
    } catch {
      // ignore malformed env values
    }
  }

  if (expectedHosts.has(sourceHost)) return true;

  // Development only: `next dev` rewrites Host/X-Forwarded-Host to
  // `localhost:<port>`, so a browser that reached the dev server at
  // 127.0.0.1 or a LAN address (a phone on the same Wi-Fi) can never match
  // above. Trust loopback and private-network origins there. Never in
  // production, where the Host header and NEXT_PUBLIC_APP_URL are authoritative.
  if (process.env.NODE_ENV !== 'production') {
    return isLocalDevHost(sourceHost.replace(/:\d+$/, ''));
  }
  return false;
}

/**
 * Like getAuthUserFromRequest(), but a local JWT verify only — no DB
 * lookup. Returns whatever userId the token claims, without re-checking
 * the account still exists or its role hasn't changed. Not a substitute
 * for getAuthUserFromRequest()/requireRole() for authorization decisions
 * — only for cheap, best-effort request tagging (e.g. attaching a user id
 * to error-tracking context on every request; see
 * src/lib/observability/sentryUser.ts) where a stale/forged-but-expired
 * distinction doesn't matter and a DB round trip on every request would.
 */
export function getUserIdFromRequestFast(request: NextRequest): string | null {
  const { token } = extractTokenFromRequest(request);
  if (!token) return null;
  const payload = verifyJwtToken(token);
  return payload?.userId || null;
}

/**
 * Same lookup as getAuthUserFromRequest(), but for a Server Component (no
 * NextRequest available there) — reads the `anilog_token` cookie via
 * next/headers. Read-only by construction (Server Components can only ever
 * render a GET), so the CSRF/origin check that guards cookie-authenticated
 * mutations in getAuthUserFromRequest() does not apply here.
 */
export async function getAuthUserFromCookies(): Promise<AuthenticatedUser | null> {
  try {
    const { cookies } = await import('next/headers');
    const token = cookies().get('anilog_token')?.value;
    if (!token) return null;

    const payload = verifyJwtToken(token);
    if (!payload || !payload.userId) return null;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, email: true, role: true, phoneVerifiedAt: true, emailVerifiedAt: true, passwordChangedAt: true },
    });
    if (!user || !isSessionCurrent(payload, user.passwordChangedAt)) return null;
    const { passwordChangedAt: _pc, ...current } = user;

    return current;
  } catch {
    return null;
  }
}

export async function getAuthUserFromRequest(request: NextRequest): Promise<AuthenticatedUser | null> {
  try {
    const { token, fromCookie } = extractTokenFromRequest(request);
    if (!token) {
      return null;
    }

    // See isTrustedOrigin() above: a cookie-authenticated mutation from an
    // untrusted origin is treated as unauthenticated (same as a missing/
    // invalid token) rather than surfaced as a distinct error — the
    // request never had valid credentials from this origin's perspective.
    if (fromCookie && CSRF_UNSAFE_METHODS.has(request.method) && !isTrustedOrigin(request)) {
      return null;
    }

    const payload = verifyJwtToken(token);
    if (!payload || !payload.userId) {
      return null;
    }

    // Role is always read fresh from the DB (never trusted from the JWT
    // payload) so a role change or revocation takes effect immediately,
    // without waiting for the token to expire.
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, email: true, role: true, phoneVerifiedAt: true, emailVerifiedAt: true, passwordChangedAt: true },
    });
    if (!user || !isSessionCurrent(payload, user.passwordChangedAt)) return null;
    const { passwordChangedAt: _pc, ...current } = user;

    return current;
  } catch (err) {
    return null;
  }
}

/**
 * Enforces a minimum platform role on an API route. Returns the
 * authenticated user on success, or a ready-to-return NextResponse
 * (401 if unauthenticated, 403 if the role is insufficient) on failure.
 *
 * Usage:
 *   const auth = await requireRole(request, 'DATA_EDITOR');
 *   if (auth instanceof NextResponse) return auth;
 *   // auth is AuthenticatedUser here
 */
export async function requireRole(
  request: NextRequest,
  minRole: Role
): Promise<AuthenticatedUser | NextResponse> {
  const user = await getAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  if (!hasMinRole(user.role, minRole)) {
    return NextResponse.json({ error: 'You do not have permission to perform this action.' }, { status: 403 });
  }
  return user;
}

/**
 * Enforces authentication AND a verified phone number on an API route.
 * Returns the authenticated user on success, or a ready-to-return
 * NextResponse (401 if unauthenticated, 403 with code PHONE_NOT_VERIFIED
 * if the account hasn't proven ownership of a phone number by SMS OTP).
 *
 * Use this instead of a bare getAuthUserFromRequest() call on any route
 * that lets a user post content — reviews, ratings, discussions/comments,
 * community creation/posts/chat. One phone number can back only one
 * account (User.phone is unique), which is what keeps one person from
 * running many accounts to push ratings around. Accounts created by phone
 * sign-up are verified from the start; legacy email/password accounts stay
 * gated until they link a phone (POST /api/auth/phone/verify).
 *
 * Usage:
 *   const auth = await requireVerifiedUser(request);
 *   if (auth instanceof NextResponse) return auth;
 *   // auth is AuthenticatedUser here, and auth.phoneVerifiedAt is set
 */
export async function requireVerifiedUser(request: NextRequest): Promise<AuthenticatedUser | NextResponse> {
  const user = await getAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  // Off while testing (PHONE_VERIFICATION_REQUIRED, src/lib/identity/identityConfig.ts).
  // Verified = a Google-confirmed email (2026-11-04), or a phone verified
  // before the switch. The code stays PHONE_NOT_VERIFIED for client compat.
  if (!user.emailVerifiedAt && !user.phoneVerifiedAt && isPhoneVerificationRequired()) {
    return NextResponse.json(
      {
        error: 'Please verify your email with Google before posting. It takes one click.',
        code: 'PHONE_NOT_VERIFIED',
      },
      { status: 403 }
    );
  }
  return user;
}

const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days, matches JWT_EXPIRES_IN

/** Sets the httpOnly session cookie that getAuthUserFromRequest() reads. */
export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set('anilog_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

// Bootstraps SUPER_ADMIN access without requiring direct DB access: if the
// given email appears in OTAKUVA_SUPER_ADMIN_EMAILS (comma-separated), the
// account is promoted on login/registration. This only ever promotes —
// removing an email from the list does not demote an existing admin;
// demotion is a deliberate action via the role-management API.
// Returns the user's effective role after the check — the promoted role if
// a promotion happened, otherwise `currentRole` unchanged.
export async function syncSuperAdminBootstrap(userId: string, email: string | null, currentRole: string): Promise<string> {
  if (!email) return currentRole;
  const list = (process.env.OTAKUVA_SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (list.length === 0) return currentRole;
  if (currentRole === 'SUPER_ADMIN') return currentRole;
  if (!list.includes(email.toLowerCase())) return currentRole;

  await prisma.user.update({ where: { id: userId }, data: { role: 'SUPER_ADMIN' } });
  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: 'USER_ROLE_CHANGE',
      entityType: 'User',
      entityId: userId,
      beforeJson: JSON.stringify({ role: currentRole }),
      afterJson: JSON.stringify({ role: 'SUPER_ADMIN', via: 'OTAKUVA_SUPER_ADMIN_EMAILS bootstrap' }),
    },
  });
  return 'SUPER_ADMIN';
}
