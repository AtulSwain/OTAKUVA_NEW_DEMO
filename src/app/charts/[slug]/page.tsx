import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHead } from '../../../components/ui/PageHead';
import { getPublishedChart } from '@control/lib/charts';
import styles from '../charts.module.css';
import { ViewBeacon } from '../../../components/analytics/ViewBeacon';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const chart = await getPublishedChart(params.slug).catch(() => undefined);
  // notFound() here (not only in the page): metadata resolves before the
  // loading skeleton streams, so the response is a real 404, not a 200.
  if (chart === null) notFound();
  if (!chart) return { title: 'Chart not found', robots: { index: false } };
  return { title: `${chart.title}`, description: chart.description || `${chart.items.length} anime ranked by the OTAKUVA team.` };
}

const medal = (i: number) => (i === 0 ? styles.gold : i === 1 ? styles.silver : i === 2 ? styles.bronze : '');

/** One published chart: ranked, with the team's note per title. */
export default async function ChartPage({ params }: { params: { slug: string } }) {
  const chart = await getPublishedChart(params.slug).catch(() => null);
  if (!chart) notFound();
  return (
    <div className={styles.page}>
      <ViewBeacon kind="chart" id={chart.id} />
      <PageHead kicker="OTAKUVA chart" title={chart.title} />
      {chart.description && <p className={styles.desc}>{chart.description}</p>}
      <ol className={styles.list}>
        {chart.items.map((a, i) => (
          <li key={a.animeId}>
            <Link href={`/anime/${a.slug}`} className={styles.row}>
              <span className={`${styles.rank} ${medal(i)}`}>{String(i + 1).padStart(2, '0')}</span>
              <span className={styles.poster}>
                {a.posterUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.posterUrl} alt="" loading={i < 6 ? 'eager' : 'lazy'} />
                )}
              </span>
              <span className={styles.text}>
                <strong>{a.title}</strong>
                <span className={styles.meta}>{[a.type, a.year].filter(Boolean).join(' · ')}</span>
                {a.note && <p className={styles.note}>{a.note}</p>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
