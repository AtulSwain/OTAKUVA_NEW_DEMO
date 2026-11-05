import { NextRequest, NextResponse } from 'next/server';
import { EMAIL_CODE_COOKIE, emailCodeCookieOptions, normalizeEmail } from '../../../../../lib/identity/emailCode';
import { issueSignupCode } from '../../../../../lib/identity/signupCode';
import { checkIpRateLimit, getClientIp, rateLimitResponse } from '../../../../../lib/security/authRateLimiter';
import { logger } from '../../../../../lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/email/send-code { email, intent?: 'register' | 'creator' }
 *
 * Sign-up step 1 (2026-11-04): emails a 6-digit code. The code's hash rides
 * in an httpOnly cookie for 10 minutes. Without email delivery set up, local
 * development gets the code back in the response (`devCode`); production
 * refuses instead of pretending.
 */
export async function POST(request: NextRequest) {
  try {
    const ipLimit = await checkIpRateLimit('email-send-code', getClientIp(request));
    if (!ipLimit.allowed) return rateLimitResponse('Too many codes requested from this network. Try again later.', ipLimit.retryAfterSec!);

    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    if (!email) return NextResponse.json({ error: 'Enter a valid email address.', code: 'INVALID_EMAIL' }, { status: 400 });
    const intent = body?.intent === 'creator' ? 'creator' : 'register';

    const result = await issueSignupCode(email, intent);
    if (!result.ok) {
      if (result.code === 'RATE_LIMITED') return rateLimitResponse('Too many codes sent to this address. Try again in a few minutes.', result.retryAfterSec ?? 900);
      if (result.code === 'EMAIL_IN_USE') {
        return NextResponse.json({ error: 'This email already has an OTAKUVA account. Sign in instead.', code: 'EMAIL_IN_USE' }, { status: 409 });
      }
      if (result.code === 'EMAIL_NOT_CONFIGURED') {
        return NextResponse.json({ error: 'Email sign-up isn’t available right now. Use “Sign up with Google”.', code: 'EMAIL_NOT_CONFIGURED' }, { status: 503 });
      }
      return NextResponse.json({ error: 'We couldn’t send the email. Check the address and try again.', code: 'EMAIL_SEND_FAILED' }, { status: 502 });
    }

    const response = NextResponse.json({ sent: true, email, ...(result.devCode ? { devCode: result.devCode } : {}) });
    response.cookies.set(EMAIL_CODE_COOKIE, result.ticket, emailCodeCookieOptions());
    return response;
  } catch (error) {
    logger.error('Send sign-up code failed', { error: error as Error, component: 'auth/email/send-code' });
    return NextResponse.json({ error: 'Could not send the code.' }, { status: 500 });
  }
}
