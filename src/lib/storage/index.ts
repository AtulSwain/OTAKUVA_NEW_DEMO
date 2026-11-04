import { StorageProvider, UploadOptions, UploadResult } from './types';
import { LocalStorageProvider } from './localStorageProvider';
import { R2AuthError, R2StorageProvider } from './r2StorageProvider';
import { CloudinaryStorageProvider } from './cloudinaryStorageProvider';

let storageInstance: StorageProvider | null = null;

/**
 * Development only: R2 first, but if R2 rejects the credentials (revoked or
 * rolled token) switch this process to local storage instead of failing
 * every profile/banner/community upload. Production never uses this — a
 * bad token there must fail loudly, not quietly write to ephemeral disk.
 *
 * Also (2026-10-28): if the public image address (MEDIA_PUBLIC_URL, e.g. a
 * custom domain that isn't set up yet) can't be reached at all, uploads
 * would succeed but every image link would be broken — so this dev server
 * stores them locally instead and they show up on localhost.
 */
export class DevR2WithLocalFallback implements StorageProvider {
  public name = 'r2';
  private local: LocalStorageProvider | null = null;

  constructor(
    private readonly r2: Pick<R2StorageProvider, 'upload' | 'delete' | 'getPublicUrl'>,
    /** How to tell whether the public image address answers (swappable for tests). */
    private readonly isReachable: (url: string) => Promise<boolean> = (url) =>
      fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) }).then(
        () => true,
        () => false,
      ),
  ) {}

  private publicReachable: Promise<boolean> | null = null;

  /** Does the public image address answer at all? (any HTTP status counts; a DNS/connection failure doesn't) */
  private publicUrlWorks(): Promise<boolean> {
    if (!this.publicReachable) {
      const base = this.r2.getPublicUrl('');
      this.publicReachable = this.isReachable(base).then((ok) => {
        if (!ok) console.warn(`[Storage] Public image address ${base} is not reachable (check MEDIA_PUBLIC_URL). Using local storage (public/uploads) for this dev server.`);
        return ok;
      });
    }
    return this.publicReachable;
  }

  private fallback(): LocalStorageProvider {
    if (!this.local) {
      this.local = new LocalStorageProvider();
      this.name = 'local';
    }
    return this.local;
  }

  async upload(options: UploadOptions): Promise<UploadResult> {
    if (this.local) return this.local.upload(options);
    if (!(await this.publicUrlWorks())) return this.fallback().upload(options);
    try {
      return await this.r2.upload(options);
    } catch (err) {
      if (!(err instanceof R2AuthError)) throw err;
      console.warn(`[Storage] ${err.message} Falling back to local storage (public/uploads) for this dev server.`);
      return this.fallback().upload(options);
    }
  }

  async delete(publicUrlOrKey: string): Promise<boolean> {
    // Local files are served from /uploads/…; everything else lives in R2.
    if (publicUrlOrKey?.startsWith('/uploads/')) return this.fallback().delete(publicUrlOrKey);
    return this.r2.delete(publicUrlOrKey);
  }

  getPublicUrl(relativePathOrKey: string): string {
    return this.local ? this.local.getPublicUrl(relativePathOrKey) : this.r2.getPublicUrl(relativePathOrKey);
  }
}

export function getStorageProvider(): StorageProvider {
  if (!storageInstance) {
    const providerType = process.env.STORAGE_PROVIDER || 'local';

    // Cloudinary (2026-11-04, owner): replaces R2. Old R2 files keep working
    // through the /api/media relay until scripts/migrate_r2_to_cloudinary.ts
    // has copied them and rewritten their links.
    // Cloudinary keys present → Cloudinary, even if STORAGE_PROVIDER still says
    // "r2" (so a deploy switches over without an env-var race). Only an
    // explicit STORAGE_PROVIDER="local" keeps files on disk.
    const cloudinaryReady = new CloudinaryStorageProvider().isConfigured();
    if (providerType === 'cloudinary' || (cloudinaryReady && providerType !== 'local')) {
      const cloudinary = new CloudinaryStorageProvider();
      if (cloudinary.isConfigured()) {
        storageInstance = cloudinary;
      } else if (process.env.NODE_ENV === 'production') {
        throw new Error('STORAGE_PROVIDER is "cloudinary" but CLOUDINARY_URL is not set.');
      } else {
        console.warn('[Storage] STORAGE_PROVIDER is "cloudinary" but CLOUDINARY_URL is not set. Using local storage (public/uploads) for development.');
        storageInstance = new LocalStorageProvider();
      }
    } else if (providerType === 'r2') {
      const r2 = new R2StorageProvider();
      if (r2.isConfigured()) {
        storageInstance = process.env.NODE_ENV === 'production' ? r2 : new DevR2WithLocalFallback(r2);
      } else {
        console.warn(
          '[Storage] STORAGE_PROVIDER is set to "r2", but R2 credentials are not configured. Falling back to LocalStorageProvider for development.'
        );
        storageInstance = new LocalStorageProvider();
      }
    } else {
      storageInstance = new LocalStorageProvider();
    }
  }

  return storageInstance;
}

export * from './types';
export * from './imageValidator';
export * from './imageProcessor';
export * from './r2StorageProvider';
export * from './cloudinaryStorageProvider';
export * from './localStorageProvider';
