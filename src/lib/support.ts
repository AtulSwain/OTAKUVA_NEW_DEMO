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

/**
 * Business contact (2026-11-04, owner): ONE address for partnerships,
 * advertising, press and media, shown in "Contact us" on /support. Set
 * NEXT_PUBLIC_BUSINESS_EMAIL (the owner's OTAKUVA Gmail); empty = the section
 * stays hidden rather than show an address that can't receive mail.
 */
export const BUSINESS_EMAIL = process.env.NEXT_PUBLIC_BUSINESS_EMAIL?.trim() || '';
export const BUSINESS_SUBJECT = 'OTAKUVA – Business enquiry';

export const businessMailto = (subject = BUSINESS_SUBJECT): string =>
  `mailto:${BUSINESS_EMAIL}?subject=${encodeURIComponent(subject)}`;

/** "Advertise with us" in the footer: the business address when set, else support. */
export const advertiseMailto = (): string =>
  `mailto:${BUSINESS_EMAIL || SUPPORT_EMAIL}?subject=${encodeURIComponent('Advertising with OTAKUVA')}`;
