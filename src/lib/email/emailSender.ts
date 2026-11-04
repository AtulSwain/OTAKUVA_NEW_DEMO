/**
 * OTAKUVA — pluggable outbound email.
 *
 * Real delivery goes through Resend (https://resend.com) when
 * `RESEND_API_KEY` and `EMAIL_FROM` are set (server-side env only — never
 * NEXT_PUBLIC_). Without them every call falls back to logging the message,
 * which keeps the password-reset / email-verification flows usable in
 * dev/test (the link is in the log line) without pretending anything was
 * delivered. Every caller only depends on `sendEmail()`.
 */

import nodemailer from 'nodemailer';
import { logger } from '../logger';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Dev/test-only fallback: logs the message instead of sending it. Never
 * throws — a missing email provider must not break the password
 * reset/verification request routes, which are also what surfaces "we
 * don't have real delivery yet" for whoever wires up production email.
 */
class LoggingEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    logger.info('Email not sent — no email provider configured, logging instead', {
      component: 'email/emailSender',
      to: message.to,
      subject: message.subject,
      // The body is the only place the raw token/link lives; logging it is
      // what makes this fallback usable at all for local dev/testing. Real
      // production delivery must replace this sender before launch — see
      // module doc comment above.
      text: message.text,
    });
  }
}

/**
 * Resend's REST API via fetch (no SDK dependency). Throws on any non-2xx so
 * callers can log the failure; the API key is never logged.
 */
class ResendEmailSender implements EmailSender {
  constructor(private apiKey: string, private from: string) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Resend's error body describes the problem (e.g. unverified sending
      // domain); it never echoes the API key.
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend rejected the email (${res.status}): ${detail.slice(0, 300)}`);
    }
    logger.info('Email sent', { component: 'email/emailSender', provider: 'resend', subject: message.subject });
  }
}

/**
 * Gmail (or any SMTP server) — 2026-11-04, owner: no domain yet, so mail goes
 * out from a Gmail account using an App Password (Google Account → Security →
 * 2-Step Verification → App passwords). Works for any recipient, ~500/day.
 * Env: SMTP_USER (the Gmail address), SMTP_PASS (16-letter app password),
 * optional SMTP_HOST/SMTP_PORT (default smtp.gmail.com:465), EMAIL_FROM.
 */
class SmtpEmailSender implements EmailSender {
  private transport;
  constructor(private user: string, pass: string, private from: string) {
    const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT || 465);
    this.transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
    logger.info('Email sent', { component: 'email/emailSender', provider: 'smtp', subject: message.subject });
  }
}

function smtpSettings(): { user: string; pass: string; from: string } | null {
  const user = process.env.SMTP_USER?.trim() ?? '';
  const pass = (process.env.SMTP_PASS ?? '').replace(/\s+/g, '');
  if (!user || !pass) return null;
  const from = process.env.EMAIL_FROM?.trim() || '';
  // Gmail rewrites any other sender address, so default to "OTAKUVA <the gmail>".
  const sender = from.includes('@') ? from : `${from.replace(/["<>]/g, '') || 'OTAKUVA'} <${user}>`;
  return { user, pass, from: sender };
}

export interface EmailConfigCheck {
  ok: boolean;
  /** Human-readable problems; never contains the key itself. */
  problems: string[];
}

/**
 * Validates the Resend settings before anything is sent, so a wrong value
 * produces a clear message instead of a silent rejection (a Google
 * "AIza…" key in RESEND_API_KEY was the real-world failure here).
 */
export function checkEmailConfig(): EmailConfigCheck {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  const from = process.env.EMAIL_FROM?.trim() ?? '';
  const problems: string[] = [];
  if (!apiKey) problems.push('RESEND_API_KEY is not set.');
  else if (!apiKey.startsWith('re_')) {
    problems.push(
      `RESEND_API_KEY is not a Resend key (Resend keys start with "re_"; this one starts with "${apiKey.slice(0, 2)}…"). Create one at resend.com → API Keys.`
    );
  }
  if (!from) problems.push('EMAIL_FROM is not set.');
  else if (!/^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$|<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>\s*$/.test(from)) {
    problems.push(`EMAIL_FROM must be an email address, e.g. "OTAKUVA <onboarding@resend.dev>" (got ${JSON.stringify(from)}).`);
  }
  return { ok: problems.length === 0, problems };
}

let sender: EmailSender | null = null;
let senderConfig = '';

export function getEmailSender(): EmailSender {
  // Rebuild when the settings change (Next reloads .env in dev), so fixing
  // .env takes effect without a restart.
  const signature = `${process.env.RESEND_API_KEY ?? ''}|${process.env.EMAIL_FROM ?? ''}|${process.env.SMTP_USER ?? ''}|${process.env.SMTP_PASS ?? ''}`;
  if (!sender || signature !== senderConfig) {
    senderConfig = signature;
    const smtp = smtpSettings();
    const check = checkEmailConfig();
    if (smtp) {
      sender = new SmtpEmailSender(smtp.user, smtp.pass, smtp.from);
    } else if (check.ok) {
      sender = new ResendEmailSender(process.env.RESEND_API_KEY!.trim(), process.env.EMAIL_FROM!.trim());
    } else {
      if (process.env.RESEND_API_KEY?.trim() || process.env.EMAIL_FROM?.trim()) {
        // Settings were attempted but are wrong: say exactly what, loudly.
        logger.error('Email delivery is misconfigured — emails will NOT be sent, only logged', {
          component: 'email/emailSender',
          problems: check.problems,
        });
      }
      sender = new LoggingEmailSender();
    }
  }
  return sender;
}

/** True when real delivery is configured correctly. */
export function isEmailDeliveryConfigured(): boolean {
  return smtpSettings() !== null || checkEmailConfig().ok;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  await getEmailSender().send(message);
}
