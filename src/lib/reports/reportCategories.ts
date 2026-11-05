/**
 * What people can report (2026-11-05, owner: "when someone clicks Report,
 * give them every category"). Shared by the /report-content page and the
 * server routes, so labels and allowed values never drift apart.
 *
 *   kind 'correction' → DataCorrectionRequest (wrong anime / people / studio
 *                        facts — fixed by the data team, not moderators)
 *   kind 'report'     → Report (moderation queue)
 */

export type ReportCategoryId =
  | 'WRONG_INFO'
  | 'MISINFORMATION'
  | 'SPAM'
  | 'HARASSMENT'
  | 'HATE'
  | 'EXPLICIT'
  | 'SPOILER'
  | 'PIRACY'
  | 'IMPERSONATION'
  | 'COPYRIGHT'
  | 'BROKEN'
  | 'OTHER';

export interface ReportCategory {
  id: ReportCategoryId;
  label: string;
  hint: string;
  kind: 'correction' | 'report';
  /** Report.reason stored for kind 'report'. */
  reason?: string;
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  { id: 'WRONG_INFO', label: 'Wrong information', hint: 'An anime, episode, date, staff, character or studio detail is incorrect or missing.', kind: 'correction' },
  { id: 'MISINFORMATION', label: 'Misinformation', hint: 'False or misleading claims in a review, post, article or news story.', kind: 'report', reason: 'MISINFORMATION' },
  { id: 'SPAM', label: 'Spam or scam', hint: 'Ads, repeated posts, suspicious links or fake giveaways.', kind: 'report', reason: 'SPAM' },
  { id: 'HARASSMENT', label: 'Harassment or bullying', hint: 'Someone is being attacked, threatened or targeted.', kind: 'report', reason: 'HARASSMENT' },
  { id: 'HATE', label: 'Hate speech', hint: 'Attacks on people for who they are.', kind: 'report', reason: 'HATE' },
  { id: 'EXPLICIT', label: 'Sexual or violent content', hint: 'Explicit, graphic or disturbing content that shouldn’t be here.', kind: 'report', reason: 'OFFENSIVE' },
  { id: 'SPOILER', label: 'Unmarked spoilers', hint: 'Spoilers posted without a spoiler tag.', kind: 'report', reason: 'SPOILER_MISUSE' },
  { id: 'PIRACY', label: 'Piracy or illegal links', hint: 'Links to pirated anime, manga or illegal streams.', kind: 'report', reason: 'PIRACY' },
  { id: 'IMPERSONATION', label: 'Fake account or impersonation', hint: 'Pretending to be another person, a creator or OTAKUVA.', kind: 'report', reason: 'IMPERSONATION' },
  { id: 'COPYRIGHT', label: 'Copyright', hint: 'Your work is used here without permission.', kind: 'report', reason: 'COPYRIGHT' },
  { id: 'BROKEN', label: 'Something isn’t working', hint: 'A broken page, image, link or button.', kind: 'report', reason: 'BROKEN' },
  { id: 'OTHER', label: 'Something else', hint: 'Anything that doesn’t fit above.', kind: 'report', reason: 'OTHER' },
];

/** Report.reason values the API accepts (old ones kept for existing buttons). */
export const REPORT_REASONS = new Set([
  'SPAM',
  'HARASSMENT',
  'OFFENSIVE',
  'SPOILER',
  'MISINFORMATION',
  'OTHER',
  'HATE',
  'SPOILER_MISUSE',
  'PIRACY',
  'IMPERSONATION',
  'COPYRIGHT',
  'BROKEN',
]);

export const REASON_LABEL: Record<string, string> = {
  ...Object.fromEntries(REPORT_CATEGORIES.filter((c) => c.reason).map((c) => [c.reason!, c.label])),
  SPOILER: 'Unmarked spoilers',
};

/** "Which detail is wrong?" choices for Wrong information. */
export const CORRECTION_FIELDS = [
  'Title or names',
  'Synopsis / description',
  'Dates or season',
  'Episodes or runtime',
  'Studio or staff',
  'Characters or voice cast',
  'Genres or tags',
  'Poster, banner or photo',
  'Streaming links',
  'Something else',
] as const;
