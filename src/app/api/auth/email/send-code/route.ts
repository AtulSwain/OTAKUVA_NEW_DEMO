import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { EMAIL_CODE_COOKIE, emailCodeCookieOptions, newEmailCode, normalizeEmail, signEmailCodeTicket } from '../../../../../lib/identity/emailCode';
import { sendSignupCodeEmail } from '../../../../../lib/email/authEmails';
import { isEmailDeliveryConfigured } from '../../../../../lib/email/emailSender';
import { checkAccountRateLimit, checkIpRateLimit, getClientIp, rateLimitResponse, recordAccountFailure } from '../../../../../lib/security/authRateLimiter';
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

    // At most 5 codes per address per 15 minutes (shares nothing with guesses).
    const sendLimit = await checkAccountRateLimit('email-send-code', email);
    if (!sendLimit.allowed) return rateLimitResponse('Too many codes sent to this address. Try again in a few minutes.', sendLimit.retryAfterSec!);

    const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: 'This email already has an OTAKUVA account. Sign in instead.', code: 'EMAIL_IN_USE' }, { status: 409 });
    }

    const delivery = isEmailDeliveryConfigured();
    if (!delivery && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Email sign-up isn’t available right now. Use “Sign up with Google”.', code: 'EMAIL_NOT_CONFIGURED' }, { status: 503 });
    }

    const code = newEmailCode();
    if (delivery) {
      try {
        await sendSignupCodeEmail(email, code);
      } catch (error) {
        logger.error('Sign-up code email failed', { error: error as Error, component: 'auth/email/send-code' });
        return NextResponse.json({ error: 'We couldn’t send the email. Check the address and try again.', code: 'EMAIL_SEND_FAILED' }, { status: 502 });
      }
    }
    await recordAccountFailure('email-send-code', email); // counts sends, not failures

    const response = NextResponse.json({ sent: true, email, ...(delivery ? {} : { devCode: code }) });
    response.cookies.set(EMAIL_CODE_COOKIE, signEmailCodeTicket(email, code, intent), emailCodeCookieOptions());
    return response;
  } catch (error) {
    logger.error('Send sign-up code failed', { error: error as Error, component: 'auth/email/send-code' });
    return NextResponse.json({ error: 'Could not send the code.' }, { status: 500 });
  }
}
