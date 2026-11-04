import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { hashPassword, signJwtToken, setSessionCookie } from '../../../../../lib/auth';
import { validatePassword } from '../../../../../lib/identity/password';
import { GOOGLE_PASS_COOKIE, verifyGooglePass } from '../../../../../lib/identity/googleAuth';
import { SESSION_USER_SELECT, toSessionUser } from '../../../../../lib/identity/sessionUser';
import { checkIpRateLimit, rateLimitResponse, getClientIp } from '../../../../../lib/security/authRateLimiter';
import { logger } from '../../../../../lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/password-reset/google { password }
 *
 * Forgot / change password (2026-11-04): Google confirms the account's email
 * (GET /api/auth/google?intent=reset) → this sets the new password, signs
 * every other device out (passwordChangedAt) and signs this one in.
 */
export async function POST(request: NextRequest) {
  try {
    const ipLimit = await checkIpRateLimit('password-reset-google', getClientIp(request));
    if (!ipLimit.allowed) {
      return rateLimitResponse('Too many attempts from this network. Please try again later.', ipLimit.retryAfterSec!);
    }
    const pass = verifyGooglePass(request.cookies.get(GOOGLE_PASS_COOKIE)?.value);
    if (!pass || pass.intent !== 'reset' || !pass.userId) {
      return NextResponse.json({ error: 'Your Google check expired. Continue with Google again.', code: 'PASS_INVALID' }, { status: 400 });
    }
    const account = await prisma.user.findUnique({ where: { id: pass.userId }, select: { id: true, username: true, passwordChangedAt: true } });
    if (!account) return NextResponse.json({ error: 'Account not found.', code: 'PASS_INVALID' }, { status: 400 });
    if (account.passwordChangedAt && pass.issuedAt.getTime() <= account.passwordChangedAt.getTime()) {
      return NextResponse.json({ error: 'This check was already used. Continue with Google again.', code: 'PASS_USED' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const password = typeof body?.password === 'string' ? body.password : '';
    const passwordError = validatePassword(password, account.username);
    if (passwordError) return NextResponse.json({ error: passwordError, code: 'INVALID_PASSWORD' }, { status: 400 });

    const now = new Date();
    await prisma.user.update({
      where: { id: account.id },
      data: { passwordHash: await hashPassword(password), passwordChangedAt: now, lastLoginAt: now, lastSeenAt: now },
    });
    await prisma.passwordResetToken.updateMany({ where: { userId: account.id, usedAt: null }, data: { usedAt: new Date() } }).catch(() => undefined);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: account.id }, select: SESSION_USER_SELECT });
    const token = signJwtToken({ userId: user.id, username: user.username, email: user.email });
    const response = NextResponse.json({ user: toSessionUser(user), token, message: 'Password saved.' });
    setSessionCookie(response, token);
    response.cookies.delete(GOOGLE_PASS_COOKIE);
    return response;
  } catch (error) {
    logger.error('Google password reset failed', { error: error as Error, component: 'auth/password-reset/google' });
    return NextResponse.json({ error: 'Could not save the new password.' }, { status: 500 });
  }
}
