'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../control.module.css';

/** Close / reopen buttons for one inbox item (PATCH /api/control/inbox). */
export function InboxActions({ kind, id, open }: { kind: 'report' | 'correction'; id: string; open: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = async (status: string) => {
    setBusy(true);
    setError('');
    const res = await fetch('/api/control/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id, status }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setError('Could not save.');
      return;
    }
    router.refresh();
  };

  const actions: [string, string, boolean][] = !open
    ? [[kind === 'report' ? 'OPEN' : 'PENDING', 'Reopen', false]]
    : kind === 'report'
    ? [
        ['ACTIONED', 'Action taken', true],
        ['REVIEWED', 'No action needed', false],
        ['DISMISSED', 'Dismiss', false],
      ]
    : [
        ['APPROVED', 'Fixed', true],
        ['REJECTED', 'Not wrong', false],
      ];

  return (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {actions.map(([status, label, primary]) => (
        <button key={status} type="button" className={primary ? styles.primary : styles.secondary} disabled={busy} onClick={() => void set(status)}>
          {label}
        </button>
      ))}
      {error && <span className={styles.caption}>{error}</span>}
    </span>
  );
}
