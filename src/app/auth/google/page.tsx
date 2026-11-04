import { getLandingPosters } from '../../../lib/landing/landingPosters';
import { GoogleReturnClient } from './GoogleReturnClient';

export const dynamic = 'force-dynamic';

/**
 * Where Google sends people back (2026-11-04): finish sign-up (username +
 * password), set a new password, or show what went wrong — on the same
 * poster-wall card as /welcome.
 */
export default async function GoogleReturnPage() {
  const posters = await getLandingPosters(120).catch(() => []);
  return <GoogleReturnClient posters={posters} />;
}
