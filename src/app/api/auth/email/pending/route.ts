import { NextRequest, NextResponse } from 'next/server';
import { EMAIL_CODE_COOKIE, readEmailCodeTicket } from '../../../../../lib/identity/emailCode';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/email/pending — which address the current sign-up code was
 * sent to (from the httpOnly code cookie), so the Google return page can say
 * "Code sent to …" and resend it. Never returns the code.
 */
export async function GET(request: NextRequest) {
  const ticket = readEmailCodeTicket(request.cookies.get(EMAIL_CODE_COOKIE)?.value);
  return NextResponse.json(
    { pending: ticket ? { email: ticket.email, intent: ticket.intent } : null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
