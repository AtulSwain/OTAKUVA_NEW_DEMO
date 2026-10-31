# OTAKUVA — Deployment & Rollback Guide

A deploy is: **staging first → smoke test staging → production → smoke test
production**, with an explicit, rehearsed rollback path if either smoke
test fails. Nothing here skips CI (`docs/production/RUNBOOK.md` §9) —
this picks up after CI is green on the commit being deployed.

Two things this doc is deliberately honest about, because getting them
wrong at 2am is how a bad deploy becomes a data-loss incident:

- **`RollbackManager` (`src/lib/production/rollbackManager.ts`) does not
  redeploy anything.** It's an in-memory, process-local pointer plus a
  cache/circuit-breaker reset and an audit-log entry — useful for the
  admin dashboard and for the "what version is live" question, and it
  resets to hardcoded defaults on process restart. The actual code
  rollback (§7.1 below) happens at your hosting/infra layer by redeploying
  a previous build artifact. Call `RollbackManager.executeRollback()` as
  *part of* that process for cache hygiene and the audit trail, not as a
  substitute for it.
- **`BackupManager.createBackupSnapshot()` (`src/lib/production/
  backupManager.ts`) is not a database backup.** It samples up to 50 rows
  per entity across 7 tables into an in-memory JSON payload for the admin
  dashboard/launch scorecard — it doesn't persist anywhere and would lose
  the overwhelming majority of a real catalog. The real backup this
  doc relies on is a full `pg_dump` (or your managed Postgres provider's
  own snapshot feature) — see §2 and §7.2. `docs/production/
  DISASTER_RECOVERY.md` describes the target RPO/RTO (1 hour / 15
  minutes) and references `BackupManager` for the same reason this doc
  flags it here — treat those as objectives to meet with real
  infrastructure, not as a description of something `BackupManager`
  already does today.

---

## 1. Prerequisites (before you start)

- [ ] For Vercel, configure the production runtime environment before
      promoting a deployment. In particular, `DATABASE_URL` must point to
      the production PostgreSQL database; the build can compile without it,
      but the site cannot serve database-backed pages or sign-ins. Keep
      secrets in Vercel's Environment Variables, not in GitHub or source.
      After deployment, verify `GET /api/health/ready` returns `HEALTHY`.
- [ ] When deploying a Prisma schema change, take the required database
      backup and apply checked-in migrations with `npx prisma migrate deploy`
      before the new app version depends on them. `prisma generate` creates
      the client but does not apply schema migrations.
- [ ] CI is green on the exact commit being deployed: typecheck, lint,
      and `npm test` all pass (`.github/workflows/ci.yml`'s `test` job —
      see RUNBOOK §9). Don't deploy a commit CI hasn't run against.
- [ ] The build artifact for this commit is identified and addressable —
      a container image tag, a platform deployment id, or at minimum the
      commit SHA if your host redeploys straight from git. Write it down
      now; it's what you redeploy in §7.1 if this goes wrong. If your
      pipeline rebuilds from source on rollback instead of redeploying a
      stored artifact, confirm that rebuild is deterministic (pinned
      lockfile, no floating dependency versions) — otherwise "roll back"
      can silently ship different code than what was actually live before.
- [ ] Migration plan reviewed against the expand → migrate → contract
      rule (`CLAUDE.md`): does this release's migration only *add*
      (nullable columns, new tables, new indexes)? If yes, skip to the
      next box — an additive migration needs no down-migration because
      the previous code artifact still runs correctly against the
      expanded schema, which is exactly why expand-first is the default.
      If the migration also *removes or narrows* something (drop/rename a
      column, tighten a NOT NULL, drop a table) — that's a contract step.
      Contract steps ship in their own release, at least one deploy after
      the expand step has been live and healthy, and this box isn't
      checked until a tested down-migration SQL file exists for it (see
      §7.2). Never ship expand and contract in the same migration.
- [ ] A fresh, real database backup exists immediately before any
      migration runs — `pg_dump` against the target database, or your
      managed Postgres provider's snapshot, taken and confirmed
      successful in this session (not "there's probably one from last
      night"). Store it somewhere reachable during the deploy window.
- [ ] Redis (`REDIS_URL`) and the worker process (`scripts/worker.ts` /
      `npm run worker`) are accounted for in the deploy plan — a code
      deploy that doesn't also restart the worker leaves it running old
      job-handler code against a new schema, which is its own source of
      incidents. Restart both together.

---

## 2. Environment topology: staging must mirror production

Smoke tests on staging are only meaningful if staging fails the same way
production would. Concretely, staging needs its own instances of
everything production depends on — not sqlite, not "no Redis configured,"
not a shared database with production:

| Component | Requirement |
| :--- | :--- |
| **Postgres** | Its own database, same major version as production, migrated the same way (`prisma migrate deploy`, never `db push` — `db push` is for local dev and the test suite only, see RUNBOOK §7.3). Never point staging's `DATABASE_URL` at the production database. |
| **Redis** | Its own instance, reachable via staging's `REDIS_URL`, with staging's own `npm run worker` process consuming `otakuva-sync`. Without this, `sync:airing`/`news-sync`/`episode-backfill` and anything enqueued by an admin action during the smoke test (§4.4) silently never runs, and staging tells you nothing about whether the queue actually works. |
| **Object storage** | `STORAGE_PROVIDER=r2` with its own bucket (or `local` with its own upload dir) — never staging writing into the production media bucket. |
| **Secrets** | Staging's own `AUTH_SECRET` (so staging JWTs are never valid against production and vice versa), its own `OTAKUVA_SUPER_ADMIN_EMAILS` bootstrap list. |
| **Error tracking** | `SENTRY_ENVIRONMENT` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` set to `staging`, so staging noise doesn't pollute the production Sentry project/alerts. |
| **External providers** | Fine to share (AniList/Jikan are read-only third-party APIs) — `ANILOG_PROVIDER`/`PREFERRED_PROVIDER` can match production so provider-selection bugs show up in staging too. |

If any row in that table doesn't hold, treat staging as unable to clear a
production deploy until it's fixed — a smoke test against a topology
production doesn't have is a false signal, not a safety net.

---

## 3. Step 1 — Deploy to staging

1. Confirm §1's checklist is complete for this commit.
2. Take the pre-migration backup against **staging's** database (this
   rehearses exactly what §5 does against production — if this step is
   awkward or slow here, fix that now, not during the real deploy).
3. Apply migrations: `DATABASE_URL=<staging URL> npx prisma migrate
   deploy`.
4. Build the artifact (`npm run build`, or your CI/CD pipeline's
   equivalent) and record its identifier per §1.
5. Deploy the artifact to staging infrastructure.
6. Restart the staging worker process against the same artifact/commit.
7. Poll `GET /api/health/ready` on staging until it returns `HEALTHY`
   (HTTP 200) — don't treat a single check as sufficient; give it a
   minute or two to settle, and if it's still `UNHEALTHY`
   (`503`) after that, stop here and investigate rather than proceeding
   to smoke tests against a database it can't even reach.

---

## 4. Step 2 — Smoke test staging

Run all three checks. All three must pass before touching production. If
any fails, stop — fix forward on staging (or roll staging back the same
way §7 describes for production) and re-run this section from the top.
Don't promote a build to production that hasn't cleared this.

### 4.1 Health check

```bash
curl -sf https://staging.<your-domain>/api/health/ready | tee /tmp/health.json
```
Expect HTTP 200 and `"status": "HEALTHY"`, with `subsystems.database.status
== "HEALTHY"`. A `503`/`"UNHEALTHY"` here means don't go further —
`HealthService.getReadiness()` (`src/lib/reliability/healthService.ts`)
is a real live check (`SELECT 1` against Postgres plus memory pressure),
not a static placeholder.

### 4.2 Login

Use a dedicated, long-lived smoke-test account (create it once, e.g.
`smoke-test@otakuva-ops.internal`; never a real user's account, and never
create a fresh throwaway account per run — that's exactly the kind of
fixture accumulation `CLAUDE.md`'s cleanup history warns about). Its email
must be verified (`User.emailVerifiedAt` set) ahead of time — the write
path in §4.3 goes through `requireVerifiedUser()`
(`src/lib/auth.ts`), so an unverified smoke-test account gets a 403
`EMAIL_NOT_VERIFIED` that has nothing to do with whether the deploy
actually works:

```bash
curl -sf -c /tmp/cookies.txt -X POST https://staging.<your-domain>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"smoke-test@otakuva-ops.internal","password":"<from secret manager>"}' \
  | tee /tmp/login.json
```
Expect HTTP 200, a `token` in the response body, and `anilog_token` set in
`/tmp/cookies.txt`. A 401 here means either the deploy broke auth or the
smoke-test account's credentials drifted — both are worth knowing before
production.

### 4.3 One write path

Rate an existing, already-catalogued anime as the smoke-test account, then
immediately clean up — this must leave no residue, the same way it must
never create fixture anime/studio rows (`CLAUDE.md` rule 4):

```bash
# Pick a stable, already-existing anime id/slug for this environment and
# reuse it every run rather than picking a new one each time.
ANIME_ID=<a real anime id or slug that exists in this environment>

curl -sf -b /tmp/cookies.txt -X POST \
  https://staging.<your-domain>/api/anime/$ANIME_ID/rating \
  -H 'Content-Type: application/json' \
  -d '{"score": 7.5}' | tee /tmp/rate.json
# Expect HTTP 200 and the rating reflected back.

curl -sf -b /tmp/cookies.txt https://staging.<your-domain>/api/anime/$ANIME_ID/rating-summary \
  | tee /tmp/summary.json
# Expect ratingCount/rawAverage to have moved — confirms the write landed
# *and* recalculateAnimeAggregates() ran (src/lib/rating/ratingService.ts).

curl -sf -b /tmp/cookies.txt -X DELETE \
  https://staging.<your-domain>/api/anime/$ANIME_ID/rating
# Cleanup — leaves the smoke-test account with no lingering rating.
```

This exercises the full write path: auth middleware, the mutating route,
the DB transaction, and the aggregate recompute — not just "the server
returned 200."

### 4.4 Optional but recommended: queue health

If this release touches anything in `src/lib/queue/**`, confirm the
worker actually picked up a job rather than just that Redis accepted the
enqueue: trigger `POST /api/admin/sync` (as an admin account with
sufficient role) for a small, known-cheap target and watch its `SyncJob`
row move `PENDING → RUNNING → COMPLETED` via `GET /api/admin/datacenter`
(or `/api/admin/data`) within a reasonable window. A job stuck at
`PENDING` means the worker isn't running against this deploy — see
RUNBOOK §6.

---

## 5. Step 3 — Deploy to production

Only after §4 is fully green. Promote the **same build artifact** that
passed staging rather than rebuilding from source again — rebuilding
risks picking up a dependency update or environment difference between
the two builds, defeating the point of having tested staging at all.

1. Confirm §4's staging smoke tests all passed on this artifact.
2. Take the pre-migration backup against **production's** database
   (real `pg_dump`/managed snapshot — see the note at the top of this
   doc). Confirm it completed and is retrievable before proceeding —
   this is the backup §7.2 falls back to if a contract migration needs
   reverting and no down-migration exists.
3. Apply migrations: `DATABASE_URL=<production URL> npx prisma migrate
   deploy`.
4. Deploy the same artifact from §4 to production infrastructure.
5. Restart the production worker process against the same artifact.
6. Poll `GET /api/health/ready` on production until `HEALTHY`, same as
   §3 step 7.

---

## 6. Step 4 — Smoke test production

Run the same three checks as §4 (4.1–4.3), against the production URL,
using a **separate** dedicated production smoke-test account (never reuse
staging credentials against production, and never use a real user's
account). If §4.4 applied, repeat it here too.

**If any production smoke test fails, this deploy is not done — proceed
immediately to §7 (Rollback) below.** Don't leave a partially-verified
deploy live while you debug; roll back first, then investigate against
staging.

---

## 7. Rollback (triggered by a failed post-deploy smoke test)

Rollback has two independent parts. Do both, in this order — application
first, because it's fast and safe; schema second, because it's slower and
only sometimes necessary.

### 7.1 Application rollback (previous build artifact)

1. Redeploy the previous artifact — the one identified in §1, that was
   live and passed its own smoke tests before this deploy — at your
   hosting/infra layer. This is the actual code rollback; it does not
   happen automatically and nothing in this codebase does it for you.
2. Restart the worker process against that same previous artifact.
3. Call `RollbackManager.executeRollback(reason, actorId)` (or the admin
   UI action backed by it) once the previous artifact is actually live —
   this purges `CacheManager`'s stale entries, resets circuit breakers,
   and writes the audit log entry your incident review will want. It's a
   cleanup/record-keeping step here, not the rollback mechanism itself
   (see the note at the top of this doc).
4. Poll `GET /api/health/ready` until `HEALTHY` again.
5. Re-run the §6 smoke tests against the rolled-back deployment. If they
   still fail, the problem isn't the new code — escalate as an
   infrastructure/database incident rather than continuing to toggle
   deploys.

### 7.2 Migration-down plan

Which path applies depends on what §5 step 3 actually ran:

- **The migration was additive only (the common case, per §1's
  expand-first rule):** no schema action needed. The rolled-back
  application artifact from §7.1 runs correctly against the expanded
  schema — new columns/tables it doesn't reference are simply unused.
  This is the entire reason expand-first migrations are the default:
  most rollbacks never need to touch the database at all.
- **The migration included a contract step, and a tested down-migration
  exists (required by §1 before this deploy was allowed to proceed):**
  apply that prepared down-migration SQL against production now. Prisma
  does not auto-generate down migrations and `prisma migrate deploy` is
  forward-only — the down-migration is a file someone wrote and ran
  against staging before this release shipped, not something generated
  on the fly during an incident.
- **A contract migration ran without a prepared down-migration (a
  process failure — §1 should have caught this before deploy) or the
  change is genuinely irreversible (e.g. a destructive backfill):**
  restore from the pre-migration backup taken in §5 step 2. This is
  slower and costs everything written to production between that backup
  and now (the RPO gap) — accept that cost consciously rather than
  attempting to hand-write a corrective migration under incident
  pressure. Restoring a real Postgres backup is what `docs/production/
  DISASTER_RECOVERY.md`'s 1-hour RPO / 15-minute RTO targets are actually
  measuring; treat those as the bar to hit with real infrastructure
  (frequent `pg_dump`/managed snapshots, tested restores), not as
  something `BackupManager.createBackupSnapshot()` already delivers.

### 7.3 After rollback

1. Confirm `GET /api/health/ready` is `HEALTHY` and the §6 smoke tests
   pass against the rolled-back state.
2. File an incident note: what failed, which smoke test caught it, what
   was rolled back, and whether a database restore was needed.
3. Fix the root cause and re-verify the *entire* checklist from §1 on
   staging — a fixed build re-enters this process at the top, it doesn't
   skip back to production.
