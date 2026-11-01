import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  excerptFromFeedBody,
  excerptFromHtml,
  excerptFromText,
  isFetchableSourceUrl,
} from '../src/lib/engine/news/articleExcerpt';

const P1 =
  'A teaser trailer announced on Sunday that a film adaptation of the four-panel manga will open next year in Japanese theaters nationwide.';
const P2 =
  'The director is returning from the previous television anime, and the original cast will reprise their roles for the new film project.';
const P3 = 'This third paragraph should never be included because only the opening of the article is kept by the excerpt.';

test('takes the first two prose paragraphs of the article body, skipping menus and site notes', () => {
  const html = `
    <nav><p>News Latest News Anime News Manga News Reviews Interviews Features Database Polls Community Browse</p></nav>
    <div class="entry-content">
      <p>With their help, we can keep the site ad-free and pay a fair rate to our writers, so please support us.</p>
      <p><a href="/x">Aki <em>Hamaji</em></a>'s ${P1}</p>
      <p>${P2}</p>
      <p>${P3}</p>
    </div>`;
  const out = excerptFromHtml(html);
  assert.ok(out);
  const paras = out!.split('\n\n');
  assert.equal(paras.length, 2);
  assert.equal(paras[0], `Aki Hamaji's ${P1}`);
  assert.equal(paras[1], P2);
  assert.ok(!out!.includes('third paragraph'));
});

test('flat text keeps sentences in order and never skips one', () => {
  const text =
    'The official website unveiled a pair of additional cast and a teaser promotional video on Sunday. ' +
    'The anime series will premiere on TBS affiliate networks at 11:56 p.m. on January 7, 2027. ' +
    'Voice actors Shinnosuke Tachibana and Tomohiro Oono are joining the cast, respectively. ' +
    'A short anime adaptation will begin airing on November...';
  const out = excerptFromText(text)!;
  assert.ok(out.includes('TBS affiliate networks at 11:56 p.m. on January 7, 2027.'), 'a real sentence was dropped');
  assert.ok(!out.includes('November...'), 'a sentence the feed cut off was kept');
});

test('abbreviations are not treated as sentence ends', () => {
  const sentence = 'Joji Furuta directs the anime at Pierrot Films, with Shu Matsubura (Mr. Villain) composing the series.';
  const out = excerptFromText(`${sentence} ${P1} ${P2}`)!;
  assert.ok(out.includes('(Mr. Villain) composing the series.'));
});

test('feed shortcodes and non-English blocks are removed', () => {
  const body =
    '[sourceLink asin="" url="" ] [en]What You Need to Know: [/en][es]Lo que necesitas saber: [/es] ' +
    `${P1} ${P2}`;
  const out = excerptFromFeedBody(body)!;
  assert.ok(!out.includes('['));
  assert.ok(!out.includes('Lo que'));
  assert.ok(out.startsWith('A teaser trailer'));
});

test('too little text gives no excerpt rather than a made-up one', () => {
  assert.equal(excerptFromText('Season 2 of the new anime will premiere in 2027'), null);
  assert.equal(excerptFromHtml('<div><p>Short.</p></div>'), null);
});

test('only known news sites are fetched', () => {
  assert.equal(isFetchableSourceUrl('https://www.animenewsnetwork.com/news/2026-11-01/x/.1'), true);
  assert.equal(isFetchableSourceUrl('https://animecorner.me/some-story/'), true);
  assert.equal(isFetchableSourceUrl('https://evil.example.com/animecorner.me'), false);
  assert.equal(isFetchableSourceUrl('http://127.0.0.1/admin'), false);
  assert.equal(isFetchableSourceUrl('file:///etc/passwd'), false);
});
