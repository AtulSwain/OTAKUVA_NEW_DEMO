import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerTrailerUrl, trailerEmbedUrl } from '../src/lib/media/trailer';

test('provider trailer records become canonical links', () => {
  assert.equal(providerTrailerUrl('youtube', 'yTh0f4PGL_8'), 'https://www.youtube.com/watch?v=yTh0f4PGL_8');
  assert.equal(providerTrailerUrl('dailymotion', 'x7tgad0'), 'https://www.dailymotion.com/video/x7tgad0');
  assert.equal(providerTrailerUrl('youtube', null), null);
  assert.equal(providerTrailerUrl('youtube', 'not a real id!'), null);
  assert.equal(providerTrailerUrl('vimeo', '12345'), null);
});

test('stored trailer links play in the embedded player', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=tR8YH0G67Rk',
    'https://youtu.be/tR8YH0G67Rk',
    'https://www.youtube.com/embed/tR8YH0G67Rk',
    'https://www.youtube.com/watch?feature=share&v=tR8YH0G67Rk',
  ]) {
    const embed = trailerEmbedUrl(url)!;
    assert.ok(embed.startsWith('https://www.youtube-nocookie.com/embed/tR8YH0G67Rk?'), url);
    assert.ok(embed.includes('playsinline=1'));
  }
  assert.equal(
    trailerEmbedUrl('https://www.dailymotion.com/video/x7tgad0'),
    'https://www.dailymotion.com/embed/video/x7tgad0?autoplay=1'
  );
});

test('no trailer, or a link we cannot play, gives null (the page then says there is no trailer)', () => {
  assert.equal(trailerEmbedUrl(null), null);
  assert.equal(trailerEmbedUrl(''), null);
  assert.equal(trailerEmbedUrl('https://example.com/video.mp4'), null);
  // The old fallback played a YouTube *search* for the title — never again.
  assert.equal(trailerEmbedUrl('https://www.youtube.com/results?search_query=frieren'), null);
});
