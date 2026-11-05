import InboxPage from '@control/ui/pages/InboxPage';

export const dynamic = 'force-dynamic';

export default function Page({ searchParams }: { searchParams: { filter?: string } }) {
  return <InboxPage filter={searchParams.filter === 'closed' ? 'closed' : 'open'} />;
}
