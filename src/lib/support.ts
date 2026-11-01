/**
 * Support contact (2026-11-01, owner). One place for the address so the
 * footer and any later "contact us" link agree. NEXT_PUBLIC_SUPPORT_EMAIL
 * overrides it (e.g. while the otakuva.com mailbox isn't set up yet).
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || 'support@otakuva.com';

export const SUPPORT_SUBJECT = 'OTAKUVA – Support Request';

/** Plain address link: opens the default mail app. */
export const supportMailto = (): string => `mailto:${SUPPORT_EMAIL}`;

/** Pre-addressed email with the support subject filled in. */
export const supportRequestMailto = (): string => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUPPORT_SUBJECT)}`;
