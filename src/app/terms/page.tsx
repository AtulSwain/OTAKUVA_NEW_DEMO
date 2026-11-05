import { Metadata } from 'next';
import Link from 'next/link';
import { SUPPORT_EMAIL, supportMailto } from '../../lib/support';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: 'The rules for using OTAKUVA: your account, what you post, what isn’t allowed, and our responsibilities.',
  alternates: { canonical: '/terms' },
};

/**
 * Terms & Conditions (2026-11-03, owner — replaces the placeholder Terms of
 * Service; 2026-11-05: phone/SMS → email verified by Google or an emailed
 * code). Plain language, matching what the site actually does: one account
 * per verified email (src/app/api/auth/**), user content + moderation
 * (reports, ModerationAction), creator mode, third-party anime data,
 * account deletion (DELETE /api/account; community owners transfer first).
 * Age 13+ matches the Privacy Policy. Governing law = India is the owner's
 * choice to confirm. Worth a lawyer's read before a wide public launch.
 */
const UPDATED = '5 November 2026';

interface Clause {
  heading: string;
  paragraphs?: React.ReactNode[];
  bullets?: React.ReactNode[];
}

const CLAUSES: Clause[] = [
  {
    heading: '1. About these terms',
    paragraphs: [
      'These Terms & Conditions are the agreement between you and OTAKUVA, an anime tracking, rating and community website made in India. By using OTAKUVA or creating an account, you agree to them. If you don’t agree, please don’t use the site.',
      <>
        They work together with our <Link href="/privacy">Privacy Policy</Link>, <Link href="/community-guidelines">Community Guidelines</Link> and{' '}
        <Link href="/support">Support terms</Link>.
      </>,
    ],
  },
  {
    heading: '2. Who can use OTAKUVA',
    paragraphs: [
      'You must be at least 13 years old. If you are under 18, use OTAKUVA only with a parent or guardian’s permission. Browsing is open to everyone; rating, reviewing and posting need an account.',
    ],
  },
  {
    heading: '3. Your account',
    bullets: [
      <>
        <strong>One person, one account.</strong> Each account is tied to one email address, verified either by signing in with Google or with a
        one-time code we email you. Each email address can have only one account. Don’t create accounts for other people or extra accounts to
        boost ratings or votes.
      </>,
      <>
        <strong>Keep it secure.</strong> Keep your password and sign-in codes to yourself — OTAKUVA will never ask for them, and we never see your
        Google password. You are responsible for what happens on your account. If you think someone else has got in, confirm it’s you with Google
        on <Link href="/forgot-password">Forgot password or username</Link>, choose a new password straight away, and tell us.
      </>,
      <>
        <strong>Your username.</strong> Pick a name that doesn’t impersonate another person, brand or OTAKUVA staff, and isn’t offensive. We may change
        or reclaim a username that breaks this rule.
      </>,
      <>
        <strong>Accurate details.</strong> Use an email address that is yours. Creators must only link channels they own or run.
      </>,
    ],
  },
  {
    heading: '4. What you post',
    paragraphs: [
      'Reviews, ratings, comments, discussions, articles, lists, community posts and images you upload remain yours. By posting them, you give OTAKUVA a free, worldwide, non-exclusive permission to store, show, and format them on OTAKUVA (for example, showing your review on an anime’s page or your public list on your profile) for as long as they are on the site. This permission ends when you delete the content or your account, except where others have already replied to or quoted it.',
      'Only post things you have the right to post. You are responsible for your content; we don’t check everything before it appears.',
    ],
  },
  {
    heading: '5. What isn’t allowed',
    paragraphs: ['Please don’t:'],
    bullets: [
      'Harass, threaten, bully or share private information about anyone, or post hate speech.',
      'Post untagged spoilers, spam, scams, or misleading content.',
      'Share links to pirated anime, manga or other copyrighted material.',
      'Manipulate ratings, hype or reviews — for example with fake accounts, paid reviews or vote trading.',
      'Impersonate another person or OTAKUVA.',
      'Copy the site’s data in bulk with bots or scrapers, overload the site, or try to get around security, rate limits or moderation.',
      'Post sexual content involving minors, or anything illegal under Indian law.',
    ],
  },
  {
    heading: '6. Moderation',
    paragraphs: [
      <>
        Anyone can <Link href="/report-content">report</Link> content or members. Our moderators may hide or remove content, pin helpful reviews,
        give warnings, or limit, suspend or close accounts that break these terms or the Community Guidelines. We try to be fair and proportionate,
        and you can write to us if you think we got it wrong.
      </>,
    ],
  },
  {
    heading: '7. Creators and communities',
    paragraphs: [
      'Creator accounts follow the same rules as everyone else. People who create or run a community are responsible for keeping it within these terms; members-only communities are still subject to moderation. Invitation links and access keys are for the people you choose to share them with.',
    ],
  },
  {
    heading: '8. Anime information and other websites',
    paragraphs: [
      'OTAKUVA is not a streaming service and does not host episodes. Anime details, artwork, staff, schedules and news come from third-party sources such as AniList, MyAnimeList and news publishers; they can be incomplete, late or wrong, and we correct them when we find out. Titles, artwork and trademarks belong to their owners.',
      'Links to streaming platforms and other sites are for your convenience. We don’t control those sites and aren’t responsible for them.',
    ],
  },
  {
    heading: '9. Ending your account',
    paragraphs: [
      'You can delete your account at any time in Settings → Delete account. It is permanent once confirmed. If you own a community, transfer or delete it first. We may suspend or close an account that seriously or repeatedly breaks these terms, or where the law requires it.',
    ],
  },
  {
    heading: '10. The service “as is”',
    paragraphs: [
      'OTAKUVA is free and provided “as is”. We work to keep it running and accurate, but we can’t promise it will always be available, error-free or that information on it is complete. We may change, add or remove features at any time.',
    ],
  },
  {
    heading: '11. Limitation of liability',
    paragraphs: [
      'To the fullest extent allowed by law, OTAKUVA is not liable for indirect or consequential losses, loss of data, or for content posted by members or third parties. Nothing in these terms limits liability that cannot be limited under applicable law.',
    ],
  },
  {
    heading: '12. Changes to these terms',
    paragraphs: [
      'We may update these terms. When we do, we’ll change the date at the top, and for important changes we’ll also tell signed-in members on the site. Using OTAKUVA after a change means you accept the updated terms.',
    ],
  },
  {
    heading: '13. Governing law',
    paragraphs: ['These terms are governed by the laws of India, and disputes are subject to the jurisdiction of the courts in India.'],
  },
];

export default function TermsPage() {
  return (
    <div className={styles.legalPage}>
      <div className={styles.header}>
        <h1 className={styles.title}>Terms &amp; Conditions</h1>
        <span className={styles.lastUpdated}>Last updated: {UPDATED}</span>
      </div>

      <div className={styles.sections}>
        {CLAUSES.map((clause) => (
          <section key={clause.heading} className={styles.section}>
            <h2 className={styles.sectionHeading}>{clause.heading}</h2>
            {clause.paragraphs?.map((p, i) => (
              <p key={i} className={styles.sectionBody}>
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
          </section>
        ))}

        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>14. Contact us</h2>
          <p className={styles.sectionBody}>
            Questions about these terms? Email <a href={supportMailto()}>{SUPPORT_EMAIL}</a> or visit <Link href="/support">Support</Link>.
          </p>
        </section>
      </div>

      <p className={styles.footNote}>
        See also the <Link href="/privacy">Privacy Policy</Link>, <Link href="/community-guidelines">Community Guidelines</Link> and{' '}
        <Link href="/about">About Us</Link>.
      </p>
    </div>
  );
}
