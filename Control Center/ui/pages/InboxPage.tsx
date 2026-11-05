import Link from 'next/link';
import { listInbox, type InboxFilter } from '@control/lib/inbox';
import styles from '../control.module.css';
import { InboxActions } from './InboxActions';

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** Reports inbox (2026-11-05): member reports + "wrong information" corrections. */
export default async function InboxPage({ filter }: { filter: InboxFilter }) {
  const { items, openCount } = await listInbox(filter);
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.kicker}>Moderation</p>
        <h1 className={styles.title}>Reports inbox</h1>
      </header>

      <nav className={styles.chips} aria-label="Filter">
        <Link href="/control/inbox" className={filter === 'open' ? styles.chipOn : styles.chip}>
          Open ({openCount})
        </Link>
        <Link href="/control/inbox?filter=closed" className={filter === 'closed' ? styles.chipOn : styles.chip}>
          Closed
        </Link>
      </nav>

      {items.length === 0 ? (
        <p className={styles.caption}>{filter === 'open' ? 'Nothing waiting. 🎉' : 'Nothing closed yet.'}</p>
      ) : (
        <ul className={styles.list}>
          {items.map((it) => (
            <li key={`${it.kind}-${it.id}`} className={styles.userRow} style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
              <span className={styles.badge}>{it.category}</span>
              <span className={styles.rowText} style={{ flex: '1 1 320px', minWidth: 0 }}>
                <strong>
                  {it.href ? (
                    <Link href={it.href} target="_blank" className={styles.inlineLink}>
                      {it.about}
                    </Link>
                  ) : (
                    it.about
                  )}
                </strong>
                {it.field && (
                  <span>
                    <b>{it.field}:</b> {it.suggested}
                  </span>
                )}
                {it.text && <span style={{ whiteSpace: 'pre-wrap' }}>{it.text}</span>}
                <span className={styles.caption}>
                  {it.from ? (
                    <>
                      from{' '}
                      <Link href={`/profile/${it.from}`} target="_blank" className={styles.inlineLink}>
                        @{it.from}
                      </Link>{' '}
                      ·{' '}
                    </>
                  ) : null}
                  {when.format(new Date(it.createdAt))}
                  {filter === 'closed' ? ` · ${it.status.toLowerCase()}` : ''}
                </span>
              </span>
              <InboxActions kind={it.kind} id={it.id} open={filter === 'open'} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
