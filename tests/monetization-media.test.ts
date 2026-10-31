import assert from 'node:assert/strict';
import test from 'node:test';
import { SPONSOR_AD_PLACEMENTS, validateMonetizationMedia } from '../src/lib/monetization/mediaValidation';

test('image-only media publishes without requiring a video URL, title, or click-through URL', () => {
  const result = validateMonetizationMedia({
    imageUrl: '/uploads/campaign.webp',
  });

  assert.deepEqual(result, {
    ok: true,
    imageUrl: '/uploads/campaign.webp',
    videoUrl: null,
    clickUrl: null,
  });
});

test('requires a click-through URL only when explicitly selected', () => {
  assert.deepEqual(
    validateMonetizationMedia({ imageUrl: '/uploads/campaign.webp', clickUrlRequired: true }),
    {
      ok: false,
      code: 'URL_REQUIRED',
      error: 'Add a click-through URL or choose “No URL required”.',
    },
  );
});

test('accepts commission product URL field as the click-through destination', () => {
  assert.deepEqual(
    validateMonetizationMedia({
      imageUrl: '/uploads/product.webp',
      url: 'https://www.amazon.in/dp/example',
      clickUrlRequired: true,
    }),
    {
      ok: true,
      imageUrl: '/uploads/product.webp',
      videoUrl: null,
      clickUrl: 'https://www.amazon.in/dp/example',
    },
  );
});

test('requires a video URL only when explicitly selected', () => {
  assert.deepEqual(
    validateMonetizationMedia({ imageUrl: '/uploads/campaign.webp', videoUrlRequired: true }),
    {
      ok: false,
      code: 'VIDEO_REQUIRED',
      error: 'Add a video URL or choose “No video URL required”.',
    },
  );
});

test('allows both supported sponsor ad placements and rejects unknown placements', () => {
  for (const placement of Object.values(SPONSOR_AD_PLACEMENTS)) {
    assert.equal(
      validateMonetizationMedia({ placement, imageUrl: '/uploads/campaign.webp' }).ok,
      true,
    );
  }
  assert.deepEqual(
    validateMonetizationMedia({ placement: 'UNSUPPORTED', imageUrl: '/uploads/campaign.webp' }),
    {
      ok: false,
      code: 'INVALID_PLACEMENT',
      error: 'Choose the homepage or anime page placement.',
    },
  );
});

test('supports video-only linked media and rejects an item with no media', () => {
  assert.deepEqual(
    validateMonetizationMedia({
      videoUrl: 'https://media.example/campaign.mp4',
      clickUrl: 'https://sponsor.example/campaign',
    }),
    {
      ok: true,
      imageUrl: null,
      videoUrl: 'https://media.example/campaign.mp4',
      clickUrl: 'https://sponsor.example/campaign',
    },
  );
  assert.deepEqual(
    validateMonetizationMedia({}),
    {
      ok: false,
      code: 'MEDIA_REQUIRED',
      error: 'Add an image or video before publishing.',
    },
  );
});

test('requires secure URLs for linked media', () => {
  assert.deepEqual(
    validateMonetizationMedia({
      videoUrl: 'http://media.example/campaign.mp4',
    }),
    {
      ok: false,
      code: 'INVALID_VIDEO_URL',
      error: 'The video URL must use HTTPS.',
    },
  );
});
