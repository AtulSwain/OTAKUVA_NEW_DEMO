export type MediaIssueCode =
  | 'MEDIA_REQUIRED'
  | 'VIDEO_REQUIRED'
  | 'URL_REQUIRED'
  | 'INVALID_IMAGE_URL'
  | 'INVALID_VIDEO_URL'
  | 'INVALID_CLICK_URL'
  | 'INVALID_PLACEMENT';

type MediaInput = {
  placement?: unknown;
  imageUrl?: unknown;
  videoUrl?: unknown;
  clickUrl?: unknown;
  url?: unknown;
  videoUrlRequired?: unknown;
  clickUrlRequired?: unknown;
};

export const SPONSOR_AD_PLACEMENTS = {
  HOME: 'HOME_ABOVE_HYPE',
  ANIME: 'ANIME_PAGE',
} as const;

/** Most enabled ads a placement can hold. Anime pages rotate them evenly, one per view. */
export const MAX_ADS_PER_PLACEMENT = {
  HOME_ABOVE_HYPE: 3,
  ANIME_PAGE: 20,
} as const;

export type SponsorAdPlacement =
  (typeof SPONSOR_AD_PLACEMENTS)[keyof typeof SPONSOR_AD_PLACEMENTS];

type MediaValidation =
  | { ok: true; imageUrl: string | null; videoUrl: string | null; clickUrl: string | null }
  | { ok: false; code: MediaIssueCode; error: string };

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateMonetizationMedia(input: MediaInput): MediaValidation {
  if (
    input.placement !== undefined &&
    input.placement !== SPONSOR_AD_PLACEMENTS.HOME &&
    input.placement !== SPONSOR_AD_PLACEMENTS.ANIME
  ) {
    return { ok: false, code: 'INVALID_PLACEMENT', error: 'Choose the homepage or anime page placement.' };
  }
  const imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : '';
  const videoUrl = typeof input.videoUrl === 'string' ? input.videoUrl.trim() : '';
  const rawClickUrl = input.clickUrl ?? input.url;
  const clickUrl = typeof rawClickUrl === 'string' ? rawClickUrl.trim() : '';

  if (!imageUrl && !videoUrl) {
    return { ok: false, code: 'MEDIA_REQUIRED', error: 'Add an image or video before publishing.' };
  }
  if (imageUrl && !/^\/(?:uploads|api\/media)\//.test(imageUrl) && !isHttpsUrl(imageUrl)) {
    return { ok: false, code: 'INVALID_IMAGE_URL', error: 'The image must use HTTPS or be an uploaded OTAKUVA image.' };
  }
  if (input.videoUrlRequired === true && !videoUrl) {
    return { ok: false, code: 'VIDEO_REQUIRED', error: 'Add a video URL or choose “No video URL required”.' };
  }
  if (videoUrl && !isHttpsUrl(videoUrl)) {
    return { ok: false, code: 'INVALID_VIDEO_URL', error: 'The video URL must use HTTPS.' };
  }
  if (input.clickUrlRequired === true && !clickUrl) {
    return { ok: false, code: 'URL_REQUIRED', error: 'Add a click-through URL or choose “No URL required”.' };
  }
  if (clickUrl && !isHttpsUrl(clickUrl)) {
    return { ok: false, code: 'INVALID_CLICK_URL', error: 'The click-through URL must use HTTPS.' };
  }

  return {
    ok: true,
    imageUrl: imageUrl || null,
    videoUrl: videoUrl || null,
    clickUrl: clickUrl || null,
  };
}
