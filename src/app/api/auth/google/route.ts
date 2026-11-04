import { NextRequest, NextResponse } from 'next/server';
import {
  GOOGLE_INTENTS,
  GOOGLE_STATE_COOKIE,
  type GoogleIntent,
  googleAuthorizeUrl,
  isGoogleConfigured,
  newOAuthState,
  safeNextPath,
} from '../../../../lib/identity/googleAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/google?intent=login|register|creator|reset|link&next=/path
 *
 * Starts Google sign-in: remembers intent + where to return in a short,
 * httpOnly state cookie (also the CSRF check for the callback) and sends the
 * browser to Google.
 */
export async function GET(request: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL('/auth/google?error=NOT_CONFIGURED', request.url));
  }
  const rawIntent = request.nextUrl.searchParams.get('intent') || 'login';
  const intent: GoogleIntent = GOOGLE_INTENTS.includes(rawIntent as GoogleIntent) ? (rawIntent as GoogleIntent) : 'login';
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  const state = newOAuthState();

  const response = NextResponse.redirect(googleAuthorizeUrl(request, state));
  response.cookies.set(GOOGLE_STATE_COOKIE, JSON.stringify({ state, intent, next }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
