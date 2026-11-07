import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest, comparePassword } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { RateLimiter } from '../../../lib/security/rateLimiter';
import { SecurityAuditLogger } from '../../../lib/security/securityAuditLogger';
import { checkOtp } from '../../../lib/identity/otpService';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/account — GDPR Art. 17 / CCPA right-to-erasure self-service.
 *
 * *** [LEGAL REVIEW NEEDED] ***
 * This is the deletion *mechanism*, not a legal sign-off on what "erasure"
 * has to mean for this product. Specifically unreviewed:
 *
 * 1. Almost every table with a foreign key to User cascade-deletes when the
 *    User row is deleted (see prisma/schema.prisma — `onDelete: Cascade` on
 *    nearly all of them). That includes `Report` rows this user *filed*
 *    (reporterId) — if any are tied to an open moderation investigation,
 *    deleting them out from under that investigation may not be what
 *    trust & safety wants. A lawyer/compliance reviewer should confirm
 *    whether reports-in-progress need to survive (e.g. reassigned to a
 *    system actor) rather than cascade-delete.
 * 2. `ModerationAction` rows also cascade-delete on the *moderator's* own
 *    account deletion (moderatorId), which erases that moderator's audit
 *    trail entirely. `AuditLog.actorId` is the one relation that's
 *    `onDelete: SetNull` instead — i.e. general admin/audit history is
 *    already designed to survive anonymized, but `ModerationAction` isn't.
 *    Worth a deliberate decision, not a side effect of this route.
 * 3. Whether any retention period applies before data must be permanently
 *    purged (some jurisdictions allow/require a grace period, e.g. for
 *    fraud investigation) isn't implemented here — this deletes
 *    immediately on request. Confirm that's the intended policy.
 *
 * Until a lawyer has signed off on the above, this route implements the
 * conservative default: delete everything the schema lets cascade, but
 * refuse to silently destroy *other users'* data as a side effect (see the
 * owned-community check below) rather than guessing what's acceptable.
 */
export async function DELETE(request: NextRequest) {
  try {
    const authUser = await getAuthUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const rate = await RateLimiter.check('ACCOUNT', authUser.id);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many account requests. Please wait before trying again.' },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmation = typeof body.confirmation === 'string' ? body.confirmation : '';

    if (confirmation !== 'DELETE') {
      return NextResponse.json(
        { error: 'Type DELETE in the confirmation field to permanently erase your account.' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { id: true, username: true, passwordHash: true, phone: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    }

    // Re-authenticate before an irreversible erasure. Password accounts
    // confirm with their password; phone sign-up accounts have none, so they
    // confirm with a fresh SMS code sent to their own number (send-otp,
    // purpose "reauth"). Previously passwordless accounts needed only the
    // session cookie plus the word DELETE.
    if (user.passwordHash) {
      if (!password) {
        return NextResponse.json({ error: 'Enter your password to confirm account deletion.' }, { status: 400 });
      }
      const validPassword = await comparePassword(password, user.passwordHash);
      if (!validPassword) {
        return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
      }
    } else if (user.phone) {
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      if (!code) {
        return NextResponse.json(
          { error: 'Enter the code we texted to your phone to confirm account deletion.', code: 'CODE_REQUIRED' },
          { status: 400 }
        );
      }
      const check = await checkOtp(user.phone, code);
      if (!check.ok) {
        return NextResponse.json(
          { error: check.reason === 'expired' ? 'That code has expired. Request a new one.' : 'That code is incorrect.', code: 'INVALID_CODE' },
          { status: 401 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'This account has no password or phone number to confirm with. Contact support to delete it.' },
        { status: 400 }
      );
    }

    // Never silently destroy a community (and everything its other members
    // built) as a side effect of one owner's personal erasure request —
    // `Community.ownerId` cascade-deletes the whole community otherwise.
    // Require the owner to transfer or delete it explicitly first.
    const ownedCommunities = await prisma.community.findMany({
      where: { ownerId: authUser.id },
      select: { name: true, slug: true },
    });
    if (ownedCommunities.length > 0) {
      return NextResponse.json(
        {
          error:
            'You own one or more communities. Transfer ownership or delete them before deleting your account, so other members’ content isn’t destroyed as a side effect.',
          ownedCommunities,
        },
        { status: 409 }
      );
    }

    // Logged while the user row still exists — logSecurityEvent only
    // writes when the actor is a real, currently-existing user. Once the
    // delete below cascades, AuditLog.actorId is set to null (it's the
    // one User relation that's onDelete: SetNull, not Cascade), so this
    // entry survives as an anonymized "an account was deleted" record
    // without retaining this user's identity in it — intentionally no
    // username/email in `details` either, for the same reason.
    await SecurityAuditLogger.logSecurityEvent({
      eventType: 'ACCOUNT_DELETED',
      actorId: authUser.id,
      targetEntityType: 'User',
      targetEntityId: authUser.id,
      details: { reason: 'user_initiated_right_to_erasure' },
    });

    await prisma.user.delete({ where: { id: authUser.id } });

    const response = NextResponse.json({
      success: true,
      message: 'Your account and associated personal data have been deleted.',
    });
    response.cookies.delete('anilog_token');
    return response;
  } catch (error: any) {
    console.error('Account deletion error:', error);
    return NextResponse.json({ error: 'Failed to delete account.' }, { status: 500 });
  }
}
