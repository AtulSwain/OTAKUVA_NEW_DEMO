import { NextRequest, NextResponse } from 'next/server';
import { EMAIL_CODE_COOKIE, codeMatches, readEmailCodeTicket } from '../../../../../lib/identity/emailCode';
import { GOOGLE_PASS_COOKIE, googlePassCookieOptions, signGooglePass } from '../../../../../lib/identity/googleAuth';
import { checkAccountRateLimit, checkIpRateLimit, getClientIp, rateLimitResponse, recordAccountFailure, resetAccountRateLimit } from '../../../../../lib/security/authRateLimiter';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/email/verify-code { code }
 *
 * Sign-up step 2: checks the emailed code. On success the browser gets the
 * verified-email pass (same one Google sign-in issues), and the form moves on
 * to username + password (POST /api/auth/register). 5 wrong tries per email
 * per 15 minutes.
 */
export async function POST(request: NextRequest) {
  const ipLimit = await checkIpRateLimit('email-verify-code', getClientIp(request));
  if (!ipLimit.allowed) return rateLimitResponse('Too many attempts from this network. Try again later.', ipLimit.retryAfterSec!);

  const ticket = readEmailCodeTicket(request.cookies.get(EMAIL_CODE_COOKIE)?.value);
  if (!ticket) return NextResponse.json({ error: 'Your code expired. Send a new one.', code: 'CODE_EXPIRED' }, { status: 400 });

  const limit = await checkAccountRateLimit('email-verify-code', ticket.email);
  if (!limit.allowed) return rateLimitResponse('Too many wrong codes. Send a new code in a few minutes.', limit.retryAfterSec!);

  const body = await request.json().catch(() => ({}));
  if (!codeMatches(ticket.email, body?.code, ticket.hash)) {
    await recordAccountFailure('email-verify-code', ticket.email);
    return NextResponse.json({ error: 'That code isn’t right. Check the email and try again.', code: 'CODE_WRONG' }, { status: 400 });
  }

  await resetAccountRateLimit('email-verify-code', ticket.email);
  const response = NextResponse.json({ verified: true, email: ticket.email });
  response.cookies.delete(EMAIL_CODE_COOKIE);
  response.cookies.set(GOOGLE_PASS_COOKIE, signGooglePass({ email: ticket.email, name: null, intent: ticket.intent }), googlePassCookieOptions());
  return response;
}
