-- Shared rate-limit hits (2026-11-06). One row per counted request, so
-- every server instance sees the same counts (Vercel has no Redis).
-- Additive only. Rows older than a day are swept by the app.
CREATE TABLE "RateLimitHit" (
    "id" BIGSERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RateLimitHit_key_at_idx" ON "RateLimitHit"("key", "at");
CREATE INDEX "RateLimitHit_at_idx" ON "RateLimitHit"("at");
