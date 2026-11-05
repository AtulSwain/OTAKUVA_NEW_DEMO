/**
 * Reports inbox API (2026-11-05). GET ?filter=open|closed lists reports +
 * corrections; PATCH { kind, id, status, note? } closes or reopens one.
 */
import { body, guarded } from '@control/lib/http';
import { listInbox, updateInboxItem, type InboxFilter } from '@control/lib/inbox';

export const inboxGET = guarded('/api/control/inbox', async (req) => {
  const filter: InboxFilter = req.nextUrl.searchParams.get('filter') === 'closed' ? 'closed' : 'open';
  return listInbox(filter);
});

export const inboxPATCH = guarded('/api/control/inbox PATCH', async (req, auth) => {
  const b = await body(req);
  return updateInboxItem(b.kind, b.id, b.status, auth.id, b.note);
});
