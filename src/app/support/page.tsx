import type { Metadata } from 'next';
import Link from 'next/link';
import { Flag, KeyRound, ScrollText, ShieldCheck, Download, Database } from 'lucide-react';
import { PageHead } from '../../components/ui/PageHead';
import { SupportEmailCard } from '../../components/support/SupportEmailCard';
import { BUSINESS_EMAIL, SUPPORT_EMAIL, businessMailto } from '../../lib/support';
import styles from '../info.module.css';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Get help with your OTAKUVA account, report a problem, or contact the support team.',
  alternates: { canonical: '/support' },
};

/**
 * Support (2026-11-03, owner). Every self-help tile points at a real page;
 * the support terms describe what the support inbox actually does (email
 * only, reply aim matches the Privacy Policy's 7 days). Change both pages
 * together if that changes.
 */
const UPDATED = '4 November 2026';

const SELF_HELP = [
  { href: '/forgot-password', icon: KeyRound, title: 'Forgot password or username', text: 'Confirm it’s you with Google, then see your username and choose a new password.' },
  { href: '/report-content', icon: Flag, title: 'Report content', text: 'Spam, harassment, spoilers or anything that breaks the rules — send it to our moderators.' },
  { href: '/settings', icon: Download, title: 'Download or delete your data', text: 'Settings → Your data gives you a full copy; Delete account removes it for good.' },
  { href: '/community-guidelines', icon: ShieldCheck, title: 'Community guidelines', text: 'What is and isn’t allowed in reviews, discussions and communities.' },
  { href: '/credits', icon: Database, title: 'Anime data & credits', text: 'Where titles, artwork and schedules come from, and why some details may be missing.' },
  { href: '/terms', icon: ScrollText, title: 'Terms & Conditions', text: 'The rules for using OTAKUVA and your account.' },
];

export default function SupportPage() {
  return (
    <div className={styles.page}>
      <PageHead kicker="Help centre" title="Support" />
      <p className={styles.lead}>
        Have a question, found something that isn’t working, or need help with your account? Try the quick fixes below, or write to us —
        a real person reads every message.
      </p>

      <section className={styles.section} aria-labelledby="support-contact">
        <p className={styles.kicker}>Contact</p>
        <h2 id="support-contact" className={styles.heading}>
          Write to the support team
        </h2>
        <SupportEmailCard />
        <p className={styles.body}>
          Tell us your <strong>username</strong>, what you were trying to do, and what happened instead. A screenshot helps. Email from the address
          you’d like the reply sent to.
        </p>
      </section>

      {/* Contact us (2026-11-04, owner): one business address only. Hidden until NEXT_PUBLIC_BUSINESS_EMAIL is set. */}
      {BUSINESS_EMAIL && (
        <section id="contact" className={styles.section} aria-labelledby="support-business">
          <p className={styles.kicker}>Contact us</p>
          <h2 id="support-business" className={styles.heading}>
            Business &amp; partnerships
          </h2>
          <SupportEmailCard id="business-email-address" title="Business email" email={BUSINESS_EMAIL} ctaLabel="Email us" ctaHref={businessMailto()} />
          <p className={styles.body}>
            For partnerships, advertising, press and media. For help with your account, use the support address above.
          </p>
        </section>
      )}

      <section className={styles.section} aria-labelledby="support-self">
        <p className={styles.kicker}>Quick help</p>
        <h2 id="support-self" className={styles.heading}>
          Fix it yourself
        </h2>
        <div className={styles.grid}>
          {SELF_HELP.map(({ href, icon: Icon, title, text }) => (
            <Link key={href} href={href} className={styles.tile}>
              <span className={styles.tileIcon} aria-hidden="true">
                <Icon size={18} />
              </span>
              <p className={styles.tileTitle}>{title}</p>
              <p className={styles.tileText}>{text}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="support-terms">
        <p className={styles.kicker}>Support terms</p>
        <h2 id="support-terms" className={styles.heading}>
          How support works
        </h2>
        <p className={styles.updated}>Last updated: {UPDATED}</p>
        <ol className={styles.terms}>
          <li>
            <strong>Email only.</strong> Support is given by email at {SUPPORT_EMAIL}. We don’t offer phone or chat support, and we never contact
            you first by phone or WhatsApp asking for account details.
          </li>
          <li>
            <strong>Reply time.</strong> We aim to reply within 7 days, usually sooner. OTAKUVA is free and run by a small team, so this is a goal,
            not a guaranteed service level.
          </li>
          <li>
            <strong>We will never ask for your password or sign-in code.</strong> Nobody from OTAKUVA needs them. If someone asks, it isn’t us — don’t
            share them, and change your password.
          </li>
          <li>
            <strong>Proving an account is yours.</strong> Password changes are done by confirming the account’s email with Google. If you’ve lost
            access to that email, we may ask questions only the real owner can answer before helping, and we may refuse if we can’t be sure.
          </li>
          <li>
            <strong>What we can help with.</strong> Signing in, your account and data, bugs, wrong or missing anime information, reports about
            content or members, and questions about our policies.
          </li>
          <li>
            <strong>What we can’t help with.</strong> OTAKUVA isn’t a streaming service: we can’t give access to episodes, fix problems on other
            sites (Crunchyroll, Netflix and so on), or remove content from other websites. Moderation decisions follow the{' '}
            <Link href="/community-guidelines">Community Guidelines</Link>.
          </li>
          <li>
            <strong>Be kind.</strong> Abusive or threatening messages may go unanswered and can lead to action on the account.
          </li>
          <li>
            <strong>Your messages.</strong> We use what you send only to answer you and fix the problem, as described in the{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </li>
        </ol>
      </section>
    </div>
  );
}
