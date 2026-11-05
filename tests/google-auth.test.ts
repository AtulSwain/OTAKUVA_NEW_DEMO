import './helpers/setupTestDb';

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { comparePassword, hashPassword } from '../src/lib/auth';
import { GOOGLE_PASS_COOKIE, safeNextPath, signGooglePass, verifyGooglePass } from '../src/lib/identity/googleAuth';

process.env.PHONE_VERIFICATION_REQUIRED = 'true';

import { POST as registerPOST } from '../src/app/api/auth/register/route';
import { POST as loginPOST } from '../src/app/api/auth/login/route';
import { POST as googleResetPOST } from '../src/app/api/auth/password-reset/google/route';
import { GET as pendingGET } from '../src/app/api/auth/google/pending/route';
import { GET as googleStartGET } from '../src/app/api/auth/google/route';
import { POST as sendCodePOST } from '../src/app/api/auth/email/send-code/route';
import { POST as verifyCodePOST } from '../src/app/api/auth/email/verify-code/route';
import { EMAIL_CODE_COOKIE } from '../src/lib/identity/emailCode';
import { GET as emailPendingGET } from '../src/app/api/auth/email/pending/route';
import { issueSignupCode } from '../src/lib/identity/signupCode';

// No real email in tests: the dev fallback returns the code (devCode).
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.RESEND_API_KEY;

after(async () => {
  await prisma.$disconnect();
});

let ip = 0;
function req(method: string, path: string, opts: { body?: unknown; pass?: string; cookie?: string } = {}) {
  const headers = new Headers();
  headers.set('x-forwarded-for', `10.8.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`);
  headers.set('origin', 'http://localhost:3000');
  if (opts.pass) headers.set('cookie', `${GOOGLE_PASS_COOKIE}=${opts.pass}`);
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

const PW = 'Sunset42river';
let seq = 0;
const freshEmail = () => `g${Date.now()}${seq++}@gmail.com`;
const freshName = () => `guser_${Date.now() % 1e7}${seq++}`;

describe('Google sign-in', () => {
  test('pass round-trips and rejects junk; next paths stay on-site', () => {
    const pass = signGooglePass({ email: 'a@b.com', name: null, intent: 'register' });
    assert.equal(verifyGooglePass(pass)?.email, 'a@b.com');
    assert.equal(verifyGooglePass('nope'), null);
    assert.equal(safeNextPath('//evil.com'), '/');
    assert.equal(safeNextPath('https://evil.com'), '/');
    assert.equal(safeNextPath('/settings'), '/settings');
  });

  test('without Google credentials the start route explains instead of failing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = await googleStartGET(req('GET', '/api/auth/google?intent=register'));
    assert.match(res.headers.get('location') || '', /NOT_CONFIGURED/);
  });

  test('sign-up: Google pass + username + password → verified account, then password sign-in', async () => {
    const email = freshEmail();
    const username = freshName();
    const pass = signGooglePass({ email, name: 'G User', intent: 'register' });

    const pending = await (await pendingGET(req('GET', '/api/auth/google/pending', { pass }))).json();
    assert.equal(pending.pending.email, email);

    const res = await registerPOST(req('POST', '/api/auth/register', { pass, body: { username, password: PW } }));
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.user.phoneVerified, true);
    assert.equal(data.user.emailVerified, true);
    const row = await prisma.user.findUniqueOrThrow({ where: { username } });
    assert.equal(row.email, email);
    assert.ok(row.emailVerifiedAt);
    assert.equal(row.phone, null);

    const login = await loginPOST(req('POST', '/api/auth/login', { body: { identifier: username, password: PW } }));
    assert.equal(login.status, 200);

    // Same Google email again → refused.
    const again = await registerPOST(req('POST', '/api/auth/register', { pass, body: { username: freshName(), password: PW } }));
    assert.equal(again.status, 409);
  });

  test('sign-up without a Google pass is refused', async () => {
    const res = await registerPOST(req('POST', '/api/auth/register', { body: { username: freshName(), password: PW } }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'PASS_INVALID');
  });

  test('forgot password: Google reset pass sets a new password once', async () => {
    const user = await prisma.user.create({
      data: { username: freshName(), email: freshEmail(), emailVerifiedAt: new Date(), passwordHash: await hashPassword(PW) },
    });
    await new Promise((r) => setTimeout(r, 1100));
    const pass = signGooglePass({ email: user.email!, name: null, intent: 'reset', userId: user.id });
    const res = await googleResetPOST(req('POST', '/api/auth/password-reset/google', { pass, body: { password: 'Moonlit77harbor' } }));
    assert.equal(res.status, 200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(await comparePassword('Moonlit77harbor', row.passwordHash!));

    const reuse = await googleResetPOST(req('POST', '/api/auth/password-reset/google', { pass, body: { password: 'Another88window' } }));
    assert.equal(reuse.status, 400);

    // A sign-up pass can't reset a password.
    const wrong = signGooglePass({ email: user.email!, name: null, intent: 'register' });
    const bad = await googleResetPOST(req('POST', '/api/auth/password-reset/google', { pass: wrong, body: { password: 'Moonlit77harbor' } }));
    assert.equal(bad.status, 400);
  });

  test('email code sign-up: send code → wrong code refused → right code → username + password', async () => {
    const email = freshEmail();
    const sent = await sendCodePOST(req('POST', '/api/auth/email/send-code', { body: { email } }));
    const sentData = await sent.json();
    assert.equal(sent.status, 200, JSON.stringify(sentData));
    assert.match(sentData.devCode, /^\d{6}$/);
    const ticket = sent.cookies.get(EMAIL_CODE_COOKIE)?.value;
    assert.ok(ticket);
    const cookie = `${EMAIL_CODE_COOKIE}=${ticket}`;

    const wrongCode = sentData.devCode === '000000' ? '111111' : '000000';
    const wrong = await verifyCodePOST(req('POST', '/api/auth/email/verify-code', { cookie, body: { code: wrongCode } }));
    assert.equal(wrong.status, 400);

    const ok = await verifyCodePOST(req('POST', '/api/auth/email/verify-code', { cookie, body: { code: sentData.devCode } }));
    assert.equal(ok.status, 200);
    const pass = ok.cookies.get(GOOGLE_PASS_COOKIE)?.value;
    assert.ok(pass);

    const username = freshName();
    const reg = await registerPOST(req('POST', '/api/auth/register', { pass, body: { username, password: PW } }));
    assert.equal(reg.status, 200);
    const row = await prisma.user.findUniqueOrThrow({ where: { username } });
    assert.equal(row.email, email);
    assert.ok(row.emailVerifiedAt);

    // That email can't start a second sign-up.
    const again = await sendCodePOST(req('POST', '/api/auth/email/send-code', { body: { email } }));
    assert.equal(again.status, 409);
  });

  test('bad email and expired/missing code are refused', async () => {
    const bad = await sendCodePOST(req('POST', '/api/auth/email/send-code', { body: { email: 'not-an-email' } }));
    assert.equal(bad.status, 400);
    const none = await verifyCodePOST(req('POST', '/api/auth/email/verify-code', { body: { code: '123456' } }));
    assert.equal(none.status, 400);
  });

  test('Google sign-up step: a code is issued for the Google email and the page can see which address', async () => {
    const email = freshEmail();
    const issued = await issueSignupCode(email, 'register');
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    assert.match(issued.devCode ?? '', /^\d{6}$/);
    const cookie = `${EMAIL_CODE_COOKIE}=${issued.ticket}`;
    const pending = await (await emailPendingGET(req('GET', '/api/auth/email/pending', { cookie }))).json();
    assert.deepEqual(pending.pending, { email, intent: 'register' });
    const none = await (await emailPendingGET(req('GET', '/api/auth/email/pending'))).json();
    assert.equal(none.pending, null);
    // The code still has to be typed before a username/password can be chosen.
    const ok = await verifyCodePOST(req('POST', '/api/auth/email/verify-code', { cookie, body: { code: issued.devCode } }));
    assert.equal(ok.status, 200);
    assert.ok(ok.cookies.get(GOOGLE_PASS_COOKIE)?.value);
  });
});
