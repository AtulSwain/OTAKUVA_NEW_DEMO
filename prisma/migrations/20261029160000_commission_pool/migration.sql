-- Commission products become a shared pool rotated across anime pages.
-- animeId stays as an optional "pin to this anime"; existing rows keep theirs.
ALTER TABLE "CommissionProduct" ALTER COLUMN "animeId" DROP NOT NULL;
CREATE INDEX "CommissionProduct_enabled_position_idx" ON "CommissionProduct"("enabled", "position");
