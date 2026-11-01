# OTAKUVA

Anime knowledge, discovery, tracking, and community platform. Package name is
still `anilog` (legacy) — the product and UI brand is **OTAKUVA**. Do not
rename the package without asking; it touches lockfiles/CI.

## What this is not

Not a streaming site, not a MyAnimeList/AniList clone, not an API-response
frontend, not a static catalog, not a generic social network. It's a
connected knowledge graph: Anime ↔ Characters ↔ Voice Actors ↔ Staff ↔
Studios ↔ Franchises ↔ News ↔ History ↔ Community ↔ personal tracking.

## Architecture (already in place — extend it, don't bypass it)

```
External providers → Provider Adapters → Ingestion/Sync → Normalization →
Entity Resolution → Prisma (canonical DB) → Next.js API routes → Frontend
```

The frontend (`src/app`, `src/components`) must **never** call a third-party
API directly — always through `src/app/api/**` reading from Prisma.
Provider-specific logic stays inside `src/lib/providers/**` /
`src/lib/news/**`, never in components (no `if provider === 'jikan'` in UI).

- **Provider interfaces**: `src/lib/providers/animeProvider.interface.ts`
  (`AnimeProvider`), `src/lib/news/newsProvider.interface.ts`. New providers
  implement the interface and register in `src/lib/providers/index.ts`
  (selected via `ANILOG_PROVIDER` / `PREFERRED_PROVIDER` env var).
- **Current adapters**: `anilistProvider` (default), `jikanProvider`,
  `danbooruProvider` (media), `annNewsProvider` (news).
- **Anime provider failover** (added 2026-09-14,
  `src/lib/providers/failoverProvider.ts`): `getFailoverProvider(name)` /
  `defaultAnimeProvider` wrap the preferred adapter with automatic retry
  against the other registered one when a call throws, times out
  (`PROVIDER_FAILOVER_TIMEOUT_MS`, default 20s), or — for
  episodes/characters/staff specifically, not relations, which are
  legitimately often empty — comes back an empty array. `syncEngine.ts`'s
  `getProvider()` routes through this, so `ingestAnime`/`syncEpisodes`/
  `syncCharacters`/`syncStaff` get it automatically; `ingestAnime` also
  trusts `ProviderAnime.externalSource` over its `providerName` param so
  provenance is still correct when failover actually served the data.
  Per-anime provenance for episodes/characters/staff is now recorded via
  `DataSourceRecord` (previously only written for the anime record
  itself). Health + a bounded recent-failover-event log
  (`src/lib/providers/providerHealth.ts`, in-memory/process-local, same
  pattern as `providerMetrics`) surface at `/admin/data`, via
  `GET /api/admin/data`'s `providerFailover` field. Never fabricates: if
  every registered adapter fails, it throws; if every adapter returns
  something incomplete, it returns the best real (if partial) result
  rather than nothing — still never invents data.
- **Canonical DB**: `prisma/schema.prisma` (~65 models). Key groups:
  - Core entities: `Anime`, `AnimeTitle`, `AnimeExternalId`, `Studio`,
    `Person`, `Character`, `Franchise`, `Episode`, `Genre`, `Theme`,
    `Producer`, `Licensor`, plus join tables (`AnimeStudio`,
    `AnimeCharacter`, `AnimeStaff`, `AnimeRelation`, `FranchiseAnime`, …).
  - Provenance / sync: `SyncJob`, `SyncCheckpoint`, `DataSourceRecord`,
    `ProviderPayload`, `DeadLetterQueue`.
  - Conflict/editorial layer: `DataConflict`, `EditorialOverride`,
    `DataCorrectionRequest`, `AnimeMetadataHistory`, `PotentialDuplicate`.
  - News: `NewsArticle` + `NewsArticleAnime/Studio/Person` link tables.
  - Users/community: `User`, `UserAnime`, `UserEpisodeProgress`,
    `AnimeRating`, `Review`, `Favorite`, `Community*`, `Discussion*`,
    `Report`, `ModerationAction`, `UserList*`, `Activity`, `Follow`,
    `Notification`.
- **Admin/Data Studio (early)**: `src/app/admin/data/`,
  `src/app/api/admin/{data,sync,datacenter}`. Treat this as the seed of the
  full Data Studio (§45–52 of the original spec) — extend, don't replace.

## Non-negotiable rules

1. **Three data layers** — never blur them: (1) raw provider data, (2)
   normalized canonical DB rows, (3) human-verified editorial data
   (`EditorialOverride`). Editorial/manual values win and must not be
   silently overwritten by sync.
2. **No hallucinated data.** Missing info stays missing (`null` /
   unverified) or goes to a review/conflict queue — never invented anime,
   dates, staff, quotes, sources, or stats.
3. **User data is sacred.** Sync/import jobs must never touch `UserAnime`,
   ratings, reviews, favorites, lists, follows, community posts, profiles,
   settings.
4. **No hardcoded production catalogs.** No `const anime = [...]` for real
   content in components — DB is the source of truth. Fixtures under
   `src/fixtures/` are dev/seed only, never treated as production data.
5. **Provenance on everything imported**: source provider, external id,
   fetched/verified timestamps. Don't drop this to save a join.
6. **Failure isolation**: a provider outage or malformed response must never
   cascade into deleting/blanking existing DB rows. Sync failures go to
   `DeadLetterQueue` / retry, not silent deletion.
7. **Secrets** stay server-side only (env vars), never in client bundles or
   committed files. See `.env.example` for the current variable set.
8. **Conflicts are explicit**: disagreeing provider values create a
   `DataConflict` row for admin resolution, not a silent overwrite.

## When requirements conflict, priority order

Security → data integrity → reliability → correctness → maintainability →
performance → accessibility → UX polish → visual effects. Never trade
security or data integrity for polish.

## Additional production rules (from the extended charter)

- **Deletion safety**: a provider returning 404/empty/null/a temporary error
  must never be interpreted as "delete this entity." Deletion requires
  explicit, verified logic — treat provider silence as a sync failure
  (`DeadLetterQueue`/retry), not evidence of removal.
- **Source trust isn't uniform.** Not all providers/sources are equally
  authoritative; treat authority as configurable per-field where it matters
  (e.g. a studio's founding year: official source > structured provider >
  secondary source > community claim), not a single global provider
  priority.
- **Review queue over silent action.** Uncertain entity matches, conflicting
  values, suspicious data, and manual submissions go to a review queue
  rather than being auto-accepted or auto-merged. "Verified" means an admin
  or a sufficiently trusted source confirmed it — not merely that an API
  returned it.
- **Migrations**: prefer expand → migrate → contract over destructive
  in-place changes; avoid irreversible migrations unless there's no
  alternative; back up before destructive schema changes.
- **RBAC roles (target, not yet implemented)**: User, Moderator, News
  Editor, Data Editor, Media Manager, Administrator, Super Administrator.
  `User.role` doesn't exist yet in the schema — see gap list below.
- **Never** log secrets, expose full secrets in admin UI, or trust client
  input without server-side validation, even on admin routes.

## Build phases (target order) vs. current state

The charter's intended build order is: Foundation → Knowledge core →
Provider system → History → News → User platform → Community → Data Studio
→ Discovery → Production hardening. This repo has already gone wide across
most phases at a scaffold level rather than strictly sequential depth. Known
gaps against later phases, from the last audit (2026-08-28):

- ~~No background job queue~~ — fixed for the six job kinds that used to
  run inline: `POST /api/admin/sync`, `POST /api/admin/anime/import`, and
  schedule/news sync now enqueue onto a BullMQ + Redis queue
  (`otakuva-sync`, `src/lib/queue/**`) instead of blocking the request;
  `scripts/worker.ts` (run as a second process — `npm run worker`, see
  `docs/production/RUNBOOK.md` §6) consumes it. 5 attempts, exponential
  backoff; only exhausted retries reach `DeadLetterQueue`. Each job
  updates its `SyncJob` row (PENDING → RUNNING → COMPLETED/FAILED/PAUSED/
  CANCELLED) so the existing admin UI/routes that already read that table
  (`GET /api/admin/anime/import`, `/api/admin/data`, `/api/admin/
  datacenter`) needed no contract change. `sync:airing`,
  `sync:broadcast-schedule`, and `news-sync` also run on their own
  BullMQ-native recurring schedule now (`src/lib/queue/recurring.ts`,
  registered by the worker on startup) — a real scheduler for these
  specifically, not the general-purpose one this item originally meant;
  same for `episode-backfill` (added 2026-09-14, every 2min — see the
  episode-import-truncation note above for what it does), which is
  recurring-only and never had a manual-trigger route/script at all.
  There's still no UI to manage arbitrary recurring jobs or a queue for
  the other long-running crawl scripts (`full_catalog_sync.ts`,
  `backfill_staff_characters.ts`, etc.), which stay hand-run. Needs a
  reachable `REDIS_URL` (`.env.example`); without it, enqueue calls fail
  fast (a few hundred ms) rather than hang, and the worker retries its
  own startup a few times before giving up. `scripts/retry_dead_letters.ts`
  (added 2026-09-14) is a separate, still-manual/`--daemon` sweep of
  DeadLetterQueue itself (retry + archive old exhausted entries — see
  `src/lib/deadLetter.ts`); it isn't yet one of the queue's recurring
  jobs, so it's the next natural candidate to fold in.
- **No error tracking / ad-hoc console logging** — partially fixed
  2026-09-14. `@sentry/nextjs` wired into all three runtimes
  (`sentry.server.config.ts`, `sentry.edge.config.ts`,
  `src/instrumentation-client.ts`, root-error boundary at
  `src/app/global-error.tsx`) — captures unhandled exceptions everywhere,
  request route/method context, and the authenticated user's id only
  (never email/username/role); every event scrubbed for anything
  secret-shaped (`src/lib/observability/sentryScrub.ts`) before sending.
  No-ops with no `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` set — see
  `docs/production/RUNBOOK.md` §8. `src/lib/logger.ts` is the new
  structured logger (route/method/status/latency/userId context, JSON
  lines, `error()` always reaches Sentry, `warn()` only with
  `{toSentry: true}` — most warns are routine retry noise, not something
  worth alerting on). Wired into `src/lib/api/apiHandler.ts` (so every
  route using `withApiHandler` gets structured logging + Sentry user
  context automatically) plus `src/lib/queue/**`, `src/lib/performance/
  cacheManager.ts`, `src/lib/syncEngine.ts`, `src/lib/jikanService.ts`.
  **Not done**: converting the remaining ~280 files under `src/app/api/**`
  and `src/lib/**` that still call `console.*` directly — genuinely out of
  scope for one pass (291 files/1,152 call sites total at the start of
  this work; a blind mechanical find/replace across that many files
  risked silently changing error-handling behavior in ways worth
  individual review, not a shortcut worth taking). Use `logger`, not
  `console.*`, in anything you touch from here — the migration is meant
  to happen incrementally, not in one sweep. `scripts/**` is deliberately
  untouched — those are interactive CLI tools where human-readable
  `console.log` progress output is the right UX, not JSON lines.
- ~~No platform-level RBAC~~ — fixed: `User.role` + `src/lib/roles.ts`
  (`requireRole` / `hasMinRole`). Use those; don't compare role strings.
- ~~No automated tests~~ — `npm test` (node:test via tsx, `tests/**`) runs
  route handlers against a throwaway Postgres database now (was SQLite —
  see below). Never write tests that touch the real `otakuva` database;
  the old `src/lib/test_*.ts` scripts did (against `prisma/dev.db`) and
  polluted the catalog with fixtures.
- ~~SQLite dev DB~~ — migrated to PostgreSQL 2026-09-14. `prisma/schema.prisma`'s
  datasource is `postgresql`; migration history was reset to one fresh
  baseline (`prisma/migrations/20260914130000_init_postgresql`) rather than
  replaying the old SQLite-flavored SQL — see that migration's `.sql` file.
  All 61,673 rows across 119 tables were copied from `prisma/dev.db` into
  the new `otakuva` Postgres database via `scripts/migrate_sqlite_to_postgres.ts`
  (verified: every table's row count matches, FK constraints re-enabled
  and confirmed enforced afterward, spot-checked relations intact). Local
  dev now needs a running Postgres (role `otakuva`, database `otakuva` —
  see `.env.example`); `prisma/dev.db` is kept locally only as a migration
  source / rollback reference, not read by anything at runtime anymore.
  `tests/helpers/setupTestDb.ts` now creates a throwaway Postgres database
  per test file instead of a throwaway SQLite file (`npx tsx
  scripts/reset_test_dbs.ts` sweeps up any orphaned ones a killed run left
  behind). Full details, including the Postgres service setup, in
  `docs/production/RUNBOOK.md`.
  **Flagged while migrating — a real, confirmed behavioral regression,
  not just a theoretical one:** Prisma's `contains`/`startsWith`/`endsWith`
  string filters are case-**insensitive** on SQLite (its `LIKE` is
  ASCII-case-insensitive by default) but case-**sensitive** on Postgres
  unless `mode: 'insensitive'` is added explicitly — confirmed directly
  (`contains: 'frieren'` matched zero rows against "Frieren: Beyond
  Journey's End" without it). Fixed in the three places this was actually
  tested/user-facing: `src/lib/search.ts` and `src/app/api/search/route.ts`
  (the site's main search — was silently broken for any lowercase query
  against a properly-capitalized title) and `src/app/api/discussions/route.ts`
  (had a test, `tests/authorization.test.ts`'s "discussion search works
  and is case-insensitive" — its original assertion queried `?q=test`
  against a fixture titled "A test discussion", same case, so it never
  actually exercised case-insensitivity and wouldn't have caught this;
  strengthened to query `?q=TEST` instead). **Update 2026-09-16**: two
  more of the 29 are now fixed, not via a bare `mode: 'insensitive'` but
  superseded entirely by real search infrastructure —
  `src/lib/engine/anime/animeCatalogEngine.ts` (this was the live bug of
  the group: it's the query behind `GET /api/anime`, the actual
  catalog/browse page, and had zero test coverage) and
  `src/app/api/people/route.ts` — both now go through
  `src/lib/fuzzySearch.ts` (Postgres full-text + pg_trgm, case-insensitive
  by construction and typo-tolerant besides — see
  `docs/production/SEARCH.md`). **Still not fixed, flagged for review
  instead** — 27 more files use `contains`/`startsWith`/`endsWith`
  without `mode: 'insensitive'`, found via
  `grep -rln "contains:\|startsWith:\|endsWith:" src`: `src/app/api/people/[slug]/route.ts`,
  `src/lib/engine/community/communityEngine.ts`,
  `src/app/api/communities/[slug]/members/route.ts`, `src/lib/engine/news/newsEngine.ts`,
  `src/lib/engine/news/newsSearchService.ts`, `src/lib/engine/news/sourceRegistryService.ts`,
  `src/app/api/admin/reviews/route.ts`, `src/lib/engine/media/imageHealthService.ts`,
  `src/app/api/anime/airing/route.ts`, `src/lib/catalog/canonicalDeduplicationMigration.ts`,
  `src/lib/engine/studio/studioDeduplicationService.ts` (and 5 more `studio*Service.ts`
  files), `src/lib/engine/news/newsAdminService.ts`, `src/lib/engine/news/newsEntityMatcher.ts`,
  `src/lib/community/communityService.ts`, `src/app/api/admin/users/route.ts`,
  `src/lib/news/newsService.ts`,
  `src/app/api/producers/[slug]/route.ts`, `src/app/api/themes/[slug]/route.ts`,
  `src/app/api/genres/[slug]/route.ts`. Left alone deliberately rather than
  blanket-adding `mode: 'insensitive'` everywhere: some of these (dedup
  matching, entity-resolution matchers) may have specifically wanted
  exact-case substring matching, which needs a case-by-case read, not a
  mechanical find/replace across 29 files under a schema-migration task.
- **Character search doesn't exist** (found during the 2026-09-16 search
  audit above): `GET /api/characters/[slug]` only does an exact
  slug/id/name lookup; there's no `GET /api/characters?q=` and the global
  search widget (`/api/search/route.ts`) never queries `Character` at
  all. `Character.name` already has a `pg_trgm` GIN index
  (`docs/production/SEARCH.md`) and `src/lib/fuzzySearch.ts` exports
  `searchCharacterIdsByName` ready to use — this is a build-from-scratch
  route/UI task, not a migration, whenever it's prioritized.
  Separately: `AnimeTitle.searchableTitle` is written by three different,
  mutually inconsistent normalization functions across the ingestion/
  dedup pipeline (`syncEngine.ts`'s `normalizeSearchTitle()`,
  `canonicalDeduplicationMigration.ts`'s plain `.toLowerCase()`, and
  `entityResolver.ts`'s `CatalogNormalizer.generateSearchKey()`) — not
  fixed, and the new search indexes/queries deliberately don't depend on
  it being consistent (they work off raw `title`/`canonicalTitle`
  instead), but worth consolidating to one normalizer if anything else
  ever comes to rely on that column being trustworthy.
- **AniList public API recovered** (confirmed healthy 2026-09-12 — a
  direct GraphQL probe returned 200; the 403 "temporarily disabled" noted
  2026-09-11 was transient). It's still not the active default provider
  (`ANILOG_PROVIDER`/`PREFERRED_PROVIDER` — confirm current setting before
  assuming which one serves live traffic — **correction 2026-09-16**: the
  code-level default when neither is set is `'anilist'`, per
  `src/lib/providers/index.ts`'s `PREFERRED` constant and `.env.example`
  leaving `ANILOG_PROVIDER` blank — this note's "not the active default"
  claim doesn't match that; re-verify against whatever's actually set in
  each deployed environment rather than trusting either this note or the
  code default alone), but `syncEngine.syncWeeklySchedule`
  (AniList's `airingSchedule`, real per-episode timestamps for the next 7
  days) is usable again — re-verify health before relying on it, since it
  flipped once already. Which provider is actually the default matters
  beyond health/routing now too — see
  `docs/production/THIRD_PARTY_DATA_COMPLIANCE.md` for a real tension
  between AniList's terms of use and this being a tracking platform with
  no AniList account-sync feature.
- **Jikan itself is currently degraded** (first observed 2026-09-12, still
  ongoing as of this writing): `/anime/{id}/full` is served from Jikan's own
  cache and works, but every live-proxied endpoint —
  `/characters`, `/staff`, `/episodes`, `/relations`, `/pictures` — 504s with
  `"Jikan failed to connect to MyAnimeList"`, i.e. MAL itself, not our
  client or throttling, is refusing Jikan's live requests. Heavy 429s on
  top of that persist even with only one client process running, so this
  isn't purely a self-inflicted rate-limit either. New anime records still
  get created (via `/full`); staff/characters/episodes/relations for them
  come in empty until MAL recovers — re-run
  `scripts/backfill_staff_characters.ts` and `scripts/full_catalog_sync.ts`
  (or its `RETRY_FAILED=1` mode) once it does.
- ~~Pending owner sign-off: seeded persona / test accounts / fixture
  anime & studio / placeholder episodes~~ — **done 2026-09-14** via
  `scripts/cleanup_seed_fixtures.ts` (dry-run by default, `--apply` to
  write; backs up `prisma/dev.db` first and writes a full audit log to
  `scripts/cleanup_logs/*.json`, gitignored — PII). Deleted: `user_default`
  (cascaded its 4 ratings + 2 reviews); 17 test accounts, identified by
  email domain `@otakuva.com`/`@otakuva.test`/`@test.local` (cascaded
  their reviews/ratings and the 4 communities they owned —
  `secret-anime-society`, `test-req-community`, `notify-scope-check`,
  `open-join-check`; more than the audit's "3" since two post-date that
  snapshot); fixture anime `mind-paradox-*`/`daily-laughs-*` and studio
  `MAPPA AI Intelligence *` (after soft-deleting, then logging, 2
  surviving real-account reviews and 4 real-account ratings on them —
  AtulSwain, Harry, Atul, Hero were real accounts, not test fixtures);
  and the 161 placeholder "Episode N" rows (`title ~= /^Episode \d+$/ AND
  externalId IS NULL`, across Frieren/AoT Final Season/JJK S2/Vinland
  Saga S2/Apothecary Diaries/Cyberpunk: Edgerunners/Chainsaw Man/Dungeon
  Meshi — the other 55 "Episode N"-titled rows on long-running shows carry
  a real provider `externalId` and were left alone; the 29
  `UserEpisodeProgress` rows on the 161 all belonged to `user_default` and
  were already gone via its cascade). `Anime.score`/`scoredBy` were left
  untouched (provider-owned, per finding #3's fix); `RatingAggregate` was
  recomputed instead for the 4 real anime `user_default` had rated.
  DeadLetterQueue backlog (4,615 as of the 2026-09-11 audit, ~13,000+ as
  of 2026-09-12, 23,122 as of 2026-09-14 and still all `attempts: 1` /
  0 resolved — growing while Jikan is degraded, see above, and nothing
  was sweeping it; run `npx tsx scripts/retry_dead_letters.ts` once Jikan
  recovers, or `--daemon` to keep sweeping) is still open. Also noted in
  passing: ~16,561 distinct MAL ids across the 23,122 rows — duplicate
  DLQ rows per id accumulate because the ingest path always `create`s
  rather than upserting on `(provider, entityType, externalId)`; not
  fixed here, flagging for whoever next touches `syncFullCatalogById`.
- Episode import for long runners is truncated (e.g. Naruto 100/220,
  One Piece stuck around ep 800 from 2017) — this is *why*
  `ScheduleEngine.syncFromBroadcastMetadata`'s weekly-slot inference
  correctly refuses to guess a next-episode number for most currently-
  airing shows and the schedule page reads as empty for Today/This Week.
  `scripts/refresh_airing_episodes.ts` (full re-page) and
  `scripts/fetch_latest_episodes.ts` (jumps straight to the last page —
  far cheaper, use this first) both target just the currently-airing
  subset and are still the fastest *manual* way to force one show current.
  As of 2026-09-14 there's also an always-on recurring job doing this
  automatically for the whole catalog: `src/lib/catalog/
  episodeBackfillEngine.ts`'s `runEpisodeBackfillBatch`, wired into the
  queue (item 6 above) as the `episode-backfill` job, ticking every 2min,
  10 pages/tick. It's resumable via one `SyncCheckpoint` row
  (`provider='multi', jobType='EPISODE_BACKFILL'`) that walks a cursor
  through every anime with a known provider id, currently-airing first,
  then by popularity, skipping anime whose episode count already matches
  their declared total (so it converges rather than re-fetching forever)
  and wrapping back to the top once it reaches the end (so airing shows
  keep getting picked up as new episodes air). On a fetch failure the
  checkpoint is left exactly where it stopped — advanced only after a
  page's episodes are durably written — so the next tick resumes that
  page, it doesn't restart the anime or the whole cursor. This narrows
  the truncation problem over time but doesn't eliminate it instantly:
  freshness is still bounded by the same MAL community-episode-guide lag
  and Jikan degradation noted below, and a catalog this size will take
  many cycles at 10 pages/2min to fully catch up from a cold start.
- **Airing schedule had silently gone stale** (found 2026-10-15: last
  refresh 2026-09-23, 3 rows for the coming week). Causes: no `REDIS_URL`
  locally so the worker's recurring `sync:airing` never ran, and
  `syncEngine.syncWeeklySchedule` read only page 1 (50 rows), skipped
  shows not yet in the catalog (most of a new season), and skipped every
  episode without an `Episode` row (i.e. every upcoming one). Fixed: it now
  pages the whole window (3 days back → 8 days ahead), ingests unknown
  non-adult shows via `ingestAnime` (capped, `SCHEDULE_SYNC_MAX_NEW_ANIME`,
  default 60/run), stores upcoming rows with `episodeId: null` (no
  placeholder episodes), stamps AniList provenance on update, and sets
  `Anime.nextAiringEpisode/nextAiringAt`. `ensureFreshSchedule()`
  (`src/lib/engine/schedule/scheduleFreshness.ts`, same pattern as
  `ensureFreshNews`) re-syncs in the background from the homepage and
  `/api/schedule` when the last AniList verification is >3h old, so the
  schedule no longer depends on the worker running. The homepage hero now
  shows the latest released episodes, and `ReleaseSchedule` (Today /
  Tomorrow / week, viewer-local times) replaced the UTC-only airing rail.
  The 131 older Jikan broadcast-slot inferred rows were left in place.
- **Migration hazard (found 2026-10-15)**: `prisma migrate diff`/`migrate dev`
  against the real DB wants to `DROP COLUMN "AnimeTitle"."searchVector"` —
  that column is the raw-SQL full-text index (`docs/production/SEARCH.md`)
  and is deliberately absent from `schema.prisma`. Never run `migrate dev`
  here; hand-write the migration from `migrate diff --script` with that
  drop removed and apply with `migrate deploy` (see
  `20261015090000_add_review_replies_and_tags`). The same diff **also**
  emits `DROP INDEX "AnimeTitle_searchVector_idx"` — remove that line too
  (missed once on 2026-10-19: the GIN index was dropped by
  `20261019090000_…` and recreated by hand right after; the migration file
  was corrected and its `_prisma_migrations` checksum updated).
- **Anime page was 24–28s per load (fixed 2026-10-15)**:
  `getAnimeRelationsData` fell back to a live Jikan call on the request
  path for every anime without stored relations; with Jikan degraded that
  was ~22s of retry/backoff each view. Now capped at 2s with a 15-min
  per-process miss cache (`src/lib/animeData.ts`). The page still
  self-fetches 11 API routes over HTTP (`src/app/anime/[id]/page.tsx`) —
  calling the lib functions directly would cut more latency. Same fix
  later applied to the characters/staff live fallbacks (also ~22s each on
  anime with no stored cast) via one shared `boundedLiveLookup` helper.
- **Relations & seasons (2026-10-15)**: the catalog had 1 `AnimeRelation`
  row (relations only ever came from Jikan's failing endpoint).
  `scripts/backfill_relations_anilist.ts` (dry run default; `--apply`,
  `--ingest-missing --max-new=N`) pulls them from AniList 50-at-a-time by
  MAL id: 811 relations written, 300 missing TV/ONA seasons ingested (catalog
  700 → 1000). `src/lib/catalog/seasonSeries.ts` builds the season bar on
  the anime page from Sequel/Prequel links (topologically ordered, labels
  derived from titles, never a counted index). Known bad record:
  `attack-on-titan` (Season 1) carries year 2023 / 87 episodes — looks like
  series-level data on the S1 row; needs a data review, not guessed here.
- **Anime "Details" section** (`src/lib/anime/animeFacts.ts` +
  `AnimeDetails.tsx`) shows every stored fact the page didn't: titles,
  aired dates, broadcast, producers, themes, AniList tags (spoilers hidden),
  background, provider stats labelled by provider (MAL rank vs AniList user
  count for `popularity` — different meanings by `externalSource`), and
  MAL/AniList links. Licensors, streaming, external links and content
  warnings have zero rows, so they aren't shown yet.
- **Hero art**: only AniList `/banner/` images are wide enough for a
  full-bleed hero (`src/lib/media/heroArt.ts`); posters are never stretched
  (soft blurred backdrop + sharp poster card instead). Jikan has no banners,
  so `scripts/backfill_anilist_banners.ts` (dry run default, `--apply`)
  pulls them from AniList by MAL id; run it after large Jikan imports.
- **Review tags & replies** (2026-10-15): `ReviewTag` (fixed vocabulary in
  `src/lib/reviews/reviewTags.ts`, rolled up per anime as "community tags",
  separate from provider `AnimeTag`) and one-level `ReviewReply`
  (`src/lib/reviews/reviewSocial.ts`, `REPLY_REVIEW` notifications). Review
  headlines are optional now (stored `''`) and not shown on the anime page.
- **Phone + OTP replaced email verification (2026-10-16)**: sign-up is
  username (min 8 chars, live availability check —
  `GET /api/auth/username-available`, rules in `src/lib/identity/username.ts`)
  → phone → SMS code; sign-in is phone → SMS code. No passwords for new
  accounts, `User.email` is now optional, `User.phone` is unique (one
  account per number — the anti-alt-account point of the change).
  `POST /api/auth/phone/send-otp` (purpose register/login/link),
  `/api/auth/register`, `/api/auth/login`, `/api/auth/phone/verify` (link a
  phone to a signed-in account). SMS via Twilio Verify
  (`src/lib/identity/otpService.ts`, `TWILIO_*` in `.env.example`); dev
  without Twilio prints codes to the server log, production without it
  fails closed. `requireVerifiedUser` now gates on `phoneVerifiedAt`
  (code `PHONE_NOT_VERIFIED`); legacy email/password accounts can still
  sign in with their password until they link a phone, but can't
  rate/review/post until they do (`VerifyPhoneBanner`/`VerifyPhonePrompt`).
  Email verification routes/page/templates were deleted;
  `User.emailVerifiedAt` and `EmailVerificationToken` are left in the
  schema, unused, for a later contract migration. Password reset by email
  still exists for legacy accounts. Not built: changing/recovering a lost
  phone number, an admin view of phone status. Tests:
  `tests/phone-auth.test.ts`.
  **Switched off for testing (2026-10-16)**: `PHONE_VERIFICATION_REQUIRED`
  (default off) bypasses the `requireVerifiedUser` phone gate and hides the
  verify prompts; `PHONE_OTP_MODE=mock` (ignored in production) skips SMS
  and shows the code in the form. Both in `src/lib/identity/identityConfig.ts`.
  Set `PHONE_VERIFICATION_REQUIRED="true"` and unset `PHONE_OTP_MODE`
  before going public.
- **UI pass + streaming links (2026-10-16)**: the release schedule moved off
  the homepage onto `/schedule`, rebuilt as a day-grouped timeline (local
  time + JP broadcast time, live "now" marker/countdowns, official
  "Watch on" platform chips). Streaming listings come from AniList
  `externalLinks` (type STREAMING) via `src/lib/catalog/streamingLinks.ts`
  into `StreamingAvailability` — add-only, never touches non-`anilist`
  rows; refreshed for newly scheduled shows after each schedule sync, and
  `scripts/backfill_streaming_links.ts [--apply] [--all]` for the catalog
  (1,691 rows written 2026-10-16). Also feeds the anime page's
  "Where to Watch", which previously always rendered empty. Homepage
  fabrications removed: studio `projectCount` floor of 12, fixed
  "4 min read", "@animeobserver" author fallback, the canned
  "Editor's Pick" blurb (now labelled "Spotlight", shows the real
  synopsis), placeholder genre tags, and a 24-episode total assumed for
  Continue Watching. Signature accent tokens `--accent-gradient` etc. in
  `src/styles/tokens.css`. **Data issue found, not fixed**: many `Person`
  rows carry MyAnimeList image URLs with sequential ids
  (`/voiceactors/1/52901.jpg`, `/2/52902.jpg`, …) that 404 — looks like
  fabricated seed data; UI falls back to initials, but the rows need a
  review/cleanup.
- **Ratings simplified (2026-10-16)**: the only place a score is entered
  is the rating window. Aspects are `ACTIVE_RATING_CATEGORIES`
  (`src/lib/rating/ratingEngine.ts`): Story, Characters, Animation, Music,
  Pacing, World Building, Enjoyment — DIRECTION is retired (ignored on
  input, hidden from OTAKUVA Vibe, stored scores kept in the DB). Owner
  asked for this set explicitly after a brief cut to 3; don't trim it
  without asking. Reviews no longer take a score: a
  review card shows the author's live AnimeRating
  (`src/lib/reviews/reviewerRatings.ts`); `Review.rating` is now only a
  snapshot kept in sync on rate/unrate for sort-by-rating. OTAKUVA Vibe has
  no rating buttons of its own. `scripts/recalculate_rating_aggregates.ts`
  re-normalises aggregates after changes like this.
- **Mobile / app groundwork (2026-10-16)**: `viewportFit: 'cover'` with
  safe-area padding (`--header-offset` token = header height + notch;
  use it for anything sticky under the header), web app manifest
  (`src/app/manifest.ts`) and PNG icons (`public/app-icons/`,
  `src/app/icon.png`, `apple-icon.png`, from
  `scripts/brand/generate_app_icons.py`, which since 2026-10-17 builds them
  from the logo artwork `scripts/brand/otakuva-logo-source.png` and also
  writes the transparent header/footer mark `public/brand/otakuva-mark(@2x).png`
  — `next/og` icon routes crashed the
  Windows dev worker, so don't reintroduce them), 16px inputs on touch (no
  iOS focus zoom), `touch-action: manipulation`, hover effects disabled on
  `(hover: none)`, swipeable homepage hero. Not done: a service worker /
  offline support and the store wrappers themselves (TWA for Play,
  Capacitor or similar for App Store).
- **Member articles (2026-10-16)**: `UserArticle` (migration
  `20261016150000_add_user_articles`) — community write-ups with an
  optional cover image (`POST /api/articles/cover`, MediaAsset
  `ARTICLE_COVER`, only the uploader can attach it), up to 5 http(s)
  source links, optional related anime. Plain-text bodies (no HTML).
  Pages `/articles`, `/articles/new`, `/articles/[slug]` ("Shared by
  @user" + reviewer level). Deliberately NOT shown in `/news` (that's
  provider-ingested NewsArticle). Author delete = status REMOVED, moderator
  hide = HIDDEN; reportable (`targetType: 'ARTICLE'`). Publishing writes an
  `ARTICLE_PUBLISHED` Activity. Tests: `tests/articles.test.ts`.
- **Profile redesign (2026-10-16)**: full-bleed banner (profile routes are
  in AppShell's `isBleed`), avatar ringed in the reviewer-tier colour with
  its seal, level beside the name, inline-editable About/bio (500 chars),
  Articles tab + count. Real activity via `GET
  /api/users/:username/activity` (per-day counts + timeline). Removed
  fabrications: the heatmap's "mock seeding" pattern and a streak floored
  at 4, a default bio and fallback names, and the viewer's own library
  being shown as Library/Favorites on other people's profiles (those tabs
  are owner-only until a public-library API exists).
- **UI pass + fixes found along the way (2026-10-17)**:
  - *Second Postgres regression, same family as the case-sensitivity one*:
    `ORDER BY … DESC` puts NULLs **first** on Postgres (SQLite put them
    last), so every unscored/unaired title topped "Highest Score" sorts.
    All 30 `Anime.score` DESC sorts now use `{ sort: 'desc', nulls: 'last' }`
    (catalog engine, home, studios, genres/themes, seasonal, airing,
    search, recommendation engines). Use that form for any new sort on a
    nullable column.
  - *Security*: `POST /api/news` ran a full provider sync for anonymous
    callers (unbounded `limit`) and let any signed-in user publish a
    manual article. Now `requireRole('NEWS_EDITOR')`, limit capped at 100,
    and the News page hides "Sync Provider Feed" from everyone else
    (`tests/authorization.test.ts`).
  - *Fabricated data removed*: `/rankings` (index-based ↑/↓ movement,
    `9.00` default score, "90% Positive" = score×10, year fallback 2024,
    tabs hardcoded to 2024/Winter 2024); news article pages (canned
    "Key developments" bullets and two paragraphs written as if by the
    source publication); `GET /api/studios/[slug]` (default 8.2 average,
    canned history/"DNA" prose, default genres, location "Japan"). The
    homepage "OTAKUVA Top Rated / Community signal" row is provider
    scores, so it's now just "Top Rated".
  - *Broken flows*: `/anime` catalog showed "0 of 1000" (client read
    `anime` but `GET /api/anime` returns `animes`; same bug in two admin
    studio pickers). Anonymous `GET /api/recommendations` 500'd (taste
    engine upserted a profile for the placeholder `'guest_user'`; now
    only persists for real users — `tests/recommendations-guest.test.ts`).
  - *Missing CSS classes*: `/artists` rendered unstyled, MediaPicker
    showed the native file input, the news sidebar's `fill` posters had no
    sized wrapper, studios search icon floated off. Run a "styles.X used
    but `.X` never defined" scan after big refactors.
  - `--font-display` is a font **family**; it was used as a font-size in
    12 page titles (and still is in `globals.css` `h1`), which silently
    fell back to body size. Page titles now use
    `clamp(32px, 5vw, 52px)`; the global `h1` rule is left as-is pending a
    look at bare `h1`s that rely on the fallback.
  - Not fixed, flagged: Season 2 of Frieren shows 10 eps in the season
    bar vs 12 in the episode guide (data, not UI); `/api/anime` mixes
    "Finished" and "Finished Airing" status strings.
- **Site audit fixes (2026-10-17, second pass)**:
  - *One page per job*: `/explore`, `/discover` (and `/search` with no `q`)
    → `/anime`; `/airing`, `/anime/airing` → `/schedule`; `/anime/rankings`
    → `/rankings`; `/anime/seasonal` → `/seasonal`; `/spaces[/slug]` →
    `/community[/slug]`; `/profile` → `/profile/you`. Done as
    `redirects()` in `next.config.mjs` (query strings carry over); the old
    page files are left in place, unused — delete deliberately (note
    `src/app/search` is untracked and still serves `/search?q=`).
  - *Security/privacy*: `GET /api/activities` returned every member's
    activity (incl. private library changes) to anyone — now the signed-in
    user's own only (`tests/activities-privacy.test.ts`). Account deletion
    for passwordless (phone) accounts needed only the session + "DELETE";
    now requires a fresh SMS code (`send-otp` purpose `reauth`, always the
    account's own number). `PATCH /api/library/[animeId]` now validates
    `episodesWatched`/`notes`.
  - *Fabrications removed*: Episode Guide generated "Episode N · 24 min ·
    Broadcast" rows (default 12) for every anime without episode rows —
    950 of 1000 — now a real progress counter (library `episodesWatched`);
    Settings' fake "Enabled" toggles (now real: account, export, delete,
    sign out); Collections (hardcoded counts, stock photos, every page the
    same top-15) → rules over the catalog (`src/lib/collections.ts`);
    Production's hardcoded companies → real producers; `annNewsProvider`
    (src/lib/news, legacy/unreferenced) returned invented ANN stories — now
    throws; image repair / dedup / studioKnowledge wrote stock photos as
    posters/logos/founder portraits — removed (DB scan: none had landed).
  - *Data*: `attack-on-titan` fixed from its stored Jikan payload
    (2013/25 eps) via `scripts/reconcile_anime_from_payload.ts` (+8 gap
    fills, logged to AnimeMetadataHistory); 8 dead unsigned MAL person
    photos cleared (`scripts/cleanup_dead_person_images.ts`).
  - *Postgres regressions*: season filter compared "FALL" to stored "Fall"
    (always empty) → `mode: 'insensitive'`; "Finished" status filter
    missed Jikan's "Finished Airing". One status display vocabulary:
    `src/lib/anime/animeStatus.ts` ("Finished Airing" was shown as airing).
  - *Known, not fixed*: dynamic `notFound()` pages return 200 (+noindex)
    because the root `loading.tsx` streams first — a framework-level fix.
- **Custom lists (2026-10-17)** — user-made "libraries" like playlists, on
  the existing `UserList`/`UserListItem` tables plus one additive column,
  `UserList.shareToken` (migration `20261017120000_add_user_list_share_token`).
  Logic in `src/lib/lists/listService.ts`; API `/api/lists` (`?mine=1`,
  `&containsAnimeId=`), `/api/lists/[id]` (GET/PATCH/DELETE),
  `/api/lists/[id]/items` (POST), `/api/lists/[id]/items/[animeId]` (DELETE).
  Visibility: PRIVATE (default for new lists — was PUBLIC), LINK (anyone
  with `/l/<token>`, not listed), PUBLIC (also on profile). Share links use
  a random token, never the list id; going PRIVATE clears it (revokes the
  link), `regenerateLink` rotates it. UI: the anime page's Add to Library
  menu lists the user's lists inline (tick to add/remove, "New list" with
  an inline name box, "Manage lists"); catalog cards' status menu opens
  `AddToListModal` (bottom sheet on phones). Both use the shared
  `useAnimeLists` hook; `/library/lists` (folders, 2×2 collage covers)
  and `/library/lists/[id]` (edit, remove, delete, share dialog) behind a
  Tracking | My lists switch; public share page `/l/[token]` (full-bleed,
  OG/Twitter metadata, noindex unless PUBLIC). Limits: 100 lists/user,
  500 anime/list, name ≤60, description ≤500. Homepage (2026-10-18):
  the "Continue Watching" rail was replaced by "You are tracking" — the
  user's library anime (any status, most recently updated first; status
  badge on the poster) with small tags naming any of their own lists each
  is in (`tracking` in `getHomeData`). `/api/home` still returns
  `continueWatching` for contract stability, the page just doesn't show it. Tests:
  `tests/custom-lists.test.ts`. Not built: drag-to-reorder, list covers
  chosen by the user, following/liking other people's lists.
- **Top Picks (2026-10-18)**: Browse's curated lists moved to `/top-picks`
  (category tiles with icons — Top 100, Binge-Worthy, Most Popular, Hidden
  Gems, Best Movies, Award Winners, OTAKUVA Choice, Most Rated, Top 10
  Monthly; opens on Top 100). Header nav "Top Picks" (trophy); the phone
  menu's category grid has the same icons. **Browse is separate, with its
  own job**: `/browse` is a category directory (`src/lib/browseDirectory.ts`)
  — genre artwork tiles, formats, last/this/next season, decades, top
  themes, each with a real count, linking into `/anime?genre=|type=|year=`,
  `/seasonal`, `/theme/[slug]`. Old `/browse?tab=` links redirect to Top
  Picks and `?genre=` to the catalog (done in the page, not
  `next.config.mjs`). Top Picks = "the best"; Browse = "by category";
  Explore (`/anime`) = search + filters.
  Phone ⋯ menu (top right) opens with an icon grid of every page the
  bottom bar doesn't cover (`MOBILE_QUICK_LINKS` in `Header.tsx`), then
  the Top Picks categories and genres. Definitions stay in `src/lib/browse.ts`
  (`TOP_PICKS_PATH`, `TOP_PICKS_DEFAULT_TAB`); `/api/browse` keeps its
  old default tab ('viewed') for contract stability.
- **Catalog growth (2026-10-18)**: 1000 → 2200 anime via
  `scripts/import_catalog_anilist.ts` (dry run default; `--apply`,
  `--max-new`, `--pages`, `--genre-pages`, `--decade-pages`): AniList
  popularity, then every Browse genre (`anilistProvider.getAnimeByGenre`),
  then decades; non-adult, no music videos. **New titles only** — anything
  whose AniList/MAL id is already stored is skipped (existing rows aren't
  rewritten with another provider's data), and a same name+format+year
  under different ids is skipped and listed for review. The 2026-10-18 run
  hit its 1200 cap during the genre pass, so the decade pass hasn't run yet.
  **Fixed in `ingestAnime`**: the slug fallback (slugs are title-only)
  used to match a *different* show with the same title and overwrite it
  (remakes, sequels titled the same); now ids are matched first and a
  slug match with disagreeing MAL/AniList ids gets its own slug
  (`title-<year>`, then `title-<externalId>`) — 8 such titles in that run,
  e.g. `hunter-x-hunter-1999` (`tests/ingest-dedup.test.ts`).
  `scripts/audit_catalog_duplicates.ts` (read-only) checks repeated MAL/
  AniList ids and same title+format+year: 0 / 0 / 0 after the import.
  Flagged, not fixed: `kite` (Jikan, 2026-09-08) carries genre Hentai but
  `isAdult: false` — needs a content review. Relations and streaming links
  were backfilled right after (2,017 relation rows upserted; 2,556 new
  streaming rows) — re-run both after any future import.
- **Creators (2026-10-18)**: `/artists` is now the Creators directory
  (people only — studios link to `/studios`; nav label "Creators"): role
  filters, search, "Most credited" sort (`GET /api/people?sort=popular`,
  new role values ORIGINAL_CREATOR/CHARACTER_DESIGN/ANIMATION, role
  matching case-insensitive, response adds `creditCount`/`voiceRoleCount`/
  `occupations`). `/person/[slug]` (also `/people/`, `/creator/`) is a
  server page from `src/lib/people/creatorProfile.ts`: photo, roles,
  birthday/age, home town, years active, bio, Known for, all Projects
  grouped per anime (role filter + sort), voice roles with their anime,
  studios. Removed from `/api/people/[slug]`: the `name contains` fallback
  (could open someone else) and the live Danbooru "biography" (matched an
  illustrator by name alone). Schema: `Person.anilistId`/`malId` (unique),
  `homeTown`, `yearsActive`, `dateOfDeath`, `occupations[]`,
  `detailsFetchedAt` (migration `20261018120000_add_person_creator_details`).
  **People are matched by provider id now** (`src/lib/people/personResolver.ts`,
  used by `syncStaff` and the voice-actor part of `syncCharacters`): before,
  a name-only slug merged different people with one name and `externalId`
  flipped between AniList and MAL ids. `scripts/import_creators_anilist.ts`
  (dry run default; `--apply`, `--credits-only`, `--details-only`): staff
  for every anime with an AniList id, 25 per request (anime that already
  had credits only get people matched — no second set of credits), then
  profile details 50 per request, empty fields only, bios as plain text
  with spoilers and link-only lines dropped (`plainTextBio`). 2026-10-18
  run: 1,897 anime got credits; people 7,888 → 19,624; credits 6,943 →
  47,556; details: 5,600+ bios, 4,049 birthdays, 2,884 home towns,
  11,128 with occupations (2 staff ids AniList didn't return; re-run picks
  them up). Bio cleaning drops "Website | Twitter | …" link-list lines in
  their markdown, bold-wrapped and HTML forms. 4 unlinked slug-less duplicate people (Miyazaki, Shinkai,
  Watanabe, Kon — old seed rows) were deleted. `audit_catalog_duplicates.ts`
  also lists people with the same name + native name under different
  AniList ids (44) for review — not auto-merged, many are different people.
  Not fixed: `Character` rows are still matched by name-only slug in
  `syncCharacters` (same class of bug; characters share names far more).
- **Anime page "Discussion" + article likes/comments (2026-10-18)**: the
  bottom of every anime page is now `AnimeCommunityHub` (replaced the
  3-thread `CommunityTeaser`, file left unused), fed by
  `GET /api/anime/[id]/community` → `src/lib/community/animeCommunityHub.ts`:
  threads about the anime (same `readableDiscussionsFilter` as everywhere —
  private-community threads only reach members), recent same-genre threads
  when there are <3, listed communities for the anime or GENRE communities
  whose name contains one of its genres, and member articles about it with
  like/comment counts. Inline "Start a discussion" posts to
  `/api/discussions` with the anime id (that route now 400s on an unknown
  `animeId` instead of a FK 500). "Write one" → `/articles/new?anime=<slug>`
  pre-selects the anime. Articles: `UserArticleLike` (one per user) and flat
  `UserArticleComment` (migration `20261018150000_add_article_likes_comments`);
  `src/lib/articles/articleSocial.ts`; routes `/api/articles/[slug]/like`
  (POST/DELETE), `/api/articles/[slug]/comments` (GET/POST),
  `/api/articles/[slug]/comments/[commentId]` (DELETE: author = soft delete,
  moderator = HIDDEN). Liking/commenting need `requireVerifiedUser`; comments
  are rate-limited like discussions and notify the article's author
  (`ARTICLE_COMMENT`); reportable as `ARTICLE_COMMENT`. Account export now
  includes articles, article likes/comments and review replies (the last two
  were missing before). Tests: `tests/article-social.test.ts`.
- **Article replies, community topics, level journey, profile share
  (2026-10-19)** — migration `20261019090000_article_comment_replies_and_community_genres`
  (additive):
  - *Article discussion*: `UserArticleComment.parentId` (threads one level
    deep — replying to a reply attaches to its parent, the client prefixes
    `@username`) and `UserArticleCommentLike`. `GET …/comments?sort=top|newest|oldest`
    returns threads with nested `replies`, `likeCount`, `liked`; a removed
    comment that still has visible replies stays as a `deleted: true`
    placeholder. `POST …/comments { body, parentId? }`;
    `POST|DELETE …/comments/[commentId]/like`. The person replied to gets
    `ARTICLE_COMMENT_REPLY`; the article author still gets `ARTICLE_COMMENT`
    (not twice). Tests: `tests/article-replies-community-topics.test.ts`.
  - *Communities ↔ anime/genres*: new `CommunityGenre` join table. Create
    and settings now have `CommunityTopicPicker` (optional anime + up to 5
    genres; picking an anime pre-selects its genres, still editable);
    `createCommunity`/`updateCommunity` accept `animeId` (id or slug, null
    unlinks) and `genreIds` (ids or slugs) and 400 on unknown values.
    Before this nothing could set `Community.animeId` from the UI, so the
    anime page's community list was empty in practice. The hub
    (`animeCommunityHub.ts`) now ranks: linked to the anime → tagged with
    one of its genres (or legacy GENRE communities named after one) →
    about another anime sharing a genre; listed (PUBLIC/REQUEST_TO_JOIN)
    only; join inline; "<Genre> communities" chips link to
    `/community?genre=<slug>` (new `genre` filter on `GET /api/communities`,
    whose `q` search is now case-insensitive and also matches the linked
    anime's title). `GET /api/genres` lists genres (adult ones excluded).
    **Data, not fixed**: the existing `vinland-saga` community was created
    before any of this and is not linked to the anime — its owner can link
    it in settings (not auto-linked by name).
  - *Badges*: profile badge panel shows `LevelJourney` (all 9 tiers on an
    animated path, current one raised, next one with "N to go") instead of
    the chip ladder. Thresholds unchanged — still only `tiers.ts`; the rail
    gradient is built from `TIERS` (the badge guard test forbids tier
    colours anywhere else).
  - *Seal artwork (2026-10-19, later)*: `Seal.tsx` keeps every tier's name,
    kanji and colours but adds ornaments by ladder position
    (`src/lib/badges/sealOrnaments.ts`): enamel depth + bevel + embossed
    kanji + double frame for every earned tier, corner brackets from rank 3,
    diamond studs from rank 5, shimmer on `special` tiers; fine detail only
    at ≥40px, stamped edge at ≥60px. The share card's canvas seal
    (`drawSeal` in `profileCard.ts`) draws the same build from the same
    constants — change both together.
  - *Share profile*: `ShareProfileSheet` + `src/lib/share/profileCard.ts`
    draw a 1080×1350 card on a canvas (real seal glyph paths, real stats
    only — stats are omitted until loaded); the preview is the exact PNG.
    Native share with the image where supported, download, copy link,
    X/WhatsApp/Telegram/Reddit/Facebook links. A photo whose host blocks
    cross-origin use makes the card redraw without photos rather than fail.
- **Homepage = front page, not a streaming shelf (2026-10-19)**: the
  full-bleed `SpotlightHero` carousel, binge/award poster rails, big rank
  numerals and the auto "Spotlight" are gone from `/` (components left in
  `src/components/home/`, unused). New layout (`HomeClient.tsx` +
  `src/components/home/FrontPage.tsx`): masthead (date, current season,
  search → `/search?q=`, real platform counts — zero counts hidden),
  On air (just aired / up next from `releaseSchedule`, local time after
  mount; enlarged 2026-10-19: a "Premiering within 2 hours" panel —
  every episode airing within `SOON_MS` as a big card with a live h:mm:ss
  countdown + filling bar, scrolling vertically inside the panel — falling
  back to a single "Next episode" card with countdown when nothing is that
  close, and same-time multi-episode drops merged into one row as
  "Episodes 1–10"), You are tracking (signed-in only), Latest reviews (quote,
  reviewer seal, the reviewer's live AnimeRating; spoiler reviews never
  show text), Rankings (Highest rated by provider score with ≥10k votes,
  labelled as MAL/AniList data; Most popular = OTAKUVA members tracking a
  show via `UserAnime`, hidden until `POPULAR_MIN_SHOWS` shows have
  `POPULAR_MIN_TRACKERS` trackers — owner asked not to show provider
  member counts), This season (the one poster row left), News (lead = newest with an
  image), and a sidebar: Trending talk, member Articles, Communities, This
  week in history (exact-day premieres ±3 days), Studios; "Creators and
  Directors" portrait rail restored from the old homepage (owner asked):
  up to 12 people ranked by creative credits (`CREATIVE_ROLES` in
  `getHomeData.ts`: director, original creator, series composition, script,
  character design, storyboard, music…), max 3 per main role so composers
  don't crowd out directors; links to `/person/[slug]`. Layout revised
  2026-10-19 at the owner's request: one full-width column — masthead, on
  air, tracking, reviews, rankings, this season, **Browse by Genre artwork
  tiles** (`getGenreArtwork`, back in their old place), **OTAKUVA Choice
  spotlight** (`EditorsPickFeature`, one title per UTC day from the curated
  `OTAKUVA_CHOICE` list, preferring ones with a banner — `BrowseItem` now
  carries `bannerUrl`), **Animation Studios** cards (restored), creators,
  news, then the former sidebar modules as a "community corner" grid at the
  bottom. Data: `src/lib/home/frontPage.ts`
  (`buildFrontPageSections`, cached as `getFrontPageSections` under
  `HOME_SECTIONS_CACHE_TAG`), exposed as `sections.frontPage` on
  `getHomeData`/`/api/home` (all old keys kept). Same font (Inter), heading style
  (gradient-bar kicker) and `--accent-gradient` colours as the rest of the
  site — a serif + Japanese-label pass was tried and reverted at the owner's
  request. **Fixed**: the old homepage community query
  showed private-community threads to everyone — now uses
  `readableDiscussionsFilter(null)`. Anime page reviews section has
  `id="reviews"` for deep links. Tests: `tests/home-front-page.test.ts`.
- **Studio + creator pages redesigned (2026-10-19)** — one design shared with
  the homepage (`src/components/entity/*` + `Entity.module.css`,
  `src/components/ui/SectionHead.tsx`). `/studio/[slug]` (and `/studios/`)
  is now a server page from `src/lib/studios/studioProfile.ts` (same slug →
  redirect → alias resolution as `studioService`), replacing the 1,260-line
  client page that made 10 API calls and showed mostly empty tabs (the DB has
  0 studio descriptions/logos/websites/history events; only 2 founded years).
  It shows: hero with the **official logo slot** (`adminOverrideImageUrl` /
  `imageUrl`; lettered tile until an admin adds one), founded year, location
  only when a city/region was recorded (schema defaults country to "Japan"),
  links, stats; known for; works per year; highest rated; genres; creative
  leads on its work; all works (format filter); co-producing studios;
  communities/news when linked. The old "Follow Studio" button was removed —
  it only toggled local state. `/person/[slug]` uses the same components and
  gained genres, frequent collaborators and "Studios worked with" (derived
  from credits — `StudioPerson` has 0 rows); a credits-per-year chart was
  tried and removed at the owner's request. Hero on both pages: no card box,
  page-black background, larger photo/logo with an animated accent glow
  behind it (owner preferred the earlier creator layout). Extra creator
  facts (migration `20261019150000_add_person_extra_details`):
  `alternativeNames`, `gender`, `bloodType`, `language`,
  `anilistFavourites`, filled by `scripts/import_creators_anilist.ts --extra`
  (empty fields only; favourites refreshed). **MyAnimeList/Jikan was asked
  for but couldn't be used**: no Person has a `malId` (all came from
  AniList) and api.jikan.moe was unreachable on 2026-10-19 — matching people
  to MAL ids would need Jikan's `/anime/{id}/staff` (name + role per show)
  once it's back. Placeholder tiles (studio letters,
  creator initials, genre tiles without art) are black/grey, not per-name
  colours (owner's request). Provider "no
  photo" stand-ins (AniList `default.jpg`, MAL `questionmark` gif) render as
  initials (`isProviderPlaceholderImage` in `mediaResolver.ts`). Old
  `src/app/person/[slug]/{person.module.css,CreditsGrid.tsx,CreatorPhoto.tsx}`
  are now unused (untracked, left for the owner to delete). Tests:
  `tests/studio-creator-profile.test.ts`.
- **One comment box + no boxed panels (2026-10-19)**: `src/components/ui/Composer.tsx`
  is the site's comment box — plain avatar + underline at rest, opens on
  focus (growing text area, gradient underline, toolbar with count / Cancel /
  gradient Post, Ctrl+Enter / Esc). Used by discussion comments
  (`CommentComposer` keeps its image/GIF/meme/spoiler tools via `tools`),
  article comments + replies, and review replies; use it for any new comment
  input. The news article page's comment box was fake (local state only,
  "Community Member", never saved) — replaced with "Start a discussion",
  which opens `/discussions?new=1&title=…` (new prefill support). Homepage
  panels (on air, reviews, rankings, studios, community corner) no longer
  have card borders/backgrounds — owner's request; rows are separated by
  hairlines.
- **News redesign (2026-10-19)**: `/news` uses the homepage width (1440),
  heading style and soft borderless surfaces; lead story = newest with an
  image among the first six; masonry grid (CSS columns, top-to-bottom per
  column); stories without a picture are text cards (no empty image block);
  the "LATEST INDUSTRY DISPATCH" reason only shows when the feed is actually
  personalised; times under an hour read "12m ago". All feed/search/trending
  logic unchanged. `/news/[slug]` got a 1320px layout and borderless soft
  panels via an override block at the end of `reader.module.css`.
- **Episode-by-episode rating → OTAKUVA Score (2026-10-19)** — migration
  `20261019200000_episode_ratings_by_number`; engine
  `src/lib/rating/episodeRatings.ts`; API `/api/anime/[id]/episode-ratings`
  (GET summary / POST rate / DELETE ?episodeNumber); UI
  **Reworked again 2026-10-20 (owner) — the anime and its episodes are rated
  separately.** The anime: one overall rating in `RatingModal` (unchanged UI,
  any premiered show, airing or finished) — that alone is the member's
  score in the OTAKUVA Score/Vibe. Episodes: **retention %** (0–100, steps of
  5, "how much did this episode keep you watching?") in
  `EpisodeRetentionModal` (same window styles), opened by clicking an aired
  episode in the Episode Guide; never feeds the anime score. Column
  `EpisodeRating.retention` (migration `20261020090000_episode_retention`;
  `rating` made nullable). API: `POST …/episode-ratings { episodeNumber,
  retention }`, `DELETE …?episodeNumber=N&what=retention`; the legacy
  `{ score }` form still works. The 27 legacy episode *scores* (one account,
  2026-10-19/20) are kept and only count for a member with no overall
  rating (`getMemberScores`, `reviewerRatings.ts`, `GET …/rating`). The
  Episode Guide now lists the aired episodes from `getEpisodeReleaseState`
  when there are no `Episode` rows (numbers + real titles only; no watched
  tick for those — the progress counter stays below), each with the
  members' retention bar and yours. `EpisodeRatings.tsx` is deleted.
  Later the same day: anime-level retention (`retention` = each member's
  episode average, averaged over members; `myRetention` = the viewer's) in
  the episode-ratings summary, shown as `RetentionSummary` under the
  Community Rating. **Premiere unlock**: `getEpisodeReleaseState` no longer
  forces 0 for "Not yet aired" when a dated air time (AiringSchedule /
  past `nextAiringAt`) has passed; the anime page shows a live
  `PremiereCountdown` and unlocks rating when it hits zero (re-checks the
  server, then an "Episode 1 is out now" prompt). Catalog pages (`/anime`,
  `/browse`, `/top-picks`, `/seasonal`, `/rankings`, `/studios`, `/artists`)
  use `--max-wide-width` (1800px, header width) via AppShell's `isWide`;
  Explore has `ExploreSearch` (live suggestions, recent searches in
  localStorage, `/` to focus, keyboard nav) + one-tap format/status/genre
  chips; Browse reuses it via `CatalogSearchBox` (commits to Explore).
  Then: Explore opens with a masthead like the homepage's (dateline +
  season, avatar + "Welcome back, <display name>" with @username — falls
  back to @username — the search, real counts from `GET /api/platform-stats`
  / `src/lib/platformStats.ts`, cached 10 min). **`User.displayName`**
  (optional, ≤40, migration `20261020150000_user_display_name`) is set in
  the profile Edit modal (`PATCH /api/profile { displayName }`, '' clears;
  that field existed in the UI before but was never saved), returned by the
  session user (`sessionUser.ts`) and shown in both mastheads.
  **Episode Guide rows** (2026-10-20, final): EP | title | an
  always-visible horizontal retention bar 0–100% (`RetentionSlider`, saves
  itself 600ms after you stop dragging, tick = everyone's average, "All N%")
  | watched tick — for every row, including rows built from the aired count
  (there "watched" = the library's watched-up-to count). Homepage creator
  cards show "N titles · known for" (`titleCount`, creative credits).
  `EpisodeRetentionModal` remains for the Retention block's button.
  Same day, later: **retention colours** everywhere via
  `src/lib/rating/retentionTone.ts` (green ≥40%, yellow <40%, red ≤20%).
  **Reviews/comments blend into the page** (no outlines/panels in
  `AnimeReviewsCard` and `Comments.module.css`; the Composer's underline is
  kept). The viewer's own review is in the normal list with a small "Your
  review" mark (+ Edit) instead of a boxed panel. **Pinned reviews**:
  `Review.pinnedAt/pinnedById` (migration `20261020170000_review_pins`),
  `POST|DELETE /api/reviews/[id]/pin` — MODERATOR+ only, max 3 per anime,
  logged as ModerationAction PIN/UNPIN; `GET /api/reviews?animeId=` returns
  `pinned` (always, regardless of page/sort) and `canPin`. Tests:
  `tests/review-pins-retention-tone.test.ts`.
  UI polish after that: `RetentionSlider` (thicker bar, 20%/40% ticks, handle
  ringed in the band colour, value in a soft coloured pill, coloured notch for
  everyone's average) and `RetentionSummary` (two ring gauges — Community /
  You — with a band word, plus a per-episode mini bar chart coloured by band
  with a legend). Colours/labels only from `retentionTone.ts`.
- **Black & grey theme (2026-10-20, owner)** — matches the logo/wordmark:
  page `#141416` (dark grey, was near-black `#09090D`), header `#101012`,
  graphite surfaces; `--accent-gradient` is white → silver → graphite (was
  sakura → violet → blue) with `--accent-on` (#111113) for text on it;
  `--accent`/`--accent-primary` are light grey. Done by one mapping over
  `src/` (old brand hexes/rgb → greys) + token edits; the only hues left are
  semantic: retention green/yellow/red, rating tiers, score gold, and the
  new rank medals `--medal-gold/silver/bronze` (#1/#2/#3 in the homepage
  **Top Rated** rail — released shows, provider score with ≥10k votes, big
  "01…" numerals — and in the Rankings lists). Hype levels are greys
  (white → graphite) — **changed same day**: hype levels carry meaning
  colours (Hyped flame #FF5A36, Excited amber #FFB020, Curious sky
  #3FB6F2, Not for me grey). Welcome masthead has a soft white glow for
  contrast. Don't reintroduce pink/violet/blue as the *default* accents (optional themes exist since 2026-10-26 — see Theme picker).
  **Hype leaderboard accuracy**: a level board takes EVERY upcoming show,
  counts that level's votes exactly (DB groupBy), and orders by count →
  total votes → sooner premiere → title (no date window — a far-future show
  with the most votes still leads; test in `tests/hype-meter.test.ts`).
  Cards show exact counts (no "10K" rounding), medal rank tags for 1–3,
  "N% of M votes" and a Hype-score chip at ≥5 votes.
  **Hype level animations** (`src/components/hype/HypeFx.tsx`, CSS only,
  off under prefers-reduced-motion): Hyped = heat + rising embers, Excited =
  popping sparkles, Curious = scanning sweep + sonar ping, Not for me =
  drifting haze; full on the picked level, faint on hover; used by the
  homepage level buttons and the anime-page HypeMeter. Selected level = dark
  pill tinted in its colour (not white) so the animation shows. Copy: "Most
  Hyped / Day-One Watches / On the Radar / Getting Passed On".
- **Community workspace identity (2026-10-20, owner: "not a Discord copy")** —
  same 4-column layout, own look, a step smaller type: rail = rounded-square
  tiles that keep their shape, active = white ring (Discord's left pill
  removed), neutral dashed "create" tile (no green); channels are paths
  ("/general", megaphone for announcements) with a thin gradient bar for the
  active one; category/section labels in the site's kicker style; chat =
  rounded-square avatars, time right-aligned on the name line, date dividers
  as left-aligned "— 9 SEPTEMBER 2026" labels; member list matches. All done
  as appended "identity pass" overrides at the end of each community CSS
  module + small TSX glyph changes — don't bring back "#" or round avatars.
- **Profile activity rebuilt (2026-10-20)** — `src/lib/profile/profileActivity.ts`
  reads every action from its real table (AnimeRating, Review, ReviewReply,
  EpisodeRating retention, AnimeHype, Activity STATUS_CHANGED = library,
  Favorite, UserArticle(+Comment), Discussion(+Comment), UserList,
  CommunityMember, Follow) — the generic `Activity` table alone missed most
  features. `GET /api/users/:username/activity?before=&kinds=&limit=&stats=0`
  returns `{ isOwner, items, nextCursor, days, totals }` (response shape
  changed: `timeline` → `items`). Owner sees everything; visitors never see
  RETENTION / HYPE / LIBRARY / FAVORITE, only PUBLIC lists, non-private
  communities, readable discussions; spoiler reviews show "Contains spoilers".
  UI `src/components/profile/ProfileActivity.tsx`: "What you've been up to"
  totals, calendar, filter chips, day-grouped feed with plain sentences +
  coloured value chips, "Load more"; compact version on Overview. Old
  `ActivityTimeline` is no longer used. Homepage "Welcome back, <name>" types
  the name out (`src/components/home/TypedName.tsx`). Tests:
  `tests/profile-activity.test.ts`.
- **Responsive pass (2026-10-20)**: `scripts/qa_responsive_overflow.mjs`
  (use `CHROME_PATH` = Edge on this machine, `MSYS_NO_PATHCONV=1`) found no
  horizontal overflow on 15 main pages at 360/390/414/768/1024. Fixed from
  real-device screenshots: Explore search/sort/filters fit one row on
  tablet (`ExploreSearch` min 280px) and sort + "Filters" share a row on
  phones (SORT label hidden, counts in a 3-column grid); homepage Welcome
  buttons are two equal buttons on phones; shorter search placeholder.
- **Hype Meter (2026-10-20)** — pre-premiere anticipation. `AnimeHype`
  (one vote per member per anime: HYPED / EXCITED / CURIOUS / SKIP "Not for
  me"; migration `20261020190000_anime_hype`). Levels, weights (100/70/40/0),
  colours: `src/lib/hype/hypeLevels.ts`; logic `src/lib/hype/hypeService.ts`.
  Voting is open only while `getEpisodeReleaseState(...).isOpen` is false
  (one final vote per member since 2026-10-21 — see the Episode Guide + Hype
  note)
  (same rule as rating; 409 after); hype % hidden below `MIN_HYPE_VOTES` (5);
  never feeds the OTAKUVA Score. API `GET|POST|DELETE /api/anime/[id]/hype`
  (POST needs `requireVerifiedUser`), `GET /api/hype/board?level=HYPED|…|upcoming`
  (cached 5 min, tag `hype-board`, refreshed on vote). "Upcoming" = provider
  status upcoming AND no dated air time passed; only day-precise future dates
  get countdowns (month/year-only shown as such). UI: `HypeMeter` in the
  anime page's pre-premiere notice (top of the main column, above the season bar since 2026-10-21) (+ "Add to Plan to Watch" after
  Hyped/Excited; locked results stay after premiere), homepage `HypeBoard`
  (after the Welcome back masthead, before On air) — a hype leaderboard in OTAKUVA's own style (v2 — owner asked it NOT to look like the reference app): SectionHead-style kicker "Hype meter" + "Most Hyped / Excited / Curious / Skipped", a row of level buttons (white pill = active), tall poster cards with a gradient rank tag ("01"), a countdown tag, and a ten-segment gauge of how much of that show's vote is this feeling; straight on the page, no panel/outline; only anime that got that vote, most votes first; blank until someone votes. Icons: Rocket / PartyPopper / Telescope / Ban and
  `UpcomingRail` (above This season). Votes are in the account export.
  Not built: premiere notifications, the `/upcoming` page redesign, a
  "Coming soon" tab on `/schedule`. Tests: `tests/hype-meter.test.ts`.
  Page order: Community Rating + Your Journey → OTAKUVA Vibe → Where to
  Watch → reviews → episode guide, characters, staff, timeline → related,
  recs, discussion, news. Same day, no coloured glows site-wide:
  `--accent-glow` is a plain hairline ring, the studio/creator hero wash is
  static and faint; top-level pages use `src/components/ui/PageHead.tsx`
  (gradient-bar kicker + title) and the white active pill for tabs. Owner's rules:
  a member's anime score = **average of the episodes they rated**, else
  their single overall `AnimeRating`; each member counts **once** in the
  bayesian OTAKUVA Score (`recalculateAnimeAggregates` now reads
  `getMemberScores`; `RATING_ALGORITHM_VERSION` = 2); Vibe aspects work the
  same way (episode aspect average per member, else overall). Episode
  aspects are optional. **Nothing can be rated or reviewed before episode 1
  airs — now enforced server-side** in `/api/anime/[id]/rating`,
  `/api/reviews` and episode ratings (before, only the buttons were hidden).
  "Aired" comes from real data only (`getEpisodeReleaseState`:
  Episode.airedAt, AiringSchedule, nextAiringEpisode, a finished show's
  official count; movies = 1) — `EpisodeRating` is keyed by anime + episode
  number (`episodeId` optional) because only 51 anime have Episode rows; no
  placeholder episodes are created. Reviewer scores on reviews/homepage use
  the same rule (`reviewerRatings.ts`). The old `/api/episodes/[id]/rate`
  routes delegate to the new engine. Known limit: shows with truncated
  episode data (One Piece stops at 800) can only be rated as far as the data
  goes. Tests: `tests/episode-ratings.test.ts`.
- **Episode Guide + Hype Meter (2026-10-21, owner, after several rounds)**:
  the guide is plain one-line rows (`EpisodeQuickList`: number · title
  (+date; "Episode N" stand-ins muted) · `RetentionBars compact` · watched
  tick, hairline separators, no cards). Retention is rated inline with
  `RetentionBars` (name kept; v4 2026-10-21, owner: "modern, simple,
  elegant") — a thin 4px line with a small white knob, fill in the single
  band colour of your value (`retentionTone.ts`), value as coloured text
  beside it ("70%  avg 64"), everyone's average a small dot on the line,
  hover preview on desktop; slide/tap, steps of 5, saves on release. No
  window, no capsule/gradient.
  **Watched first (owner, 2026-10-21)**: an episode's retention can only be
  given after marking that episode watched — `submitEpisodeRetention` checks
  `hasWatchedEpisode` (`src/lib/library/watchedCheck.ts`: a UserEpisodeWatch
  tick, a COMPLETED UserEpisodeProgress row, or — only while the member has
  no ticks for the anime — a legacy `UserAnime.episodesWatched >= n`) and
  returns 409 `EPISODE_NOT_WATCHED`. In the guide the line is dimmed/dashed
  with "Watch first" until the tick is on. Unticking later keeps an existing
  retention (it just can't be changed until re-ticked). Legacy `{ score }`
  episode ratings aren't gated. Tests: `tests/episode-ratings.test.ts`. (`RetentionSlider` and the
  guide's `onRateEpisode` path are unused; `EpisodeRetentionModal` is still
  used by the Retention block.)
  **Watched ticks are per episode now** even without Episode rows:
  `UserEpisodeWatch` (userId, animeId, episodeNumber; migration
  `20261021120000_user_episode_watch`, additive, hand-written without the
  searchVector drops), `src/lib/library/episodeWatch.ts`,
  `GET|POST /api/anime/[id]/watched-episodes` (`{episodeNumber, watched}`,
  only aired episodes). `UserAnime.episodesWatched` = number of ticks
  (status → WATCHING / COMPLETED like the counter); an old "watched up to
  N" count is carried over as ticks 1…N on the first tick. Ticks for one
  member + anime are serialised with `pg_advisory_xact_lock` (two quick
  taps used to count each other out), and the client never rewrites other
  episodes' ticks from a save reply. Previously a
  tick meant "watched up to here" and ticked earlier episodes too. In the
  account export. Tests: `tests/episode-watch.test.ts`.
  **Hype votes are final** (owner): `setHype` refuses a different level
  (409; same level = no-op), `clearHype`/DELETE always 409. The anime-page
  `HypeMeter` shows four text-only pills until you vote, then one line on
  the level's animated background ("Okay, you are hyped for this anime!" —
  `VOTED_LINE`), no lock. Tests: `tests/hype-meter.test.ts`.
  **UI pass 2026-10-22 (owner: "better, don't remove anything")**:
  `RetentionBars` v5 is a "signal ramp" — 20 rising bars (5% each) lit in
  the band colour, white cap on the top bar, everyone's average as a caret
  underneath, band word beside the value (`retentionLabel`), a wave on save.
  Episode Guide: progress strip (watched / aired / not yet, plain bar over 60
  eps), "Up next" = first aired unticked episode, "New" = `airedAt` within
  7 days; `EpisodeQuickList.module.css` was rewritten to only the live
  classes. HypeMeter: score ring in the leading level's colour, hover hint
  line, per-level breakdown chips with shares, "You and N others feel the
  same". HypeBoard: scroll arrows, gauges fill in, your pick as a poster badge.
  Later the same day: the anime-page HypeMeter is its own premium panel
  (`.hp*` in `Hype.module.css`, moved out of the premiere-notice box): four
  tiles with icon + label + hint instead of text pills, big score ring.
  "Recommended for You" (`PersonalizedRecommendations`) = a spotlight for the
  engine's top pick (AniList banner only via `isWideBanner`, else blurred
  poster; genres; "Why this" = the engine's own `matchReasons`) + a rail
  with hover reasons. `toRecommendationItems` now passes banner/type/year/
  genres/studios/matchReasons through.
  **Two hype levels only (2026-10-22, owner)**: `HYPE_LEVELS` = HYPED /
  SKIP (label "Not hyped"). EXCITED / CURIOUS are `RETIRED_HYPE_LEVELS`:
  stored rows are kept (1 EXCITED vote existed), not counted, not shown on
  boards; `setHype` lets a member with a retired vote vote once on the
  current choices (then final as usual). Profile history still words them
  ("Watching day one:", "Curious about"). The board's poster count pill runs
  the level's `HypeFx` (Hyped = heat + embers).
  Then (owner, "too filled"): the anime-page panel shows no vote breakdown
  and no "thanks"/"you and N others" lines — right side is only the hyped
  count, compact (21 / 1K / 2.4K, `Intl` compact), choices are two capsules,
  your-vote capsule glows inside only (no outer shadow/ring).
  `AnimeCommunityHub` no longer shows "Threads about <anime>" or Communities
  (owner's pick); posting a discussion opens it. The API still returns
  those fields (contract unchanged). Recommendations + hub have phone layouts.
- **Collections (2026-10-22, owner)** = custom lists (`UserList`) with a
  banner — one entity, not a second system. Migration
  `20261022120000_user_list_banner` (additive: `UserList.bannerUrl`,
  index `(visibility, updatedAt)`). Banner = owner's upload
  (`POST /api/lists/banner`, MediaAsset `LIST_BANNER`, uploader only) or the
  wide AniList banner of an anime *in* the collection; `resolveBanner` in
  `listService.ts` refuses anything else (a client URL is never stored);
  null = derived from its anime. Builder `/collections/new?anime=<slug>`
  (`CollectionBuilder`, Public/Private, search to add; POST `/api/lists`
  with `animeIds`/`bannerAssetId`/`bannerAnimeId`). PUBLIC non-empty ones are
  listed by `getPublicCollections` → `GET /api/collections/public`, the
  homepage `MemberCollectionsRail` (after News) and `/collections` ("From
  members", above the catalog rule collections); they open `/l/<token>`
  (now shows the banner). Owner page `/library/lists/[id]` has "Change
  banner". Anime page Add to Library menu: "Your collections" + footer
  Manage | **Make a collection** (the inline "New list" box is gone there;
  `AddToListModal` on cards still has it). `/api/search` anime results now
  include `bannerUrl`. Tests: `tests/custom-lists.test.ts` (collections block).
  Staff & Key Creators (`StaffRail` v2): people merged with all roles, lead
  creatives as portrait cards, rest as rounded-square avatars, provider
  "no photo" images → initials.
- **Cards show members' score + retention, not the provider score
  (2026-10-21, owner)**: every anime card/poster/row uses
  `src/components/rating/CommunityScoreBadge.tsx` (star = OTAKUVA score =
  `RatingAggregate.rawAverage`, same as the anime page; coloured % =
  community retention, same maths as `getEpisodeRatingSummary`). Data:
  `src/lib/rating/communityScores.ts` → `GET /api/anime/community-scores?ids=`
  (≤200, no-store), batched client-side by `useCommunityScore`; call
  `notifyCommunityScoresChanged()` after any rating/retention write so cards
  refresh. Shows nothing until a member rates. Use it for any new card —
  don't render `anime.score` on a card. Still provider-based, by design:
  *ordering* of Top Rated / "Highest rated" / `/rankings` / studio charts,
  the "Highest score" sort on creator/studio works, the anime page's
  labelled Details stats, and the studio "avg. MAL/AniList score" stat.
  Tests: `tests/community-scores.test.ts`.
- **Calmer images + profile + Follow (2026-10-23, owner: "image looks too
  noisy, not premium")**:
  - *Posters*: 1,742 AniList posters were the ~230px `/cover/medium/` file
    stretched to card/hero size. `posterUrl` now = the same image's
    extraLarge (`/cover/large/`, ~460px): adapter maps extraLarge first and
    `scripts/upgrade_anilist_posters.ts [--apply]` rewrote existing rows
    (only when `largePosterUrl` is the same file; EditorialOverride respected;
    logged to AnimeMetadataHistory source `poster-resolution`). Second pass
    (same day): `scripts/backfill_anilist_posters.ts [--apply]` fetched
    AniList's extraLarge cover (`anilistProvider.getCoversByIds`, matched by
    AniList id, else MAL id — never title) for 351 more, mostly Jikan rows on
    MAL's ~225px file; logged as `poster-resolution-anilist`. 2,093/2,204 are
    now the ~460px file. A Jikan re-sync can put a MAL poster back — re-run
    it after imports. Also `AnimeImage`/`MediaImage` now serve the CDN file
    as-is (`unoptimized` by default): Next's optimizer re-encoded posters at
    quality 75, which was the visible grain/blocking.
  - *Backdrops*: no saturation boosts on blurred posters (muddy bands);
    homepage On-air cards have no blurred-poster background at all.
  - *Avatars*: DiceBear identicons (stored by sign-up) are treated as "no
    photo" (`isGeneratedAvatar`/`resolveAvatarUrl` in `mediaResolver.ts`) →
    one-letter monogram (`UserAvatar`, `monogramAvatarDataUri`). Sign-up no
    longer stores one; existing `User.avatarUrl` rows were left untouched.
  - *Profile* (`src/app/profile/[username]`): CSS rewritten as one layer
    (was four stacked override passes); bio inline in the header (no About
    card), Instagram-style counts (followers · following · reviews ·
    articles), Follow + Share, flat graphite banner when none, stats strip
    and reviews without cards, level panel moved into Overview, `?tab=`.
  - *Follow*: `src/lib/social/followService.ts`; `GET|POST|DELETE
    /api/users/:u/follow` (GET = counts + isFollowing + followsYou),
    `GET /api/users/:u/followers|following?before=`. UI `FollowButton`,
    `FollowListSheet` (`src/components/social/`). Followers are notified
    (`FOLLOWING_REVIEW|ARTICLE|COLLECTION|COMMUNITY`) when someone they
    follow publishes a review (once per review, PUBLISHED only), an article,
    a PUBLIC non-empty collection, or a thread outside private communities
    (at most one "active in the community" per followed member per day).
    NEW_FOLLOWER at most once per pair per day. No schema change. Not built:
    a "followed members" feed, per-person mute of follow notifications, a
    follow button on review cards/comments. Tests: `tests/follow.test.ts`.
- **Owner vs visitor profile, round stamps, Hype card (2026-10-23, owner)**:
  - *Profile*: visitors see only a member's public record — tabs Overview
    (stamps + latest reviews + recently rated + articles), Reviews, Rated
    (`GET /api/users/:u/ratings`, `src/lib/profile/publicRatings.ts`; member's
    own score, "Reviewed" tag; deleted ratings hidden), Collections (PUBLIC
    non-empty only: `GET /api/collections/public?user=`), Articles,
    Communities (badges API, so PRIVATE/showJoinedCommunities rules hold).
    No Share button, no watch-stats strip, no Library/Favorites/Activity
    for visitors; spoiler reviews show no text to them. The owner keeps
    everything (full badge panel with progress/helpful votes, stats, share,
    edit). Components: `ProfilePublicSections.tsx`, `ProfileBadgePanel`
    `variant="public"` (level + `StampCollection`: earned stamps only).
  - *Stamps*: `Seal` is a round hanko now (circle plate, double ring, beads
    from rank 3, N/E/S/W studs from rank 5, same tier colours/kanji);
    geometry in `sealOrnaments.ts` (`SEAL_RADII`, `SEAL_BEADS`,
    `SEAL_GLYPHS`), mirrored by the share card's canvas `drawSeal` — change
    both together. `Seal blank` = the un-inked slot for a level not reached.
    `LevelJourney` presses a tilted stamp onto every level reached and, for
    the owner (`celebrateFor`), plays a bigger stamp-press + "Stamp earned"
    once for a newly reached level (last seen level in localStorage).
  - *Hype*: `HypeMeter` redesigned as one card (question + one meta line;
    **Hyped** solid flame button with embers always running, **Not
    interested** ghost button; after voting your answer + a split bar).
    `SKIP`'s label is "Not interested" everywhere (was "Not hyped"; stored
    value unchanged). New CSS in `HypeMeter.module.css`; the old meter's
    `.hp*`/`.voted*`/`.plan*` rules were removed from `Hype.module.css`
    (HypeBoard's `.lb*` untouched). Tests: `tests/profile-public.test.ts`.
- **Anime page / homepage pass (2026-10-24, owner)**:
  - *Ratings in 0.1 steps*: `validateRatingScore` now accepts 0.5–10.0 in
    steps of 0.1 (was 0.5) — overall, aspect and legacy episode scores alike;
    library `personalRating` rounds to 0.1. Existing ratings unaffected.
  - *Rate window* (`RatingModal.tsx` + new `RateWindow.module.css`; the old
    `RatingModal.module.css` is now only used by `EpisodeRetentionModal`):
    one big score in its tier colour, one slider (0.1 steps) with −/+ 0.1,
    whole-number guides only — the 0.5 quick-pick chips, tier ladder and
    vibe preview were removed. OTAKUVA Vibe aspects are simple 0.1 sliders
    (untouched = unrated, never submitted).
  - *OTAKUVA Vibe section* simplified to one summary line (strongest/
    weakest) + one row per rated aspect (bar coloured by score, score, tier
    word). Donut, tier scale and "Vibe Synthesis" box removed.
  - *Hype is Hyped-only (2026-10-25, owner)*: `SKIP` ("Not interested")
    moved to `RETIRED_HYPE_LEVELS` — stored votes kept, not counted/shown,
    and those members may vote Hyped once. The homepage board has no level
    tabs any more; the hype icon is a flame everywhere (rocket removed).
    `CreatorsSpotlight` now sits right below "You are tracking".
  - *Clean pass (2026-10-25, owner: "clean and minimal, don't remove or
    change anything")*: alignment/consistency only, no section removed or
    reordered. Every page's content now starts on the header's edges
    (`AppShell.module.css` `.contentInner` has no max-width; side padding
    `clamp(20px, 4vw, 56px)` everywhere, footer too); the anime-page body
    matches its hero; News is a wide page. Extra page-level side padding was
    dropped on /news, /articles (list), /upcoming (+genre/theme/producer/
    character pages that share its CSS), /studios and studio/creator pages.
    Schedule, Settings and the article reader/form stay narrow, centred
    columns on purpose. Homepage poster rails share `--rail-card`,
    `--rail-gap`, `--poster-radius` (tokens.css) and sections sit on one
    `--page-section-gap` rhythm (`.page .main` is a flex column — don't give
    homepage sections their own top margins). Use these tokens for new
    rails/sections.
  - *Episode Retention System (2026-10-25, owner spec)* — supersedes the
    retention notes above (steps of 5, green/yellow/red, per-member average,
    auto-save). Rules live ONLY in `src/lib/rating/retentionScore.ts` (pure):
    rating = whole number 1–100 per member per episode (existing unique key
    `userId_animeId_episodeNumber`; re-rating updates; P2002 race → update);
    episode score = mean of its ratings; anime score = mean of RATED episodes'
    scores (each episode once, unrated never 0); badge from the RAW score —
    DROPPED <20, SLEEPER <40, SOLID <70, PEAKING <90, HOOKED ≥90 (was "Locked In") — only
    when ≥3 members AND ≥min(3, declared episodes) rated episodes, else
    "Provisional" (no badge); nothing rated = "Not rated". DB reads:
    `animeRetention.ts` (`getAnimeRetentions` batch, `getRetentionRankings`),
    computed on read. Shown: anime hero chip (links `#retention`), the
    Retention section (replaced the 1–10 Community Rating block —
    `RatingDistributionCard`/`AnimeScoreCard` now unused), Episode Guide rows
    (`RetentionBars` → `RetentionSegments`: 20 silver/graphite segments,
    explicit Submit/Update, community avg + count below; watched-tick first
    still enforced), `EpisodeRetentionModal`, every card via
    `CommunityScoreBadge` ("72% PEAKING" / "Provisional" — no star score on
    cards any more), `/rankings` Retention tab (default; rated and
    Provisional listed apart; `GET /api/rankings/retention`). Badge UI:
    `RetentionBadge`. `retentionTone.ts` colours now = badge bands. The 1–10
    member rating (Rate window, OTAKUVA Vibe, reviewer scores on reviews) is
    kept — owner's choice — it just isn't the headline score. No migration.
    Tests: `tests/retention-score.test.ts`.
    **Same day, owner follow-up**: the top badge is **Hooked** (key
    `HOOKED`, was Locked In); band colours are clear green → lime → yellow →
    orange → red (`RETENTION_BADGES`) and colour the rating bar fill
    (`RetentionSegments` `color`), the episode chart bars (+ legend) and the
    numbers. Retention section = Community **ring** (earlier design) + You as
    the big number. OTAKUVA Vibe got its **donut circle** back beside the
    aspect rows — then (owner, same day) **grades only**: no score numbers
    anywhere in Vibe, circle centre = overall grade + "N members rated",
    each aspect in its own colour (`ASPECT_COLORS`, data colours — the
    owner asked for them), no Worst…Great tier chips. It's "what to expect",
    not a score.
    **Then (owner)**: every retention % carries its band name (cards, hero,
    ring, chart extremes, episode rows "You 72 · Peaking", profile
    activity); a Provisional title shows its band greyed with "· early"
    ("Solid · early") instead of a coloured badge. The 1–10 star score beside
    an anime in review lists (homepage Latest reviews, profile reviews) and
    the creators feed is replaced by `PeakedAt` — "Peaked at 93%", the
    anime's community retention, number only, no band name. `frontPage`
    review items and `creatorDirectory` feed items now include `anime.id`.
  - *Big anime-page pass (2026-10-25, owner)*:
    - **Characters for every anime**: only 286 / 18,106 anime had any.
      `scripts/import_characters_studios_anilist.ts [--apply] [--limit=N]
      [--studios-only]` (AniList, 6 anime/request, resumable via
      DataSourceRecord CHARACTER/anilist): characters main-first (AniList
      returns 25 per anime per request — not paginated further) + Japanese
      VAs, only for anime with no characters yet; Character matched by
      `externalId = "anilist:<id>"` (slug `<name>-c<id>`), never by name;
      VAs via personResolver. Same run adds missing **studio links**
      (animation studios only, via CanonicalStudioResolver; non-main =
      role ANIMATION, isMain false, source ANILIST) — owner's "re-check
      studio counts from AniList". Log in scripts/import_logs/.
    - `CharacterPreview` modernised: main first, All/Main/Supporting filter
      with counts, scroll arrows, name over the portrait, Japanese VA below;
      no more anime-poster stand-in for a missing character photo.
    - **Vibe input**: new table `AnimeVibe` (migration
      `20261025150000_anime_vibe`, hand-written without the searchVector
      drops) — one grade (WORST…GREAT) per member/anime/aspect.
      `src/lib/rating/vibe.ts` (`getVibeSummary`, `saveVibe`), `GET|POST
      /api/anime/[id]/vibe` (verified members, after ep 1 airs; `null`
      removes a grade). Chart = Vibe grades, else the member's older aspect
      score from the 1–10 window (each member once per aspect); grades
      average via band mid-points, shown as grades only. `VibeModal`
      ("What's your vibe about this anime?") opened from the prompt at the
      top of the Vibe section, right under Retention. In the account export.
      `OtakuvaVibe` now takes `vibe: VibeSummary` (SVG ring, grade pills,
      "You: Good"). `AnimeVibe` is read/written with plain SQL
      (`$queryRaw`/`$executeRaw`, id = `gen_random_uuid()`) so it works
      even on a server whose Prisma client predates the table. Browser
      components import ONLY `src/lib/rating/vibeGrades.ts` (constants +
      types) — importing `vibe.ts` (server: prisma) into a client component
      broke the page bundle and made grade clicks do nothing (fixed
      2026-10-25).
    - **Vibe chart = infographic ring (owner, later 2026-10-25)**: SVG donut,
      one coloured segment per aspect with small gaps, numbered 01–07,
      segment size = how strongly that aspect is rated (share of the summed
      averages, shown as %), raised centre with the overall grade + members,
      callouts (dot + elbow line) with name · grade · share · "You: X".
      ≤760px: ring + numbered legend instead of callouts.
    - **Reviews redesign (owner, reference screenshot)**: `AnimeReviewsCard`
      rewritten — "Write a Review" card (avatar, @username, plain textarea
      with spellCheck/autoCorrect, char count /5000, "Contains spoilers",
      Post → POST /api/reviews; "More options" opens WriteReviewModal for
      headline/tags), "User Reviews" with sort select + "Show spoilers" +
      "Creators only" toggles. Each review: avatar, name, creator check,
      tier chip, Spoiler-free/Spoilers tag right after the name (no spoiler
      line above any more), and a verdict pill = the reviewer's own
      retention band (`retention` on GET /api/reviews items via
      `src/lib/reviews/reviewerRetention.ts`). Replies collapsed behind
      "View N replies"; own replies marked "You" with delete. The reviewer's
      1–10 star is no longer shown on the card.
    - **1–10 star ratings switched OFF (owner, 2026-10-25, later)**:
      `src/lib/rating/starRatings.ts` (`STAR_RATINGS_ENABLED`, default off).
      Off = POST /api/anime/:id/rating → 410 STAR_RATINGS_OFF, legacy
      per-episode `{score}` → 410, library `personalRating` ignored, creator
      review score ignored (editor field removed). Stored AnimeRating rows
      are kept, not shown. UI: hero/sticky "Rate" → "Rate episodes" (scrolls
      to `#episodes`), poster "Your rating" badge removed, journey card shows
      "Your retention", profile Rated tab = anime the member rated episodes
      of with their retention (`publicRatings.ts` now from EpisodeRating).
      Tests that cover the old star logic set the env var themselves;
      `tests/star-ratings-off.test.ts` checks the default.
    - Vibe chart: the same callout chart on phones (own NARROW geometry,
      "World Building" → "World"); tap a segment/label → it pops out, others
      dim, the centre shows that aspect (grade, share, members / your grade).
    - Reviews are chat bubbles (avatar beside a bubble; replies smaller,
      indented bubbles) — owner picked this over cards.
    - Episode Guide phone polish: community score as a pill under the title,
      rating bar full width below, 36px tick, locked bar plain (the striped
      locked bar shimmered on phones), no empty "—".
    - **Episode comments**: optional ≤280-char comment with an episode
      rating (`EpisodeRating.review`, no schema change; omitted keeps,
      '' clears). Inline "Comment" in Episode Guide rows. Homepage Latest
      reviews shows creators' episode ratings with comments
      (`creatorEpisodeNotes` in frontPage) and highlights creator reviews
      (Creator chip + channel, accent bar).
    - Episode Guide: newest episode gets a live "Just aired · 2 min ago"
      (first 24h); next one says "Airs in 3h 12m" instead of "Not aired yet".
    - Movies: "Runtime 1h 47m" in the hero and Details (`src/lib/anime/runtime.ts`).
    - Details: "On OTAKUVA" — in libraries, favorites (Favorite ∪
      UserAnime.favorite), rated (1–10), episode raters. Always shown.
    - **Recommendations follow the anime's genres**: `similarAnimeEngine` v4
      — candidate pool by IDF-weighted shared genres (rare genres like
      Horror count more), one entry per series, the anime's own series
      excluded; signed-in members use it too (was the general taste engine,
      same list on every page). ~1s.
    - Footer: link columns removed; "Made in India / Made with ♥ from India",
      "© 2026 Copyright OTAKUVA"; Privacy · Terms · Data credits kept small
      (AniList credit + privacy policy are required).
  - *Profile numbers, completion milestones, homepage spacing (2026-10-26, owner)*:
    `GET /api/users/:u/stats` adds `tracking` (all library entries), `rated`
    (anime rated by retention), `meanRetention`, `reviews` (PUBLISHED count —
    the profile used to count only the first page of 20) and `milestones`.
    Profile: the big owner-only stat strip became small tappable chips for
    everyone (Tracking/Completed/Watching/Dropped open the owner's Library
    tab filtered by status — library lists stay owner-only; Rated/Reviews
    open their tabs); Library tab has a status filter (`?tab=library&status=`),
    `?list=followers|following` opens the follow list. **Completion
    milestones** `src/lib/library/completionMilestones.ts`: 10/25/50/100/250/
    500/1000 completed → one `COMPLETION_MILESTONE` notification the moment
    it's reached (library PATCH, both mark-all-watched routes, watched-episode
    ticks, episode progress), stamps on the profile + "next at N". Creator
    dashboard overview: "Your anime & people" (status counts, rated, reviews,
    following, stamps; each links to its profile list); dashboard numbers
    smaller. Homepage: `CommunityScoreBadge position="top"` on cards with a
    rank numeral (Top Rated); overlay chips drop "· early"; Hype board
    countdown moved top-left. Upcoming cards (`HypeCard`): date top-left,
    round ⚡ hype badge bottom-left (filled when you're hyped), title + meta
    only. HypeMeter voted line "You're hyped for this anime"; header bell
    polls every 60s while visible. Tests: `tests/profile-stats-milestones.test.ts`.
  - *Hyped → tracked → premiere notification (2026-10-25, owner)*:
    `src/lib/hype/hypePremiere.ts`. Voting Hyped adds the anime to the
    library as PLAN_TO_WATCH (+ STATUS_CHANGED activity) only when it isn't
    already there — never changes an existing status. Once episode 1 has
    aired (`getEpisodeReleaseState`), each Hyped voter gets ONE
    `HYPE_PREMIERE` notification ("<title> has premiered", link
    `/anime/<slug>#retention`); exactly-once via a per-anime
    `pg_advisory_xact_lock` + "already has this type+link" check — no schema
    change. Premieres older than 30 days aren't announced. Runs: for the
    member on `GET /api/notifications`; background sweep (≤ every 10 min per
    process) from the homepage and `/api/schedule`; after each schedule
    refresh (`ensureFreshSchedule`). Not a queue job yet. The header bell now
    refreshes every 5 min while the tab is visible. HypeMeter: no "Add to
    Plan to Watch" button any more — says "Added to your library. We'll
    notify you when it premieres." Votes cast before this change were not
    back-filled into libraries. Tests: `tests/hype-premiere.test.ts`.
  - *Hype icon + ranks, trailer backdrop (2026-10-25, owner)*: hype icon is
    lucide `Zap` everywhere (`HYPE_ICONS`, HypeMeter, profile activity,
    CreatorsSpotlight) — not Flame or Rocket. Hype board ranks are big "01"
    numerals like Top Rated (gold/silver/bronze for 1–3). Anime hero
    background: AniList banner → else a still from the anime's own YouTube
    trailer (`trailerStills` in `heroArt.ts`, maxres → sd → hq, a <400px
    stand-in steps down) → else the blurred poster. 6,686 anime have a
    banner, +3,004 more get a trailer still, ~8,400 still fall back to the
    poster. Some stills carry the video's own "Official trailer" text.
  - *Hype* on the anime page: one question, one button — "Are you hyped
    for this anime?" → I'm hyped → "You are hyped for this one" (no "not
    interested" choice there since later on 2026-10-24; old SKIP votes still
    show as the member's answer). Counts/rankings live on the homepage board.
  - *Anime-page Latest News* showed empty image boxes: `AnimeNewsList` read
    `thumbnail/source/date`, but `/api/anime/:id/news` returns
    `imageUrl/sourceName/publishedAt` (and it linked by id, not slug). Now
    real art, a text card for imageless stories (~65% of NewsArticle rows
    have no image), Gravatar URLs never used as art.
  - *Reviews*: auto-detected aspect chips ("Enjoyment · positive") removed;
    the spoiler label (shield, "Spoiler-free review") sits above the name
    and score, larger.
  - *Type*: anime hero title ≤54px; every anime-page section title
    `clamp(19px, 1.7vw, 22px)` / 800; synopsis 15px; homepage section
    titles `clamp(18px, 1.6vw, 22px)`, masthead ≤30px, quotes/news/
    spotlight text 13.5px.
  - *Header*: the search button is hidden on `/` (the masthead has its own
    search); Ctrl/Cmd+K still opens search there.
- **Creator Mode (2026-10-24)** — migration `20261024120000_creator_mode`
  (additive: `User.creatorSince/creatorChannelName/creatorChannelUrl`,
  `Review.isCreatorReview` + status `DRAFT`, `CommunityInvite.keyHash/
  keyHint/createdAt/lastUsedAt`). Tests: `tests/creator-mode.test.ts`.
  - *Role*: `CREATOR` in `src/lib/roles.ts` (`isCreator()`; same admin tier
    as USER). Granted only by `POST /api/creator/upgrade {channelName,
    channelUrl?}` (signed-in USER; staff roles 409) or an admin via the
    role route. Sign-in is one plain user flow (the "Normal user / Content
    creator" choice was removed the same day, owner); a CREATOR account is
    sent to `/creator` after signing in unless the window was opened for an
    action. Non-creators reach `/creator` (the upgrade step) from the user
    menu ("Become a creator"). No verification badge exists.
    Header (owner, 2026-10-24): signed-in members have no search button;
    creators get a round dashboard shortcut (`.creatorBtn`) in its place;
    signed-out visitors keep search (not on `/`). Ctrl/Cmd+K works for all.
    `/creator` and `/creator/communities/*` use AppShell's wide layout.
  - *Members-only communities* = `PRIVATE` + `INVITE_ONLY` +
    `CREATOR_EXCLUSIVE`, creators/admins only. Access settings are decided
    server-side in `src/lib/community/communityPolicy.ts` (visibility
    validated, joinPolicy derived, creator types gated, only the owner
    changes visibility, status limited to ACTIVE/ARCHIVED) — before this
    they were taken from the request unvalidated. **Fixed holes**:
    `joinCommunity` let anyone join a PRIVATE community whose policy wasn't
    approval-based, and accepted any `verificationData.token` for
    creator-exclusive ones; the legacy `createCommunityInvite` logged its
    plaintext token (now logs the id; marked @deprecated).
  - *Invitations* (`src/lib/community/invitations.ts`): link
    `/community/invite/<id>` (grants nothing alone) + access key (120-bit
    crypto random, Crockford base32, shown once; only SHA-256 stored).
    Redeem = locked-row transaction (expiry, revoked, maxUses, ban,
    duplicate), generic errors, `INVITE_KEY` rate limit (8/15min per user,
    30 per invitation; in-memory, per process). Rotate = new key same link;
    revoke keeps members; `DELETE /api/communities/:slug/members/:userId`
    removes one. The first invitation is issued in the creation transaction.
  - *Creator reviews* (`src/lib/creator/creatorService.ts`): ordinary Review
    rows; drafts (`DRAFT`) never public (also excluded from taste engines and
    the "your review" slot); publish goes through `createAndAnalyzeReview`
    then the server stamps `isCreatorReview`; optional score = real
    AnimeRating on publish; nothing publishes before ep 1. Shown with a
    "Creator Review" label + headline on the anime page (filter chip
    "Creators", `GET /api/reviews?creators=1`) and on the homepage feed.
  - *UI*: `/creator` (onboarding or dashboard), `/creator/communities/:slug`
    (visibility, invitations, members), `/creator/reviews/new|:id`,
    `/community/invite/:id`; create form offers Members-only to creators and
    shows the link + key once. Header menu: "Creator dashboard" /
    "Become a creator".
  - *Creators + followers (2026-10-24, later)*: creators' followers also get
    `FOLLOWING_RATING` (creator rated an anime — from the rating route) and
    `FOLLOWING_HYPE` (creator voted Hyped — from `setHype`), once per creator
    per anime; members' ratings/hype never notify. "Creator" for display and
    these notifications = `role === 'CREATOR'` exactly (`isCreator()` also
    passes admins, for permissions). Profiles show a Creator chip, channel
    link and a larger follower count (`GET /api/users/:u/follow` now returns
    `isCreator/channelName/channelUrl`). Anime pages show "Creators on this
    anime" (`AnimeCreators`, `GET /api/anime/:id/creators` → creators who
    rated / published a review / are Hyped, most followers first, public,
    with Follow buttons; anchor `#creators`, `?creator=<u>` highlights one).
    Creator reviews lead the default review order. Dashboard: Followers stat
    (+N this week), Followers tab (recent followers, Follow back), follows in
    the activity feed. Tests: `tests/creator-followers.test.ts`.
  - *One place for profile + dashboard (2026-10-24, owner)*: the dashboard
    UI is `src/components/creator/CreatorDashboard.tsx` (`embedded` drops its
    big heading) and lives as the first tab, "Creator dashboard"
    (`?tab=dashboard`), of the creator's OWN profile — owner-only, hidden from
    visitors. `/creator` now only redirects creators there and hosts
    `CreatorOnboarding` for everyone else; the header button and user menu
    link straight to the tab. The profile reads `?tab=` via
    `useSearchParams`, so the header button switches tabs in place.
    Follower lists (`listFollows` → `isCreator`, `channelName`), the
    dashboard's follower list and the NEW_FOLLOWER note ("A creator followed
    you") mark creator accounts. Homepage: `CreatorsSpotlight` (right above
    "Creators and Directors", owner) — kicker "Content creators", title "The
    creators you follow" when the viewer follows any (those first, with a
    "Following" tag) else "Creators to follow"; story-style circles of every creator (most followed first;
    bright ring = rated/reviewed/hyped in the last 7 days) + a feed of their
    recent ratings / Creator Reviews / hype; `GET /api/creators`
    (`src/lib/creator/creatorDirectory.ts`, public, cached 60s, no adult
    titles). Renders nothing with no creators.
  - *Verification build*: `NEXT_DIST_DIR=.next-verify npx next build` builds
    into its own folder (next.config `distDir`), never touching a running
    dev server's `.next`. Don't use `npm run build` for that (prebuild cleans).
  - Not built: per-community analytics, invitation-level usage history,
    shared/Redis-backed rate limiting, creator verification.
- **Full catalog import (2026-10-23, owner: "we need every anime")**:
  `scripts/import_catalog_anilist.ts --all --apply` walks AniList year by
  year (1917 → next year, `getAnimeByStartYear`, includes year-only dates
  that `getHistoricalAnime` misses) plus every NOT_YET_RELEASED title; same
  add-only / id-matched / no-adult / no-music-video rules; re-runnable.
  Backup taken first (`../otakuva-backups/otakuva-before-full-import-*.dump`,
  pg_dump -Fc, outside the repo); log in `scripts/import_logs/` (gitignored).
  `backfill_relations_anilist.ts` now queries by AniList id first (new
  titles often have no MAL id), else MAL id. Result of the 2026-10-23 run:
  catalog 2,204 → 18,106 (4,481 adult/music skipped; 3 same-title rows held
  for review, listed in the log); then relations 21,198 rows, streaming
  13,319 rows, creators 40,477 people / 197,668 credits (15,540 anime with
  credits). Audit: 0 duplicate MAL/AniList ids, 0 same title+format+year;
  200 same-name people pairs listed for review (not merged — often different
  people). Not filled: characters/voice cast (Jikan still down) and episode
  lists for the new titles (the `episode-backfill` worker job needs Redis).
- **Homepage verdicts, On air rail, Theme picker (2026-10-26, owner)**:
  - *Top Rated cards*: the retention chip is replaced by `VerdictCount`
    ("12 verdicts", tooltip "N members rated episodes or reviewed this
    anime") = distinct members with an episode retention 1–100 OR a
    PUBLISHED, non-deleted review (`verdicts` in `communityScores.ts`;
    test in `tests/community-scores.test.ts`). Hidden at 0.
  - *On air* (`OnAir` in `FrontPage.tsx`): a horizontal rail of big cards
    (poster, local day · time, episode, live h:mm:ss within 2h else
    "in 10h 39m", "Aired 2h ago" + "Rate episode" → `#episodes`), Up next /
    Just aired tabs, arrows on desktop, swipe on phones. Most Hyped board
    is now top 10 with smaller posters (`.lbShort`).
  - *Theme picker*: Graphite (default, unchanged), Midnight, Sakura, Ember,
    Emerald. `src/lib/theme/themes.ts` (ids, `THEME_INIT_SCRIPT`),
    `src/styles/themes.css` (`:root[data-theme=…]` overrides of the page/
    surface greys + accent tokens only — retention bands, medals, hype and
    score gold never change), `ThemePicker` in the user menu and Settings
    (removed from the footer the same day, owner). Per device (localStorage
    `otakuva-theme`), applied before paint by an inline head script. Hard-
    coded page greys used as *backgrounds* in CSS modules were pointed at
    the tokens (same values) so themes reach them; dark text on white pills
    was left as-is. Use tokens, not `#141416`/`#1B1B1E`, for new surfaces.
- **Owner pass (2026-10-26, later)**:
  - *Library is the member's choice*: ticking an episode (watched-episodes
    route and `toggleEpisodeWatchStatus`) never creates a `UserAnime` row any
    more — it only updates an existing one (`inLibrary: false` /
    `userTracking: null` otherwise). Ratings/retention/reviews never added
    one. Hype → Plan to Watch (owner's earlier rule) is unchanged.
    `tests/episode-watch.test.ts`.
  - *On air*: big countdown cards only for episodes within 2 hours; the rest
    are bigger Up next / Just aired list rows (Just aired → "Rate").
    Most Hyped back to larger posters (top 10).
  - *Descriptions removed site-wide*: `PageHead` no longer renders its
    subtitle; taglines under page titles, the Top Rated footnote, the hype
    board summary line, Vibe/Retention/Premiere notes were dropped. Don't add
    explanatory sub-lines back; real content (list/franchise descriptions,
    news summaries, empty states) stays.
  - *Vibe chart*: no 01–07 numbers on segments, larger ring, soft depth.
  - *Episode Guide v6*: soft raised tiles, number chip, no white left edge on
    "Up next". *Reviews/replies*: flat on the page (no bubble/card/border),
    one line = avatar · name · level · retention verdict · spoiler tag.
  - *Subtle 3D*: `--depth-1/--depth-2` shadow tokens (tokens.css) on posters
    and cards, small lift on hover. Keep it subtle.
  - *Explore*: "Welcome back"/profile masthead is homepage-only; Explore is
    infinite scroll (IntersectionObserver sentinel, pages appended, no pager,
    `?page=` no longer written to the URL).
- **Watched → rate first, Where to Watch logos (2026-10-26, owner)**:
  - *Episode Guide*: ticking an episode you haven't rated keeps that row as
    the focus ("Rate this episode", green-lit tile, its retention bar ready)
    instead of jumping "Up next" to the following episode; once a retention
    is submitted (or the tick is undone) "Up next" moves on. Client-only
    (`rateFirst` in `EpisodeQuickList.tsx`).
  - *Where to Watch*: official platform icon on its brand colour, a soft tint
    of that colour, lift on hover. Art comes from AniList's
    `ExternalLinkSourceCollection` (36 streaming sites) via
    `anilistProvider.getStreamingSources()` into the new `StreamingPlatform`
    table (one row per site; migration `20261026120000_streaming_platform`,
    additive) — `src/lib/catalog/streamingPlatforms.ts`, read/written with
    plain SQL like AnimeVibe. `scripts/sync_streaming_platforms.ts [--apply]`
    refreshes it and lists listings with no art; re-run if AniList adds a
    site (unknown sites show a letter tile). The anime detail DTO's
    `streaming[]` now carries `iconUrl`/`color`. Tests:
    `tests/streaming-platforms.test.ts`.
- **Hype button in the hero (2026-10-27, owner)**: on a not-yet-premiered
  anime the Hype control is no longer a panel in the premiere notice — it's
  one pill right under Add to Library, same shape/size/width
  (`HypeMeter compact`, passed as `AnimeHero`'s `belowLibrary`; the two stack
  in `.libraryStack`). "I'm hyped" (flame gradient + embers) → "You're
  hyped"; the library/notify note became a toast. The hype icon is now
  lucide `Sparkles` everywhere (`HypeIcon`/`HYPE_ICONS` in `HypeMeter.tsx`) —
  replaces Zap; not Flame or Rocket either.
- **Vibe chart details + page order (2026-10-26, owner)**: the Vibe ring has
  shaded segments with a bright outer rim, a faint 5° tick ring, and a soft
  glow tinted by the overall grade (or the tapped aspect); the "Strongest /
  Weakest" sentence became four tiles under the chart (Strongest, Weakest —
  tap to select that aspect — Members, Your vibe). Section description line
  removed. Anime page: reviews now come **after** the Episode Guide.
- **Owner-supplied streaming logos (2026-10-26)**: `public/brand/streaming/`
  — `prime-video.png` (fills the tile, card tinted #0779FF),
  `crunchyroll.png` (on white). No stand-in logo: a platform with no icon
  gets a plain grey letter tile (the owner's generic star mark was removed —
  it showed on every card when AniList's CDN failed to serve icons). Icons
  are now downloaded by `scripts/sync_streaming_platforms.ts --apply` into
  `public/brand/streaming/sites/<anilistSiteId>.png` and served locally
  (`StreamingPlatform.iconUrl` holds that path) — no hotlinking. No glow:
  cards are flat, no brand tint or coloured shadows. Mapped by site name in `LOCAL_LOGOS`
  (`WhereToWatch.tsx`); everything else uses AniList's icon. The Netflix image
  offered was a watermarked VectorStock preview — not used; Netflix keeps
  AniList's official icon until a clean file is supplied. Which anime is on
  which platform is per-anime AniList data (8,019 anime with a listing:
  Crunchyroll 3,399, Netflix 970, Prime Video 437, …).
- **Anime page navigation (2026-10-27, owner: borrow from two reference
  layouts, keep font/theme/colours)**: `AnimeSectionNav` — a sticky "on this
  page" chip bar under the header (Overview · Details · Retention · Vibe ·
  Watch · Episodes · Reviews · Characters · Staff · Related · For you ·
  Discussion · News; only sections actually rendered), scroll-spy
  highlight, white active pill, scrolls sideways on phones. Sections carry
  those ids (`#retention`, `#episodes`, `#reviews`, `#discussion` kept);
  `.contentSection[id]` has a `scroll-margin-top` clearing header + bar.
  Episode Guide: range chips (12 per chip up to 120 eps, 25 up to 400, 50
  up to 1200, else 100) for lists over 24 — opens on the range holding
  "Up next" (green dot), stays put once you tick/pick; "Show all" only for
  short lists. Related Anime: filter chips by relation type with counts
  (only with 2+ types).
  Same day, owner follow-up: **Vibe** shows no member counts any more (centre
  = overall verdict line, e.g. "Worth watching"; the Members tile became
  "Verdict"); new "What to expect" list = one plain sentence per graded
  aspect, worded from its grade only (`EXPECT` in `OtakuvaVibe.tsx`, four
  bands: Great/Good · Decent · Average · Worst); Weakest tile hidden when
  every aspect has the same grade. **Episode retention is locked once
  saved**: `RetentionBars` shows the saved value read-only
  (`RetentionSegments readOnly`) with an "Edit" button → Save / Remove /
  Cancel, so a stray touch can't change it. **Related Anime** is compact
  (auto-fill 128px tiles; 3 columns on phones), relation names normalised
  ("ADAPTATION" → "Adaptation"); recommendations are titled "You Might
  Like" (same spotlight + rail UI). **Homepage masthead** has seasonal
  artwork, `SeasonScene` (SVG, no stock/anime art): fall maple branch +
  torii + low sun + falling leaves; spring sakura, summer fireflies, winter
  snow; right side on desktop, top banner on phones (masthead padding-top
  150px ≤760px); particles off under reduced motion.
  Then (owner): fall uses the owner-supplied artwork instead of the drawn
  scene — `public/brand/seasons/fall.webp` (1920w) / `fall-sm.webp` (960w,
  phones), from `ARTWORK` in `SeasonScene.tsx` (crop `50% 22%` keeps both
  faces); leaves still fall on top. Other seasons keep the SVG until art is
  added there. Rights/credit for that artwork are the owner's to confirm.
- **Badges count reviews AND ratings (2026-10-27, owner)**: every review had
  been INELIGIBLE (40-word minimum; library-status gate that ticking/rating
  no longer satisfies) and maturation only ran on the Redis worker, so every
  badge sat at 0. Now (`src/lib/badges/config.ts`, `rules.ts`,
  `countingService.ts`): `minWords` 5, `maturityHours` 1; "watched" = library
  status at writing OR now Watching/Completed/On hold/Dropped OR ticked
  episodes (`UserEpisodeWatch`) OR an episode retention (`hasWatchedEpisodes`);
  level points = counted reviews + **anime rated** (distinct anime with any
  episode retention), stored in `UserBadgeStats.countedReviewCount` so all
  tier/ladder readers keep working. `refreshUserBadges(userId)` (throttled
  20s/member/process) re-checks NOT_WATCHED reviews, matures due ones (daily
  cap kept) and recounts — called by `GET /api/users/:u/badges` and after
  each episode retention save/delete, so counting no longer needs the worker.
  The badges API adds `reviewCount`/`ratedCount`; the owner panel shows
  "N reviews · N anime rated · helpful votes · communities" (+ "N reviews will
  count within the hour"). Existing data recounted once with
  `scripts/badges/recount_after_rule_change.ts --apply` (8 reviews counted;
  13 still NOT_WATCHED — no library entry, ticks or ratings for that show;
  they count automatically once the member ticks/rates an episode).
  Also: on phones (≤640px) the header's notification tray and account menu
  open as a full-width sheet under the header (list scrolls, stops above the
  bottom bar) — the 320px tray used to run off the left edge.
  **Badge path + share card (2026-10-27, owner, later)**: `LevelJourney` no
  longer has one rail under every seal — each step draws a short connector
  in the gap from the previous seal's edge to its own (`.link`, `--pr`/`--r`
  radii, `--part` fill), in the colour of the level it leads to (full when
  reached, part-way for the next, dashed after). Reached seals glow in their
  colour and their name takes it; unreached stay blank; requirement labels
  read "At 100"; hint says "N more reviews or ratings to X".
  `ProfileBadgePanel` shows blank dashed seals while loading (never a
  guessed tier). Palette (tiers.ts only): Buchō teal → copper `#B4612A`,
  Tatsujin navy → steel `#56637A` (dark `#64728A`/`#AEBBD0`) so the ladder
  reads green → blue → copper → purple → crimson → steel → black-gold →
  ivory. Share card (`profileCard.ts`): creators get a blue tick "Creator"
  chip after the level chip and "LV n · CREATOR"; stats are Reviews · Rated
  (from the badges API's `reviewCount`/`ratedCount`) · Completed · Episodes;
  **Manga** = ink title band + paper page with three bordered panels — the
  banner inked into them (greyscale/contrast via `ctx.filter`, saturation
  blend fallback, halftone) or screentone + speed lines without one — focus
  lines from the seal and a ドン！ in the tier colour; **Minimal** = tier-
  colour wash, pinstripes, outlined level kanji watermark, ripples around
  the seal.
- **Owner pass (2026-10-27, late)**: `StaffRail` — everyone after the key
  creators is a wrapping grid of ROUND avatars (first 12 + "Show all N
  staff", first role + "+N more"); on phones key creators are a 3-column grid
  (no swipe strip). Profile avatar's level seal: round, no dark square plate.
  "Collected" marks: `LevelJourney` puts a check on every collected seal
  (+ "Collected" label for earned levels), `StampCollection` a coloured
  "Collected" tag under each stamp. Anime hero age-rating box has real
  padding/min-height (letters touched the outline). Homepage "Premiering
  within 2 hours" cards: text wraps/ellipsizes inside the card, clearer red
  outline. Ranked poster rails (Top Rated, Most Hyped) less packed: rank
  numerals 32px (26px phones), smaller verdict chip, 124px phone cards.
- **Badge info, Vibe details, creator reviews (2026-10-27, owner)**: every
  seal in `LevelJourney` and `StampCollection` is a button that opens
  `BadgeInfoSheet` (portal; centred card, bottom sheet on phones): seal,
  kanji, meaning, level n/9, Collected / "N to go" + progress, about text,
  "How to earn it" and "What it gives you" — criteria/perks DERIVED from
  tiers.ts + config.ts gates in `src/lib/badges/tierInfo.ts` (prose in
  `TIER_ABOUT`). `StampCollection` now also shows not-yet-collected levels
  as blank "Locked" slots (tappable) — visitors see them too. OTAKUVA Vibe:
  the four tiles and the "What to expect" list are gone; tapping a segment
  or label opens a detail card (what the aspect covers, the expect line,
  members' grade, share of the vibe, your grade — no member counts).
  Homepage Latest reviews: creator reviews have no left bar; just a blue
  tick "Creator review" chip ("Creator" on episode-rating notes).
- **One page frame (2026-10-28, owner: "same left/right padding on every
  tab, centred")**: tokens `--page-max` (1600px) and `--page-gutter`
  (`clamp(16px, 3vw, 40px)`) in `tokens.css`, used by the header, footer,
  AppShell (normal + wide pages — no separate wider catalog frame now) and the
  full-bleed pages' inner content (home `.main`, anime hero + body + section
  nav, profile, `/l/`). Pages no longer add their own side padding or column
  (schedule, articles, history, people, upcoming, franchise, discussion
  detail, news reader, badges, person, search, directory got a "Page frame"
  override at the end of their CSS). Deliberate centred reading/form columns
  kept: article reader body, Settings, Credits, legal pages, collection
  builder. Use the two tokens for any new page; don't hard-code gutters.
- **Studios from Wikidata + studios redesign (2026-10-28, owner)**:
  `scripts/enrich_studios_wikidata.ts [--apply] [--no-logos] [--no-wikipedia]`
  (backup first: `../otakuva-backups/otakuva-before-studio-enrich-*.dump`).
  Matches by id only — Wikidata "MyAnimeList company ID" (P11490), or an anime
  found by AniList/MAL anime id whose production company (P272) carries the
  same name as one of OUR studios linked to that anime; ambiguous matches are
  skipped and logged. Fills empty fields only: founded year/date, closed date,
  native name, aliases, website, Wikipedia URL, HQ city, short description,
  Wikipedia intro as `about` (page shows "From Wikipedia, CC BY-SA 4.0"), MAL
  id; logos downloaded to `public/brand/studios/<Qid>.png` (not hotlinked).
  `country` is never written (Wikidata had US/China for some Japanese
  studios) — kept in `metadataJson.wikidata.country`, disagreements logged;
  the page shows only city/region. CLOSED only if no works after the closing
  year. Timeline = `StudioHistoryEvent` (source Wikidata, UNVERIFIED).
  2026-10-28 run: 274 matched, 245 founded years, 189 about texts, 167 logos,
  260 events. Left for review in the log: Sunrise (two Wikidata items —
  Sunrise vs its 2022 rename), Saber Works/DNA, 8 "closed but later works".
  Studio page: founded date/founders/parent in the hero, **History**
  timeline (company events + milestones derived from the catalog: first
  work/TV/film, most-watched, busiest year, latest, coming next).
  `/studios` is now a server page (`src/lib/studios/studioDirectory.ts`, one
  SQL query, unstable_cache + 10-min in-memory memo; `GET
  /api/studios/directory?q=&sort=works|name|oldest|newest|active&status=all|active|closed&offset=&limit=`):
  "Founded through the decades" timeline + every studio (was 24) with
  search/sort/filter and infinite scroll. Homepage studio cards reuse its
  `StudioCardGrid`; `getHomeData` studios gained `logoUrl/nativeName/
  foundedYear/city/closed` (additive) and pick "known for" by members.
  Logos are wide wordmarks: `.logoImage` plates widen to fit (Entity.module.css).
  Homepage Browse by Genre: bigger 4:3 tiles, no title counts, layered 3D
  shadows + sheen + tilt-lift on hover. Catalog re-import the same day added
  only 11 titles — AniList is fully imported; what's left out on purpose is
  adult titles and music videos (~2.5–3k MVs).
- **Landing page `/welcome` (2026-10-28, owner)**: signed-out visitors opening
  `/` are sent to `/welcome` by `src/middleware.ts` (no `anilog_token` and no
  `otakuva_guest` cookie → 307; done in middleware because the root
  `loading.tsx` streams first, so `redirect()` in the page came too late; the
  homepage still re-checks the session as a fallback). Full-screen (AppShell
  `isImmersive`): tilted wall of the 72 most-watched posters (AniList
  `/cover/medium/`, ~3× lighter) in columns drifting up/down, glass card with
  the sign-in form → homepage after sign-in. "Browse without signing in" sets
  `otakuva_guest` (30 days, `src/lib/landing/guest.ts`). Every other page
  stays public (owner chose this over a site-wide login wall). The sign-in /
  sign-up form now lives in `src/components/auth/AuthForm.tsx`, shared by
  `AuthModal` and `/welcome` — change it there. Same day, later: the wall is
  a 160vmax tilted square (18 columns × 14 posters, cycled from 120 titles,
  no Ecchi covers) so no corner is ever bare; the card is top-anchored and
  mostly opaque (the re-centring and the blur over moving art were the
  "jitter"). `/welcome` shows three pill tabs — Sign In / Create Account /
  **Creator**: username + channel name + channel link + phone/SMS code →
  the normal `register` → then the existing `POST /api/creator/upgrade`
  (unchanged; channel limits now shared from `src/lib/creator/channelRules.ts`
  so the form checks before the account is created). The pop-up still has
  two tabs (`AuthForm` `modes` prop). The empty `Landing page/`
  folder at the repo root isn't used (Next only serves `src/app`).
- **Passwords for everyone (2026-10-28, owner) — supersedes "Phone + OTP
  replaced email verification" above for sign-in.** Sign-up: username + phone
  → SMS code → `POST /api/auth/phone/verify-code` returns a signed **phone
  pass** (`signPhonePass`/`verifyPhonePass` in `src/lib/auth.ts`: 10 min,
  own JWT audience, so it can never act as a session) → password + confirm →
  `POST /api/auth/register { username, password, pass }` (the one-step
  `{ phone, code, password }` form still works; a password is always
  required). Sign-in: `POST /api/auth/login { identifier, password }` for
  every account (username case-insensitive, or a legacy email); the old
  phone+code login is refused (`USE_PASSWORD`) once an account has a
  password, and passwordless phone accounts get `NO_PASSWORD` → "Forgot
  password". Forgot password: send-otp purpose `reset` → verify-code
  `reset` → `POST /api/auth/password-reset/phone { pass, password }` (single
  use: refused if `passwordChangedAt` is newer than the pass). Rules in
  `src/lib/identity/password.ts` (8+, a letter and a number, not the
  username). New User columns `passwordChangedAt`, `lastLoginAt`,
  `lastSeenAt` (migration `20261028120000_user_password_activity`; touched
  with raw SQL because the running dev server's Prisma client predated them —
  typed access is fine after a restart). `lastSeenAt` is written by
  `GET /api/auth/me` at most every 5 min. UI: `AuthForm` (Sign In with
  "Forgot password?", Create Account / Creator → code → password panel with
  strength meter + confirm). Tests: `tests/phone-auth.test.ts`.
  **Not done:** changing a password doesn't sign out other existing sessions
  (needs `passwordChangedAt` vs token `iat` in `getAuthUserFrom*`).
- **Control center `/control` (2026-10-28, owner)**: ADMIN/SUPER_ADMIN only
  (`src/lib/control/access.ts`; every `/api/control/**` route checks it);
  its own sign-in screen (username + password), no site chrome (AppShell
  immersive). The owner's account is made with
  `npx tsx scripts/create_control_admin.ts --username=<name>` (asks for the
  password, hidden; SUPER_ADMIN; re-run to reset). Pages: Overview (members,
  active 24h/7d from `lastSeenAt`, sign-ups chart, "Fix next" gaps, catalog,
  community, news — `src/lib/control/overview.ts`), Users (search/role/
  sort; never returns phone/email/password; role change = existing
  SUPER_ADMIN `PATCH /api/admin/users/:id/role`), Anime (add by AniList/MAL
  id via `syncEngine.ingestAnime`, no adult; edit title/synopsis/poster/
  banner/trailer), Creators, Characters, Studios (photo/logo). Edits go
  through `src/lib/control/editor.ts`: row + EditorialOverride (+
  AnimeMetadataHistory for anime); clearing removes the override. Images:
  https links or uploads (`POST /api/control/upload`, existing storage
  pipeline, `/uploads/...`). **Sync fix**: `syncEngine.ingestAnime` now also
  skips overridden poster/banner/trailer (it already skipped title/synopsis).
  News, reviews/reports, full studio editor, image health and data/sync are
  the older `/admin/*` tools, linked from the sidebar. Tests:
  `tests/control-center.test.ts`.
  **v2, same day (owner: "a completely new admin panel, in my Control
  Center folder")** — supersedes the paths above. ALL control-center code
  now lives in the repo-root folder **`Control Center/`** (`lib/`, `api/`,
  `ui/`, `ui/pages/`; see its README), imported as `@control/*` (tsconfig
  path). `src/app/control/**` pages and `src/app/api/control/**` routes are
  one-line re-exports into it (keep `export const dynamic` in the route file).
  Sidebar: Dashboard · Catalog (Anime, Creators, Characters, Studios) ·
  Editorial (Charts, OTAKUVA Choice, News, Articles, Collections) · People
  (Users) · More tools (old `/admin/*`). New:
  - *Dashboard* (`lib/dashboard.ts`): accounts active today/week/month vs not
    active 30+ days vs never seen; premiering in 60 days (AiringSchedule ep 1
    else startDate, with HYPED counts); on air now (`nextAiringAt`); most
    hyped / reviewed / rated.
  - *Anime form* (`lib/animeForm.ts`, `/control/anime/new|<id>`): every
    field the anime page shows (titles by language, synopsis, background,
    format, status, episodes, length, source, age rating, country, season,
    year, dates, broadcast, poster, banner, trailer, genres, themes, studios
    with main star, streaming links as source `EDITORIAL`, AniList/MAL ids).
    Manual anime = `externalSource 'manual'`. On existing anime each changed
    column gets an EditorialOverride + history row. **syncEngine now skips
    EVERY overridden field** (generic: deletes override keys from the update
    payload), not just title/synopsis/images.
  - *Charts* (`lib/charts.ts`, tables `CuratedChart`/`CuratedChartEntry`,
    migration `20261028150000_curated_charts_daily_picks`, plain SQL): Top
    10/25/50/100 with notes; published ones at `/charts` and
    `/charts/<slug>`. Slug `otakuva-choice`, once published with entries,
    replaces `src/lib/curated.ts`'s OTAKUVA_CHOICE in `getBrowseList('choice')`.
  - *Daily OTAKUVA Choice* (`lib/dailyPicks.ts`, table `DailyPick`): the
    homepage spotlight per UTC day (its note replaces the synopsis); no pick
    → the old rotation.
  - *News / Articles / Collections* (`lib/editorial.ts`): news via the
    existing `newsAdminService` (provider `INTERNAL`, `OTAKUVA_EDITORIAL`; the
    news page now shows the full text for INTERNAL stories and hides "Read
    original"), articles as `UserArticle` by the admin account (cover may be
    any https/uploaded image), collections as PUBLIC `UserList`s owned by the
    admin account (order + banner set directly).
  Tests: `tests/control-center-editorial.test.ts` (+ the v1 file).
  **Publish step**: `Control Center/lib/publish.ts` `refreshSite(animeKeys)`
  runs after every successful control-center write (automatically in
  `guarded()` for non-GET, and in the older handlers): revalidateTag for
  home sections / `studio-directory` / hype board / `platform-stats`,
  revalidatePath for the main pages, CacheManager tags `tag:anime:catalog`,
  `tag:news:list` (news list cache is now tagged) and `tag:anime:<id|slug>`,
  plus the studio-directory and genre-artwork in-memory caches. Header
  account menu shows **Control center** for `hasMinRole(role, 'ADMIN')`.
  Live-checked 2026-10-28 (create → public API/page/chart show it at once;
  test rows removed). Known: on a cold dev server the anime page's 11
  self-fetches can time out and render "not found" once — a reload fixes it.
  **Images fixed + analytics (2026-10-28, later)**:
  - *Why uploads looked broken*: `.env` has `STORAGE_PROVIDER=r2` and
    `MEDIA_PUBLIC_URL` = `https://media.otakuva.com`, a domain that doesn't
    resolve — files reached the bucket but every returned link was dead. Now
    (a) `DevR2WithLocalFallback` (dev only) also falls back to local
    `public/uploads` when the public address can't be reached (injectable
    check; `tests/storage-fallback.test.ts`), and (b) the control-center upload
    returns `resolveMediaUrl(url)` — bucket files come back as the existing
    `/api/media/<key>` relay, which works without the domain (production too).
    `/api/media/…` paths are accepted by `cleanImageUrl` and the studio pages.
    **Owner action before launch**: point media.otakuva.com at the R2 bucket
    (or set MEDIA_PUBLIC_URL to the bucket's public r2.dev URL) — member
    avatars/banners shown raw elsewhere depend on it.
  - *Image from a link*: `POST /api/control/upload { url, kind }` downloads
    and stores a copy (`Control Center/lib/remoteImage.ts`: http(s) only,
    DNS-checked against private/loopback ranges on every redirect hop, 15 MB,
    HTML pages get "copy image address" advice). ImageField: "Choose from
    computer" + "Use this link".
  - *Page views*: table `PageViewDaily(kind, entityId, day, views)` (migration
    `20261028180000_page_view_daily`; counts only, no user/IP), `POST
    /api/track/view` (bots/unknown kinds/bad ids ignored, rate-limited, always
    204), `ViewBeacon` (once per page per session) on anime, news, article,
    collection (/l/), chart, studio and person pages. Starts at zero on
    2026-10-28.
  - *Analytics* (`Control Center/lib/analytics.ts`, `ui/Charts.tsx` —
    server-rendered KPI tiles, daily bars, ranked bars; `?days=7|30|90`):
    `/control/analytics/anime|news|collections|members|community`. News
    opens come from existing EventLog `NEWS_OPENED`. Tests:
    `tests/control-analytics.test.ts`.
  - *Main desk / Platform* (`Control Center/lib/platform.ts`,
    `ui/pages/PlatformPages.tsx`): `/control/desk` (platform totals, admin
    alerts, latest activity), `/control/creators` (every CREATOR with
    followers, reviews, rated anime, hype, communities, articles, last seen),
    `/control/communities` (all communities + discussions, `?q=`),
    `/control/activity` (feed across all accounts, `?kind=`). Admin alerts:
    `src/lib/notifications/adminAlerts.ts` — Notification types
    `ADMIN_NEW_MEMBER` (register route) and `ADMIN_NEW_CREATOR`
    (`upgradeToCreator`) to every ADMIN/SUPER_ADMIN; best-effort.
- **Announced section + studio logos (2026-11-01, owner)**:
  - *Announced* = announced, not-yet-premiered anime, newest announcement
    first (AniList id desc — AniList creates the entry at announcement; manual
    anime added in the last 30 days lead). Excludes adult, music videos and
    "Not yet aired" rows whose exact premiere day has passed. Read model
    `src/lib/announcements/announcedAnime.ts` (`getAnnouncedAnime`, studio /
    format filters; premiere label only from stored precision; "Sequel to"
    from stored relations; latest CONFIRMED news; hype count). Shown on the
    homepage (`AnnouncedRail`, "Just Announced", before Upcoming — a front-page
    desk: one lead with art (AniList banner → trailer still → blurred poster)
    + a hairline list of the next 6; no boxed cards, owner 2026-11-01), `/announced`
    (lead story + format chips + load more; phone ⋯ menu link) and every
    studio page (section "Announced" + stat tile). API `GET /api/announced?
    limit=&offset=&format=&studio=`. UI in `src/components/announced/`.
  - *Sync* `src/lib/announcements/announcementSync.ts`: AniList
    `getRecentlyAnnouncedAnime` (NOT_YET_RELEASED, ID_DESC) → new titles via
    `ingestAnime` (studios linked, so they appear on the studio page),
    same-title+format+year held for review, stale (>24h) AniList copies
    refreshed, relations upserted, then news linked. One run at a time via a
    lease on SyncCheckpoint (`anilist`/`ANNOUNCEMENTS`). Runs itself
    (`ensureFreshAnnouncements`, every 3h, from /announced, the API and studio
    pages) — no Redis needed; manual: `npx tsx scripts/sync_announced_anime.ts
    [--pages= --max-new= --max-refresh=]`. Not a queue job yet.
  - *News linking is strict*: only announced anime, only a whole-title match
    in the headline, and NOT when followed by "Season 2", "Part", ":", a number
    etc. (that's another entry). Titles shared by another anime or shorter
    than 12 chars go to `NewsReviewQueue`. First run linked news to older
    franchise entries (e.g. S2 news on S1) — those 104 links + 27 queue rows
    were deleted and the rules above added. Tests: `tests/announced-anime.test.ts`.
  - *On Vercel*: background work after a response can be frozen, so a daily
    Vercel Cron (`vercel.json` → `GET /api/cron/announced`, 03:30 UTC, small
    caps to fit 60s) runs the sync. It needs `CRON_SECRET` in the Vercel
    project env (fails closed with 401 without it). The news linker does a
    handful of queries in total (not one per anime) because the Neon DB is in
    Singapore, far from the functions.
  - *Vercel production errors (diagnosed 2026-11-01)*: the "loads then
    errors" reports were the old Render Postgres ("service temporarily
    unavailable", "database system is starting up", P1017) and, earlier, a
    missing DATABASE_URL — both gone since the Neon switch (2026-10-31
    ~14:30 UTC). Still live then: `authRateLimiter` opened Redis to
    127.0.0.1 with no REDIS_URL (retry noise on every warm instance) — now
    skips Redis unless `isRedisConfigured()`; `enqueueSyncJob` throws a clear
    error instead. ANN news fetches fail from Vercel (feed unreachable there)
    — not fixed. Failed builds in the Vercel list are Dependabot branches,
    not main.
  - *Studio logos*: Wikidata wordmarks (`/brand/studios/…`) keep the white
    plate; any other logo (admin upload) fills the tile edge to edge
    (`isPlatedLogo` / `.logoFill` in `StudioLogo`). Control Center logo
    previews no longer use a white plate either.
- Real-world schedule spec: `docs/OTAKUVA_SCHEDULE_SPEC_v1.md` (AniList +
  AnimeSchedule.net dual-provider `ReleaseEvent` model, regional/sub/dub
  releases, delay tracking, admin conflict resolution). Not started.
  AnimeSchedule.net has zero existing integration (no adapter, no env
  vars) — would be a brand-new provider needing its own account/API
  access before any of §03/§06 can begin. The current schema's flat
  `AiringSchedule` model (BROADCAST-only, no region/platform/releaseType
  variety) is a much smaller stepping stone than the spec's full
  `ReleaseEvent`/`ScheduleChange` model — confirm scope with the owner
  before starting a schema migration this size.
- Responsive QA: `scripts/qa_responsive_overflow.mjs` (headless Chrome
  via CDP). Don't judge mobile layout from `chrome --screenshot
  --window-size` — headless windows have a ~500px minimum width.
- Not yet verified: object storage vs. local files for `MediaAsset`, search
  index vs. plain DB queries, backup/restore procedure.

See `docs/AUDIT_2026-09-11.md` for the full audit and root causes.

Treat this list as the actual Phase 10 (production hardening) backlog for
this repo — update it here as items get fixed instead of re-deriving it.

## Working style for this repo

- Inspect existing routes/schema/components before adding new ones — most
  requested features already have a partial implementation somewhere in
  `src/app/api/**`, `src/lib/**`, or `prisma/schema.prisma`.
- Extend the Prisma schema with migrations; don't hand-edit the database.
  Dev DB is PostgreSQL now (migrated from SQLite 2026-09-14 — see the
  Phase 10 backlog note above and `docs/production/RUNBOOK.md`); Postgres-only
  features (native `mode: 'insensitive'` string filters chief among them —
  see the case-sensitivity note above, `LATERAL`/window-function-heavy raw
  queries, etc.) are fair game now.
- Keep API responses versioned/stable (`/api/...` today; don't break
  existing route contracts casually).
- Match existing conventions: CSS Modules per component
  (`Component.module.css`), route handlers under `src/app/api/**/route.ts`,
  provider types prefixed `Provider*` in the interface files.
- Full original product vision — 85-section spec ("Master System /
  Implementation Prompt v3.0") covering product identity, canonical data
  ownership, the full entity/relationship model, UI/UX direction, Data
  Studio workflows, security, phased build order, etc. — is persisted at
  `docs/OTAKUVA_MASTER_SPEC_v3.md`. This file (CLAUDE.md) stays the short
  working reference for day-to-day rules; check the full spec when a
  section's detail is needed and isn't covered above.
