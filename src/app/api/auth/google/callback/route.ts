import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { getAuthUserFromRequest, setSessionCookie, signJwtToken, syncSuperAdminBootstrap } from '../../../../../lib/auth';
import {
  GOOGLE_PASS_COOKIE,
  GOOGLE_STATE_COOKIE,
  type GoogleIntent,
  fetchGoogleProfile,
  googlePassCookieOptions,
  safeNextPath,
  signGooglePass,
} from '../../../../../lib/identity/googleAuth';
import { EMAIL_CODE_COOKIE, emailCodeCookieOptions } from '../../../../../lib/identity/emailCode';
import { issueSignupCode } from '../../../../../lib/identity/signupCode';
import { logger } from '../../../../../lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/google/callback — Google sends the browser back here.
 *
 *   login / register / creator
 *     email already on an account → signed in (email marked verified)
 *     new email → 6-digit code emailed to it → /auth/google?step=code →
 *                 (code ok) choose username + password
 *   reset → the account with this email → pass → /auth/google (new password)
 *   link  → the signed-in account gets this verified email
 */
export async function GET(request: NextRequest) {
  const to = (path: string) => new URL(path, request.url);
  const fail = (code: string) => {
    const res = NextResponse.redirect(to(`/auth/google?error=${encodeURIComponent(code)}`));
    res.cookies.delete(GOOGLE_STATE_COOKIE);
    return res;
  };

  let saved: { state?: string; intent?: GoogleIntent; next?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(GOOGLE_STATE_COOKIE)?.value || '{}');
  } catch {
    saved = {};
  }
  const params = request.nextUrl.searchParams;
  if (params.get('error')) return fail('CANCELLED');
  const code = params.get('code');
  if (!code || !saved.state || params.get('state') !== saved.state) return fail('STATE_MISMATCH');
  const intent: GoogleIntent = saved.intent || 'login';
  const next = safeNextPath(saved.next);

  let profile;
  try {
    profile = await fetchGoogleProfile(request, code);
  } catch (error) {
    if ((error as Error).message === 'GOOGLE_EMAIL_NOT_VERIFIED') return fail('EMAIL_NOT_VERIFIED');
    logger.error('Google sign-in failed', { error: error as Error, component: 'auth/google/callback' });
    return fail('GOOGLE_FAILED');
  }

  try {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: profile.email, mode: 'insensitive' } },
      select: { id: true, username: true, email: true, role: true, emailVerifiedAt: true },
    });

    if (intent === 'link') {
      const me = await getAuthUserFromRequest(request);
      if (!me) return fail('SIGNED_OUT');
      if (existing && existing.id !== me.id) return fail('EMAIL_IN_USE');
      await prisma.user.update({ where: { id: me.id }, data: { email: profile.email, emailVerifiedAt: new Date() } });
      const res = NextResponse.redirect(to(next));
      res.cookies.delete(GOOGLE_STATE_COOKIE);
      return res;
    }

    if (intent === 'reset') {
      if (!existing) return fail('NO_ACCOUNT');
      if (!existing.emailVerifiedAt) {
        await prisma.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: new Date() } });
      }
      const res = NextResponse.redirect(to(`/auth/google?step=reset&next=${encodeURIComponent(next)}`));
      res.cookies.delete(GOOGLE_STATE_COOKIE);
      res.cookies.set(
        GOOGLE_PASS_COOKIE,
        signGooglePass({ email: profile.email, name: profile.name, intent, userId: existing.id }),
        googlePassCookieOptions(),
      );
      return res;
    }

    if (existing) {
      // Sign in: Google just proved this person owns the account's email.
      const now = new Date();
      await prisma.user.update({
        where: { id: existing.id },
        data: { emailVerifiedAt: existing.emailVerifiedAt ?? now, lastLoginAt: now, lastSeenAt: now },
      });
      await syncSuperAdminBootstrap(existing.id, existing.email, existing.role);
      const token = signJwtToken({ userId: existing.id, username: existing.username, email: existing.email });
      const res = NextResponse.redirect(to(intent === 'creator' ? '/creator' : next));
      res.cookies.delete(GOOGLE_STATE_COOKIE);
      setSessionCookie(res, token);
      return res;
    }

    // New member (2026-11-05, owner): Google picks the email, then a 6-digit
    // code is emailed to it; only after the code do they choose a username +
    // password. The verified-email pass is issued by
    // POST /api/auth/email/verify-code, not here.
    const signupIntent = intent === 'creator' ? 'creator' : 'register';
    const issued = await issueSignupCode(profile.email, signupIntent);
    if (!issued.ok) return fail(issued.code === 'EMAIL_IN_USE' ? 'GOOGLE_FAILED' : issued.code);
    const dev = issued.devCode && process.env.NODE_ENV !== 'production' ? `&dev=${issued.devCode}` : '';
    const res = NextResponse.redirect(to(`/auth/google?step=code&next=${encodeURIComponent(next)}${dev}`));
    res.cookies.delete(GOOGLE_STATE_COOKIE);
    res.cookies.delete(GOOGLE_PASS_COOKIE);
    res.cookies.set(EMAIL_CODE_COOKIE, issued.ticket, emailCodeCookieOptions());
    return res;
  } catch (error) {
    logger.error('Google sign-in failed after profile', { error: error as Error, component: 'auth/google/callback' });
    return fail('GOOGLE_FAILED');
  }
}
