'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Film,
  UserRound,
  Sparkles,
  Building2,
  Newspaper,
  MessageSquareWarning,
  Database,
  ImageIcon,
  ExternalLink,
  LogOut,
  Trophy,
  CalendarHeart,
  PenLine,
  Library,
  BarChart3,
  TrendingUp,
  PieChart,
  Activity,
  MessagesSquare,
  Inbox,
  Flag,
  Clapperboard,
  Radio,
  FileText,
  BadgeDollarSign,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import styles from './control.module.css';

type Item = { href: string; label: string; icon: LucideIcon };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Overview',
    items: [
      { href: '/control', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/control/desk', label: 'Main desk', icon: Inbox },
      { href: '/control/inbox', label: 'Reports inbox', icon: Flag },
    ],
  },
  {
    title: 'Platform',
    items: [
      { href: '/control/creators', label: 'Creators', icon: Clapperboard },
      { href: '/control/communities', label: 'Communities', icon: MessagesSquare },
      { href: '/control/activity', label: 'Activity feed', icon: Radio },
      { href: '/control/users', label: 'All members', icon: Users },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { href: '/control/anime', label: 'Anime', icon: Film },
      { href: '/control/people', label: 'Cast & staff', icon: UserRound },
      { href: '/control/characters', label: 'Characters', icon: Sparkles },
      { href: '/control/studios', label: 'Studios', icon: Building2 },
    ],
  },
  {
    title: 'Editorial',
    items: [
      { href: '/control/charts', label: 'Charts', icon: Trophy },
      { href: '/control/choice', label: 'OTAKUVA Choice', icon: CalendarHeart },
      { href: '/control/news', label: 'News', icon: Newspaper },
      { href: '/control/articles', label: 'Articles', icon: PenLine },
      { href: '/control/collections', label: 'Collections', icon: Library },
    ],
  },
  {
    title: 'Monetization',
    items: [{ href: '/control/monetization', label: 'Ads & commissions', icon: BadgeDollarSign }],
  },
  {
    title: 'Analytics',
    items: [
      { href: '/control/analytics/anime', label: 'Anime analytics', icon: BarChart3 },
      { href: '/control/analytics/news', label: 'News analytics', icon: TrendingUp },
      { href: '/control/analytics/collections', label: 'Collections & charts', icon: PieChart },
      { href: '/control/analytics/members', label: 'Member analytics', icon: Activity },
      { href: '/control/analytics/community', label: 'Community analytics', icon: MessagesSquare },
      { href: '/control/reports', label: 'Report studio', icon: FileText },
    ],
  },
];

/** The older, more detailed admin tools — kept, linked from here. */
const TOOLS: Item[] = [
  { href: '/admin/news', label: 'Imported news', icon: Newspaper },
  { href: '/admin/reviews', label: 'Reviews & reports', icon: MessageSquareWarning },
  { href: '/admin/studios', label: 'Studio editor', icon: Building2 },
  { href: '/admin/images', label: 'Image health', icon: ImageIcon },
  { href: '/admin/data', label: 'Data & sync', icon: Database },
];

export function ControlShell({ username, role, children }: { username: string; role: string; children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const { logout } = useAuth();
  const active = (href: string) => (href === '/control' ? pathname === '/control' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <Link href="/control" className={styles.sideBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/otakuva-mark.png" alt="" width={32} height={25} />
          <span>
            OTAKUVA <em>Control</em>
          </span>
        </Link>
        <nav className={styles.nav} aria-label="Control center">
          {GROUPS.map((g) => (
            <React.Fragment key={g.title}>
              <p className={styles.navHeading}>{g.title}</p>
              {g.items.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className={active(href) ? styles.navOn : styles.navItem} aria-current={active(href) ? 'page' : undefined}>
                  <Icon size={17} aria-hidden={true} />
                  <span>{label}</span>
                </Link>
              ))}
            </React.Fragment>
          ))}
          <p className={styles.navHeading}>More tools</p>
          {TOOLS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={styles.navItem}>
              <Icon size={17} aria-hidden={true} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className={styles.sideFoot}>
          <span className={styles.who}>
            @{username} <small>{role.replace('_', ' ').toLowerCase()}</small>
          </span>
          <Link href="/" className={styles.footLink}>
            <ExternalLink size={14} aria-hidden="true" /> View site
          </Link>
          <button type="button" className={styles.footLink} onClick={() => void logout()}>
            <LogOut size={14} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
