import './helpers/setupTestDb';

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { getAuthUserFromRequest, hashPassword, isSessionCurrent, signJwtToken } from '../src/lib/auth';
import { passwordStrength, PASSWORD_STRENGTH_LABEL, validatePassword } from '../src/lib/identity/password';
import { normalizePhone } from '../src/lib/identity/phoneNumber';
import { peekDevOtp } from '../src/lib/identity/otpService';
import { matchKind, searchAnimeIdsByTitle, titleMatchPatterns } from '../src/lib/fuzzySearch';
import { searchCatalog } from '../src/lib/search';

// Never real SMS in tests: the dev stand-in issues codes and peekDevOtp() reads them.
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_VERIFY_SERVICE_SID;
delete process.env.PHONE_OTP_MODE;
import { createAnime, createUser } from './helpers/fixtures';
import { read } from './helpers/http';
import { POST as sendOtpPOST } from '../src/app/api/auth/phone/send-otp/route';
import { POST as verifyCodePOST } from '../src/app/api/auth/phone/verify-code/route';
import { POST as phoneResetPOST } from '../src/app/api/auth/password-reset/phone/route';
import { GET as searchGET } from '../src/app/api/search/route';

after(async () => {
  await prisma.$disconnect();
});

let ip = 0;
function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers = new Headers();
  headers.set('x-forwarded-for', `10.77.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`);
  headers.set('origin', 'http://localhost:3000');
  if (opts.token) headers.set('cookie', `anilog_token=${opts.token}`);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

let seq = 0;
const freshPhone = () => `8${String(Date.now() % 1e6).padStart(6, '0')}${String(seq++).padStart(3, '0')}`;

describe('password strength meter', () => {
  test('three levels: Very weak / Moderate / Strong', () => {
    assert.deepEqual(PASSWORD_STRENGTH_LABEL.slice(1), ['Very weak', 'Moderate', 'Strong']);
    assert.equal(passwordStrength(''), 0);
    assert.equal(passwordStrength('abc'), 1, 'too short');
    assert.equal(passwordStrength('password1'), 1, 'common word');
    assert.equal(passwordStrength('zxcvbn12'), 1, 'keyboard word + numbers');
    for (const pw of ['abc12345', 'abcd1234', 'Qwerty@123', 'Password1', 'admin2026', '1234abcd']) {
      assert.ok(validatePassword(pw), `${pw} is refused`);
      assert.equal(passwordStrength(pw), 1, pw);
    }
    for (const pw of ['otakuva-Pass-2026', 'Old-password-1', 'Kaguya7sama']) {
      assert.equal(validatePassword(pw), null, `${pw} is allowed`);
      assert.ok(passwordStrength(pw) >= 2, pw);
    }
    assert.equal(passwordStrength('Zxcvbnm7'), 2, 'mixed case + number');
    assert.equal(passwordStrength('zxcvbnmkjh27'), 2, 'long but plain');
    assert.equal(passwordStrength('Tr0ub4dor&Zebra'), 3);
    assert.equal(passwordStrength('Mikasa_Zx9@saga', 'mikasa_zx'), 1, 'contains the username');
  });
});

describe('changing the password signs out other devices', () => {
  test('isSessionCurrent compares the session time with the last change', () => {
    const t = new Date(Date.now() - 10_000);
    assert.equal(isSessionCurrent({ userId: 'u', username: 'u', iat: t.getTime() / 1000 - 60 }, t), false);
    assert.equal(isSessionCurrent({ userId: 'u', username: 'u', iat: Math.floor(t.getTime() / 1000) }, t), true);
    assert.equal(isSessionCurrent({ userId: 'u', username: 'u' }, t), false, 'no issue time');
    assert.equal(isSessionCurrent({ userId: 'u', username: 'u', iat: 1 }, null), true, 'never changed');
    assert.equal(isSessionCurrent({ userId: 'u', username: 'u', iat: 1 }, new Date(Date.now() + 3_600_000)), true, 'future time = bad data, ignored');
  });

  test('phone → code → new password: the old session stops working, the new one works', async () => {
    const user = await createUser();
    const national = freshPhone();
    const phone = normalizePhone(national, 'IN')!;
    await prisma.user.update({ where: { id: user.id }, data: { phone, phoneVerifiedAt: new Date(), passwordHash: await hashPassword('Old-password-1') } });

    // A session from "another device", signed before the change.
    const oldToken = signJwtToken({ userId: user.id, username: user.username });
    assert.ok(await getAuthUserFromRequest(req('GET', '/api/auth/me', { token: oldToken })), 'old session works before');

    await sendOtpPOST(req('POST', '/api/auth/phone/send-otp', { body: { purpose: 'reset', phone: national, country: 'IN' } }));
    const ver = await read(await verifyCodePOST(req('POST', '/api/auth/phone/verify-code', { body: { purpose: 'reset', phone: national, country: 'IN', code: peekDevOtp(phone) } })));
    assert.equal(ver.status, 200, JSON.stringify(ver.body));

    // Tokens are stamped to the second; land the change in a later second.
    await new Promise((r) => setTimeout(r, 2100));
    const reset = await phoneResetPOST(req('POST', '/api/auth/password-reset/phone', { body: { pass: ver.body.pass, password: 'New-password-2' } }));
    const body = await read(reset);
    assert.equal(body.status, 200, JSON.stringify(body.body));

    assert.equal(await getAuthUserFromRequest(req('GET', '/api/auth/me', { token: oldToken })), null, 'old device signed out');
    const me = await getAuthUserFromRequest(req('GET', '/api/auth/me', { token: body.body.token }));
    assert.equal(me?.id, user.id, 'this device stays signed in');
    assert.equal((me as any).passwordChangedAt, undefined, 'internal field not leaked');
  });
});

describe('search puts the anime you named on top', () => {
  test('patterns escape LIKE / regex characters', () => {
    const p = titleMatchPatterns('Re:Zero 5_0%');
    assert.equal(p.exact, 'rezero50');
    assert.equal(p.like, '%re:zero 5\\_0\\%%');
    assert.equal(p.word, '');
    assert.equal(titleMatchPatterns('monster').word, '\\mmonster\\M');
  });

  test('"monster": the anime titled exactly Monster first, then titles with the word, then related by tag', async () => {
    const tag = `qz${Date.now()}`; // unique word so other fixtures don't interfere
    const popular = await createAnime({ canonicalTitle: `${tag} Musume Everyday` });
    await prisma.anime.update({ where: { id: popular.id }, data: { members: 900000 } });
    const exact = await createAnime({ canonicalTitle: tag.toUpperCase() });
    await prisma.anime.update({ where: { id: exact.id }, data: { members: 10 } });
    const inside = await createAnime({ canonicalTitle: `Pocket ${tag}s Adventure` });
    const tagged = await createAnime({ canonicalTitle: 'Quiet Garden Story' });
    await prisma.animeTag.create({ data: { animeId: tagged.id, name: `${tag} Girl` } });
    const adult = await createAnime({ canonicalTitle: `${tag} Adult` });
    await prisma.anime.update({ where: { id: adult.id }, data: { isAdult: true } });

    const ranked = await searchAnimeIdsByTitle(tag, 10);
    assert.equal(ranked[0].id, exact.id, 'exact title beats a more popular partial match');
    assert.equal(matchKind(Number(ranked[0].rank)), 'exact');
    assert.ok(ranked.findIndex((r) => r.id === popular.id) < ranked.findIndex((r) => r.id === inside.id), 'starts-with before contains');

    const api = await read(await searchGET(req('GET', `/api/search?q=${tag}`)));
    assert.equal(api.status, 200);
    const ids = api.body.anime.map((a: any) => a.id);
    assert.equal(ids[0], exact.id);
    assert.equal(api.body.anime[0].match, 'exact');
    assert.ok(ids.includes(tagged.id), 'related by tag is listed');
    assert.equal(api.body.anime.find((a: any) => a.id === tagged.id).match, 'related');
    assert.ok(ids.indexOf(tagged.id) > ids.indexOf(inside.id), 'related after title matches');
    assert.ok(!ids.includes(adult.id), 'adult titles never appear');

    const page = await searchCatalog({ query: tag, sortBy: 'relevance', limit: 10 });
    assert.equal(page.items[0].id, exact.id, '/search page: exact title first');
    assert.ok(page.pagination.total >= 4);
  });
});
