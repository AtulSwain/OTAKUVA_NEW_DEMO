import { prisma } from '../prisma';
import { sendSignupCodeEmail } from '../email/authEmails';
import { isEmailDeliveryConfigured } from '../email/emailSender';
import { logger } from '../logger';
import { checkAccountRateLimit, recordAccountFailure } from '../security/authRateLimiter';
import { newEmailCode, signEmailCodeTicket, type EmailCodeIntent } from './emailCode';

/**
 * Sends a sign-up code to an email address (2026-11-05). One place for the
 * rules, used by POST /api/auth/email/send-code (typed email) and by the
 * Google callback (new member: Google picks the address, the code proves
 * they can read that inbox, then username + password).
 */

export type IssueResult =
  | { ok: true; ticket: string; devCode?: string }
  | { ok: false; code: 'RATE_LIMITED' | 'EMAIL_IN_USE' | 'EMAIL_NOT_CONFIGURED' | 'EMAIL_SEND_FAILED'; retryAfterSec?: number };

export async function issueSignupCode(email: string, intent: EmailCodeIntent): Promise<IssueResult> {
  // At most 5 codes per address per 15 minutes.
  const sendLimit = await checkAccountRateLimit('email-send-code', email);
  if (!sendLimit.allowed) return { ok: false, code: 'RATE_LIMITED', retryAfterSec: sendLimit.retryAfterSec };

  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
  if (existing) return { ok: false, code: 'EMAIL_IN_USE' };

  const delivery = isEmailDeliveryConfigured();
  if (!delivery && process.env.NODE_ENV === 'production') return { ok: false, code: 'EMAIL_NOT_CONFIGURED' };

  const code = newEmailCode();
  if (delivery) {
    try {
      await sendSignupCodeEmail(email, code);
    } catch (error) {
      logger.error('Sign-up code email failed', { error: error as Error, component: 'identity/signupCode' });
      return { ok: false, code: 'EMAIL_SEND_FAILED' };
    }
  }
  await recordAccountFailure('email-send-code', email); // counts sends, not failures
  return { ok: true, ticket: signEmailCodeTicket(email, code, intent), ...(delivery ? {} : { devCode: code }) };
}
