import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { CloudinaryStorageProvider, readCloudinaryConfig, signCloudinaryParams } from '../src/lib/storage/cloudinaryStorageProvider';

describe('Cloudinary storage', () => {
  test('reads CLOUDINARY_URL or the three separate settings', () => {
    assert.deepEqual(readCloudinaryConfig({ CLOUDINARY_URL: 'cloudinary://123:abc@my-cloud' } as unknown as NodeJS.ProcessEnv), {
      apiKey: '123',
      apiSecret: 'abc',
      cloudName: 'my-cloud',
    });
    assert.deepEqual(
      readCloudinaryConfig({ CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' } as unknown as NodeJS.ProcessEnv),
      { cloudName: 'c', apiKey: 'k', apiSecret: 's' },
    );
    assert.equal(readCloudinaryConfig({} as unknown as NodeJS.ProcessEnv), null);
  });

  test('signature follows Cloudinary: sorted params + secret, sha1', () => {
    const sig = signCloudinaryParams({ timestamp: 1315060510, public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' }, 'abcd');
    const expected = crypto
      .createHash('sha1')
      .update('eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510abcd')
      .digest('hex');
    assert.equal(sig, expected);
  });

  test('public ids live under the otakuva folder; links map back to ids', () => {
    const p = new CloudinaryStorageProvider({ CLOUDINARY_URL: 'cloudinary://1:2@demo' } as unknown as NodeJS.ProcessEnv);
    assert.match(p.publicIdFor({ category: 'profile-avatar' }), /^otakuva\/avatars\/[0-9a-f]{24}$/);
    assert.match(p.publicIdFor({ category: 'list-banner' }), /^otakuva\/banners\//);
    assert.equal(p.publicIdFor({ category: 'general', customKey: 'avatars/abc.webp' }), 'otakuva/avatars/abc');
    assert.equal(p.publicIdFor({ category: 'general', customKey: '../../x.png' }), 'otakuva/x');
    assert.equal(
      p.extractPublicId('https://res.cloudinary.com/demo/image/upload/v1730000000/otakuva/avatars/abc.webp'),
      'otakuva/avatars/abc',
    );
    assert.equal(p.getPublicUrl('otakuva/avatars/abc'), 'https://res.cloudinary.com/demo/image/upload/otakuva/avatars/abc');
  });

  test('never deletes files outside its own folder', async () => {
    const p = new CloudinaryStorageProvider({ CLOUDINARY_URL: 'cloudinary://1:2@demo' } as unknown as NodeJS.ProcessEnv);
    assert.equal(await p.delete('/api/media/avatars/old.webp'), false);
    assert.equal(await p.delete('https://res.cloudinary.com/demo/image/upload/v1/someone-else/x.jpg'), false);
  });
});
