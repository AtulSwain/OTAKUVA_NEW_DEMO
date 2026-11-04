import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { GOOGLE_PASS_COOKIE, verifyGooglePass } from '../../../../../lib/identity/googleAuth';

export const dynamic = 'force-dynamic';

/** GET /api/auth/google/pending — what the Google step verified, for the finish form. */
export async function GET(request: NextRequest) {
  const pass = verifyGooglePass(request.cookies.get(GOOGLE_PASS_COOKIE)?.value);
  const headers = { 'Cache-Control': 'no-store' };
  if (!pass) return NextResponse.json({ pending: null }, { headers });
  let username: string | null = null;
  if (pass.intent === 'reset' && pass.userId) {
    const u = await prisma.user.findUnique({ where: { id: pass.userId }, select: { username: true } });
    username = u?.username ?? null;
  }
  return NextResponse.json({ pending: { email: pass.email, name: pass.name, intent: pass.intent, username } }, { headers });
}
