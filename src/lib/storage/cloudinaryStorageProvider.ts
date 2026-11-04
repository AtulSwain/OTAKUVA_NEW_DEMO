import crypto from 'crypto';
import { StorageProvider, UploadOptions, UploadResult } from './types';

/**
 * Cloudinary storage (2026-11-04, owner: replaces the Cloudflare R2 bucket;
 * free plan = 25 credits ≈ 25 GB). Uses Cloudinary's REST upload API with a
 * signed request — no SDK, the API secret never leaves the server.
 *
 * Env (server-only): either CLOUDINARY_URL ("cloudinary://<key>:<secret>@<cloud>",
 * as shown on the Cloudinary dashboard) or CLOUDINARY_CLOUD_NAME +
 * CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET. Optional CLOUDINARY_FOLDER
 * (default "otakuva").
 *
 * Stored URL = Cloudinary's https `secure_url` (res.cloudinary.com/…), which
 * already sits on its CDN. storageKey = the Cloudinary public_id.
 */

export class CloudinaryAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudinaryAuthError';
  }
}

interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function readCloudinaryConfig(env: NodeJS.ProcessEnv = process.env): CloudinaryConfig | null {
  const url = env.CLOUDINARY_URL?.trim();
  if (url) {
    const m = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (m) return { apiKey: decodeURIComponent(m[1]), apiSecret: decodeURIComponent(m[2]), cloudName: m[3].replace(/\/+$/, '') };
  }
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim();
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

/** Cloudinary's signature: sha1 of the sorted "k=v&k=v" params + the API secret. */
export function signCloudinaryParams(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
}

function folderFor(category: string): string {
  return category.includes('banner') ? 'banners' : category.includes('avatar') || category === 'community-icon' ? 'avatars' : 'media';
}

export class CloudinaryStorageProvider implements StorageProvider {
  public name = 'cloudinary';
  private config: CloudinaryConfig | null;
  private rootFolder: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.config = readCloudinaryConfig(env);
    this.rootFolder = (env.CLOUDINARY_FOLDER?.trim() || 'otakuva').replace(/^\/+|\/+$/g, '');
  }

  public isConfigured(): boolean {
    return this.config !== null;
  }

  /** e.g. "otakuva/avatars/a7f2918b9c0d…" (no extension — Cloudinary keeps the format). */
  public publicIdFor(options: Pick<UploadOptions, 'category' | 'customKey'>): string {
    if (options.customKey) {
      const cleaned = options.customKey.replace(/\.\./g, '').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\.[a-z0-9]+$/i, '');
      return `${this.rootFolder}/${cleaned}`;
    }
    return `${this.rootFolder}/${folderFor(options.category)}/${crypto.randomBytes(12).toString('hex')}`;
  }

  public async upload(options: UploadOptions): Promise<UploadResult> {
    if (!this.config) throw new Error('Cloudinary is not configured (set CLOUDINARY_URL).');
    const { file, mimeType, maxSizeBytes } = options;
    if (maxSizeBytes && file.length > maxSizeBytes) {
      throw new Error(`File is too large. Maximum allowed size is ${Math.round(maxSizeBytes / (1024 * 1024))} MB.`);
    }

    const publicId = this.publicIdFor(options);
    const timestamp = Math.floor(Date.now() / 1000);
    const signed = { public_id: publicId, timestamp, overwrite: 'true' };
    const signature = signCloudinaryParams(signed, this.config.apiSecret);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(file)], { type: mimeType }), options.filename || 'upload');
        form.append('public_id', publicId);
        form.append('timestamp', String(timestamp));
        form.append('overwrite', 'true');
        form.append('api_key', this.config.apiKey);
        form.append('signature', signature);

        const res = await fetch(`https://api.cloudinary.com/v1_1/${this.config.cloudName}/image/upload`, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json().catch(() => ({}))) as { secure_url?: string; public_id?: string; bytes?: number; error?: { message?: string } };
        if (res.status === 401 || res.status === 403) {
          throw new CloudinaryAuthError(`Cloudinary rejected the credentials (HTTP ${res.status}): ${data.error?.message ?? 'check CLOUDINARY_URL'}`);
        }
        if (!res.ok || !data.secure_url) {
          throw new Error(`Cloudinary upload failed (HTTP ${res.status}): ${data.error?.message ?? 'no URL returned'}`);
        }
        return {
          url: data.secure_url,
          filename: publicId.split('/').pop() || publicId,
          size: data.bytes ?? file.length,
          mimeType,
          provider: 'cloudinary',
          storageKey: data.public_id ?? publicId,
        };
      } catch (err) {
        if (err instanceof CloudinaryAuthError) throw err;
        lastError = err;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2 ** attempt * 200 + Math.floor(Math.random() * 100)));
      }
    }
    throw new Error(`Cloudinary upload failed after 3 attempts: ${(lastError as Error)?.message ?? 'unknown error'}`);
  }

  /** public_id from a res.cloudinary.com URL (or the id itself). */
  public extractPublicId(urlOrId: string): string | null {
    if (!urlOrId) return null;
    const s = urlOrId.trim();
    if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, '') || null;
    const m = s.match(/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i);
    return m ? decodeURIComponent(m[1]) : null;
  }

  public async delete(publicUrlOrKey: string): Promise<boolean> {
    if (!this.config) return false;
    const publicId = this.extractPublicId(publicUrlOrKey);
    if (!publicId || !publicId.startsWith(`${this.rootFolder}/`)) return false; // only ever delete our own files
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signCloudinaryParams({ public_id: publicId, timestamp }, this.config.apiSecret);
    const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: this.config.apiKey, signature });
    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${this.config.cloudName}/image/destroy`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as { result?: string };
      return res.ok && (data.result === 'ok' || data.result === 'not found');
    } catch {
      return false;
    }
  }

  public getPublicUrl(publicIdOrUrl: string): string {
    if (/^https?:\/\//i.test(publicIdOrUrl)) return publicIdOrUrl;
    const cloud = this.config?.cloudName ?? 'unknown';
    return `https://res.cloudinary.com/${cloud}/image/upload/${publicIdOrUrl.replace(/^\/+/, '')}`;
  }
}
