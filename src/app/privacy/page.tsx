import { Metadata } from 'next';
import Link from 'next/link';
import { SUPPORT_EMAIL, supportMailto } from '../../lib/support';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What OTAKUVA collects, why, who it is shared with, and how to download or delete your data.',
  alternates: { canonical: '/privacy' },
};

/**
 * Privacy Policy (2026-11-02). Plain language, and only what the site
 * actually does today — every statement here maps to real code:
 *   account + email  → src/app/api/auth/**, src/lib/identity/**
 *   Google sign-in   → src/lib/identity/googleAuth.ts (email + name only)
 *   emailed codes    → src/lib/identity/emailCode.ts, sent via Gmail
 *                      (src/lib/email/emailSender.ts, authEmails.ts)
 *   uploads          → Cloudinary (src/lib/storage/cloudinaryStorageProvider.ts)
 *   cookies          → anilog_token (30 d), otakuva_guest (30 d), sign-in
 *                      helpers otakuva_gstate / otakuva_ecode (10 min),
 *                      otakuva_gpass (15 min)
 *   analytics        → Vercel Web Analytics (cookieless page views)
 *   page-view counts → PageViewDaily (counts only, no user or IP)
 *   export / delete  → GET /api/account/export, DELETE /api/account
 * If any of these change, change this page in the same commit.
 * It still deserves a lawyer's read before a wide public launch.
 */
const UPDATED = '5 November 2026';

interface Clause {
  heading: string;
  paragraphs?: string[];
  bullets?: React.ReactNode[];
  after?: React.ReactNode;
}

const CLAUSES: Clause[] = [
  {
    heading: '1. Who we are',
    paragraphs: [
      'OTAKUVA is an anime tracking, rating and community website, made in India. In this policy “we” means OTAKUVA and “you” means anyone who visits the site or has an account.',
    ],
  },
  {
    heading: '2. What we collect',
    bullets: [
      <>
        <strong>Account details</strong> — your username, an optional display name, and your password. We never store the password itself, only a one-way
        encrypted fingerprint of it (a bcrypt hash) that can’t be turned back into the password.
      </>,
      <>
        <strong>Your email address</strong> — verified when you sign up, either by signing in with Google or with a one-time code we email you. We use it
        to keep one account per person, to send your sign-up code and a welcome email, and for account messages. It is never shown on your profile or
        to other members.
      </>,
      <>
        <strong>From Google, if you use “Continue with Google”</strong> — your email address, your name and the fact that Google has verified the
        email. We never see or receive your Google password, and we don’t get access to your Gmail, contacts or files.
      </>,
      <>
        <strong>Older accounts</strong> — if you signed up before 5 November 2026 with a mobile number, that number stays stored on your account only to
        identify it. It is never shown to anyone and is no longer used to sign in.
      </>,
      <>
        <strong>What you add</strong> — your library and watch progress, episode ratings, reviews, replies, comments, discussions, articles, lists and
        collections, follows, hype votes, community posts, and images you upload (avatar, banner, covers).
      </>,
      <>
        <strong>Technical data</strong> — your IP address and basic request details, used only to keep the site secure (for example, limiting repeated
        password or code attempts) and to fix errors. We record when you last signed in and were last active.
      </>,
      <>
        <strong>Anonymous counts</strong> — how many times each anime, news story or page was opened per day. These counts contain no user or IP
        information.
      </>,
    ],
  },
  {
    heading: '3. How we use it',
    bullets: [
      'To run your account and the features you use: tracking, ratings, reviews, lists, communities, notifications and recommendations.',
      'To keep OTAKUVA fair and safe: one account per email address, stopping spam and fake ratings, and handling reports and corrections.',
      'To fix problems and understand which pages are used, so we can improve the site.',
    ],
    after: <p className={styles.sectionBody}>We do not sell your data, we do not show advertising, and we do not use your data for advertising.</p>,
  },
  {
    heading: '4. What other people can see',
    paragraphs: [
      'Your username, display name, avatar, banner, bio, level, and anything you publish (reviews, public lists and collections, articles, discussions, comments, posts in communities you can see) are public. Your library, favourites, episode-by-episode ratings, hype votes and private lists are visible only to you. Your email address, password and IP address are never shown to anyone.',
    ],
  },
  {
    heading: '5. Services that process data for us',
    paragraphs: ['We use a few trusted services to run OTAKUVA. Each one only receives what it needs:'],
    bullets: [
      <><strong>Vercel</strong> — hosts the website; also counts page views without cookies (Vercel Web Analytics).</>,
      <><strong>Neon</strong> — our database (stored in Singapore).</>,
      <><strong>Google</strong> — “Continue with Google” sign-in, and Gmail, which delivers our emails (sign-up codes, welcome email); receives your email address and the email we send you.</>,
      <><strong>Cloudinary</strong> — stores and serves images you upload (avatar, banner, covers).</>,
      <><strong>Sentry</strong> (when error monitoring is switched on) — receives error reports with your account id only, never your name, email or password.</>,
    ],
    after: (
      <p className={styles.sectionBody}>
        Anime information (titles, artwork, staff, schedules) comes from public anime databases such as AniList and MyAnimeList. We don’t send them any of
        your data. See <Link href="/credits">Data credits</Link>.
      </p>
    ),
  },
  {
    heading: '6. Cookies and storage on your device',
    bullets: [
      <><strong>Sign-in cookie</strong> (<code>anilog_token</code>) — keeps you signed in for up to 30 days. Not used for tracking.</>,
      <><strong>Guest cookie</strong> (<code>otakuva_guest</code>) — remembers that you chose “Browse without signing in”, for 30 days.</>,
      <><strong>Sign-in helper cookies</strong> (<code>otakuva_gstate</code>, <code>otakuva_ecode</code>, <code>otakuva_gpass</code>) — used only while you sign up or sign in with Google or an emailed code, and expire within 15 minutes.</>,
      'Your browser also keeps small settings on this device only, like your colour theme and recent searches.',
    ],
    after: <p className={styles.sectionBody}>We don’t use advertising or cross-site tracking cookies.</p>,
  },
  {
    heading: '7. Keeping your account safe',
    paragraphs: [
      'Passwords are stored only as encrypted fingerprints, connections use HTTPS, sign-in attempts and emailed codes are rate-limited (codes expire after 10 minutes), and changing or resetting your password signs you out on every other device. If you think someone else got into your account, use “Forgot / change password” right away and contact us.',
    ],
  },
  {
    heading: '8. How long we keep data',
    paragraphs: [
      'We keep your data while your account exists. When you delete your account, your account and what you added are deleted straight away. Anonymous page-view counts are kept, since they contain nothing about you, and short technical logs held by our hosting provider expire on their own.',
    ],
  },
  {
    heading: '9. Your choices and rights',
    bullets: [
      <><strong>Download your data</strong> — Settings → Your data gives you a full copy as a file.</>,
      <><strong>Correct it</strong> — edit your profile, reviews, lists and other content at any time.</>,
      <><strong>Delete your account</strong> — Settings → Delete account. It is permanent once confirmed. If you own a community, transfer or delete it first so other members’ posts aren’t lost.</>,
      <><strong>Ask us</strong> — write to us (below) about anything in this policy, or to make a complaint about how your data is handled.</>,
    ],
  },
  {
    heading: '10. Children',
    paragraphs: [
      'OTAKUVA is for people aged 13 and over. If you are under 18, please use it with a parent or guardian’s permission. If we learn an account belongs to someone under 13, we will delete it.',
    ],
  },
  {
    heading: '11. Changes to this policy',
    paragraphs: [
      'If we change how we handle your data, we will update this page and the date at the top. For important changes we will also tell signed-in members on the site.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className={styles.legalPage}>
      <div className={styles.header}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <span className={styles.lastUpdated}>Last updated: {UPDATED}</span>
      </div>

      <div className={styles.sections}>
        {CLAUSES.map((clause) => (
          <section key={clause.heading} className={styles.section}>
            <h2 className={styles.sectionHeading}>{clause.heading}</h2>
            {clause.paragraphs?.map((p) => (
              <p key={p.slice(0, 32)} className={styles.sectionBody}>
                {p}
              </p>
            ))}
            {clause.bullets && (
              <ul className={styles.sectionList}>
                {clause.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
            {clause.after}
          </section>
        ))}

        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>12. Contact us</h2>
          <p className={styles.sectionBody}>
            Email <a href={supportMailto()}>{SUPPORT_EMAIL}</a> with the subject “Privacy”. We aim to reply within 7 days.
          </p>
        </section>
      </div>

      <p className={styles.footNote}>
        See also the <Link href="/terms">Terms &amp; Conditions</Link> and the <Link href="/community-guidelines">Community Guidelines</Link>.
      </p>
    </div>
  );
}
