import { sendEmail } from './emailSender';
import { SITE_URL } from '../seo/site';

/**
 * Sign-up emails (2026-11-04, owner): the 6-digit code and the welcome note.
 * Plain, dark, table-based HTML (works in Gmail / Outlook) + a text version.
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0e0e10;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e10;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#18181b;border:1px solid #2a2a2e;border-radius:18px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e4e4e7;">
<tr><td style="padding:28px 28px 8px;font-size:18px;font-weight:800;letter-spacing:0.04em;color:#ffffff;">OTAKUVA</td></tr>
<tr><td style="padding:8px 28px 0;font-size:22px;font-weight:800;color:#ffffff;">${escapeHtml(title)}</td></tr>
<tr><td style="padding:12px 28px 28px;font-size:15px;line-height:1.6;color:#c4c4cc;">${bodyHtml}</td></tr>
</table>
<p style="font-family:Arial,sans-serif;font-size:12px;color:#71717a;margin:16px 0 0;">You're getting this because this address was used on OTAKUVA.</p>
</td></tr></table></body></html>`;
}

export async function sendSignupCodeEmail(to: string, code: string): Promise<void> {
  const html = layout(
    'Your sign-up code',
    `Enter this code on OTAKUVA to verify your email:
<div style="margin:20px 0;padding:16px 0;text-align:center;font-size:34px;font-weight:800;letter-spacing:10px;color:#ffffff;background:#0e0e10;border-radius:12px;border:1px solid #2a2a2e;">${code}</div>
It expires in 10 minutes. If you didn't try to sign up, you can ignore this email.`,
  );
  await sendEmail({
    to,
    subject: `${code} is your OTAKUVA code`,
    text: `Your OTAKUVA sign-up code is ${code}. It expires in 10 minutes. If you didn't try to sign up, ignore this email.`,
    html,
  });
}

export async function sendWelcomeEmail(to: string, username: string): Promise<void> {
  const site = SITE_URL.replace(/\/$/, '');
  const name = escapeHtml(username);
  const html = layout(
    `Welcome to OTAKUVA, @${name}!`,
    `Your account is ready. Here's how to get started:
<ul style="padding-left:18px;margin:14px 0;">
<li>Track what you watch in your library</li>
<li>Rate every episode and see what keeps people hooked</li>
<li>Write reviews and join the community</li>
</ul>
Sign in any time with your username <strong style="color:#fff;">@${name}</strong> and your password.
<div style="margin:22px 0 4px;"><a href="${site}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#ffffff;color:#111113;font-weight:700;text-decoration:none;">Open OTAKUVA</a></div>`,
  );
  await sendEmail({
    to,
    subject: 'Welcome to OTAKUVA',
    text: `Welcome to OTAKUVA, @${username}! Your account is ready. Sign in with your username and password: ${site}`,
    html,
  });
}
