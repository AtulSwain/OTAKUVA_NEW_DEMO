/**
 * OTAKUVA NEWS DATA ARCHITECTURE — TYPES & SCHEMAS (PHASES 8.1 → 8.5)
 * Comprehensive provider-independent types for Ingestion, Normalization, Deduplication, & Entity Intelligence.
 */

export type NewsCategory =
  | 'ANIME'
  | 'MANGA'
  | 'STUDIO'
  | 'INDUSTRY'
  | 'CAST'
  | 'STAFF'
  | 'RELEASE'
  | 'ANNOUNCEMENT'
  | 'TRAILER'
  | 'EVENT'
  | 'STREAMING'
  | 'MERCHANDISE'
  | 'BOX_OFFICE'
  | 'AWARDS'
  | 'PRODUCTION'
  | 'OTHER';

export const NEWS_CATEGORIES: NewsCategory[] = [
  'ANIME',
  'MANGA',
  'STUDIO',
  'INDUSTRY',
  'CAST',
  'STAFF',
  'RELEASE',
  'ANNOUNCEMENT',
  'TRAILER',
  'EVENT',
  'STREAMING',
  'MERCHANDISE',
  'BOX_OFFICE',
  'AWARDS',
  'PRODUCTION',
  'OTHER',
];

export type NewsStatus = 'INGESTED' | 'PENDING_REVIEW' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'REMOVED' | 'FAILED';

export type NewsContentType =
  | 'SOURCE_METADATA'
  | 'SOURCE_EXCERPT' // the source's opening paragraphs, verbatim (articleExcerpt.ts)
  | 'OTAKUVA_SUMMARY'
  | 'LICENSED_CONTENT'
  | 'USER_GENERATED_CONTENT';

export type ProviderHealthStatus = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'DISABLED';

export type MatchMethod = 'EXACT_TITLE' | 'EXACT_NAME' | 'ALIAS' | 'NORMALIZED' | 'FUZZY' | 'MANUAL';

export type MatchStatus = 'CONFIRMED' | 'REVIEW_REQUIRED' | 'REJECTED';

export type RelationType =
  | 'PRIMARY'
  | 'RELATED'
  | 'MENTIONED'
  | 'PRODUCED_BY'
  | 'DIRECTED_BY'
  | 'VOICED_BY'
  | 'ANNOUNCED_FOR';

export type DuplicateSignal = 'EXACT' | 'HIGH_CONFIDENCE' | 'POSSIBLE' | 'UNRELATED';

export type ProviderErrorCode =
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_UNAUTHORIZED'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'PROVIDER_SERVER_ERROR';

export type IngestionJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED';

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  statusCode?: number;
  retryAfterMs?: number;
  provider: string;
}

export interface NewsProviderConfig {
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiKey?: string;
  requestTimeoutMs: number;
  rateLimitPerMinute: number;
  syncEnabled: boolean;
}

/**
 * Raw article format emitted by any provider adapter before normalization and storage
 */
export interface RawNewsArticle {
  externalId: string;
  provider: string; // e.g. "ANN", "CRUNCHYROLL", "OFFICIAL_PRESS", "INTERNAL"
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  content?: string | null;
  contentType?: NewsContentType;
  sourceName: string;
  sourceUrl: string;
  canonicalUrl?: string | null;
  imageUrl?: string | null;
  author?: string | null;
  language?: string;
  category?: string;
  publishedAt: Date;
  tags?: string[];
  mentionedAnimeTitles?: string[];
  mentionedStudioNames?: string[];
  mentionedPeopleNames?: string[];
  seasonContext?: {
    season?: string; // "WINTER", "SPRING", "SUMMER", "FALL"
    year?: number;
  };
  episodeContext?: {
    episodeNumber?: number;
  };
  rawPayload?: any;
}

export interface NormalizedNewsArticle {
  externalId: string;
  provider: string;
  title: string;
  normalizedTitle: string;
  subtitle: string | null;
  slug: string;
  summary: string | null;
  content: string | null;
  contentType: NewsContentType;
  sourceName: string;
  sourceUrl: string;
  canonicalUrl: string;
  imageUrl: string | null;
  author: string | null;
  language: string;
  category: NewsCategory;
  publishedAt: Date;
  seasonContext?: {
    season?: string;
    year?: number;
  };
  episodeContext?: {
    episodeNumber?: number;
  };
}

export interface IngestionResult {
  jobId?: string;
  provider: string;
  totalFetched: number;
  createdCount: number;
  updatedCount: number;
  duplicatesDetected: number;
  entityMatchesCreated: number;
  reviewRequiredCount: number;
  failedCount: number;
  errors: string[];
  durationMs: number;
  status: IngestionJobStatus;
}

export interface NewsQueryOptions {
  category?: string;
  status?: string;
  provider?: string;
  sourceName?: string;
  animeId?: string;
  studioId?: string;
  personId?: string;
  clusterId?: string;
  query?: string;
  search?: string;
  startDate?: Date;
  endDate?: Date;
  dateRange?: 'today' | 'week' | 'month' | 'all';
  sortBy?: 'latest' | 'oldest' | 'relevance';
  page?: number;
  limit?: number;
  offset?: number;
  /**
   * Include articles the relevance classifier marked OFF_TOPIC. Off by
   * default so the public feed stays anime-only; admin tooling passes true to
   * review and correct classifications.
   */
  includeOffTopic?: boolean;
}

export interface CreateManualArticleInput {
  title: string;
  subtitle?: string;
  summary?: string;
  content?: string;
  contentType?: NewsContentType;
  sourceName?: string;
  sourceUrl?: string;
  canonicalUrl?: string;
  imageUrl?: string;
  author?: string;
  category?: NewsCategory;
  status?: NewsStatus;
  publishedAt?: Date;
  mentionedAnimeIds?: string[];
  mentionedStudioIds?: string[];
}

export interface AdminOverrideInput {
  title?: string;
  summary?: string;
  category?: NewsCategory;
  overrideReason?: string;
}

export interface EntityMatchCandidate {
  entityId: string;
  entityType: 'ANIME' | 'STUDIO' | 'PERSON';
  entityName: string;
  confidenceScore: number;
  matchMethod: MatchMethod;
  relationType: RelationType;
  status: MatchStatus;
  reason: string;
}
