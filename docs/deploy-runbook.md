# Deploy runbook

How Siumora is built, deployed, migrated, rolled back and restored. The
topology and the per-service secrets are in
[`plan/18-production-launch.md`](../plan/18-production-launch.md) §L2.1 and
§L2.4. Hosting is AWS Mumbai (ECS Fargate, RDS, ElastiCache) plus Vercel
(plan 18, D1). The infrastructure is Terraform in
[`infra/aws`](../infra/aws/README.md); the deploy is
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), which does
the steps below automatically — staging after every green CI on `main`,
production by hand with reviewer approval.

## What runs where

| Service | Artifact | Process | Health |
|---|---|---|---|
| Storefront | Vercel project, root `apps/web` | Next.js | `GET /` |
| Medusa server | `apps/medusa/Dockerfile` image | `MEDUSA_WORKER_MODE=server`, `npx medusa start` | `GET /health` on :9000 |
| Medusa worker | same image | `MEDUSA_WORKER_MODE=worker` | process alive (no HTTP check) |
| Outbox worker | `apps/worker/Dockerfile` image | `node --experimental-strip-types src/main.ts` | process alive |

Every container gets `APP_ENV` (`staging` or `production`). The images run
`NODE_ENV=production`, and Medusa refuses to boot with that and no `APP_ENV`.
CI's **Docker images build and boot** job builds both images and boots the
Medusa one against Postgres on every PR.

## Building the images

From the repository root:

```bash
docker build -f apps/medusa/Dockerfile -t <ECR_MEDUSA>:$(git rev-parse HEAD) .
docker build -f apps/worker/Dockerfile -t <ECR_WORKER>:$(git rev-parse HEAD) .
```

Tag with the full git SHA, never `latest`: the ECR repositories are
immutable, and a rollback names the tag it returns to. The deploy workflow
builds and pushes these itself.

## A deploy, in order

The order matters. The storefront prerenders product pages from Medusa at
build time, so Medusa must be up and current before the web build.

1. **Migrate.** One-off run of the new Medusa image against the target
   database (direct connection string, not the pooler):
   `docker run --rm --env-file <env> <medusa-image> npx medusa db:migrate`.
   If it fails, stop: nothing else has changed yet.
2. **Medusa server**, then **Medusa worker**, then **outbox worker** — a new
   task definition revision with the new image, then `aws ecs update-service`
   and `aws ecs wait services-stable`. The deployment circuit breaker rolls a
   service that cannot start back to its previous revision by itself.
3. **Storefront:** Vercel deploy of the same commit (production: promote).
4. **Smoke:**
   ```bash
   curl -fsS https://api.siumora.com/health
   curl -fsS https://api.siumora.com/store/siumora/config -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
   curl -fsS -o /dev/null -w "%{http_code}\n" https://siumora.com/
   curl -fsS -o /dev/null -w "%{http_code}\n" https://siumora.com/products/<a live handle>
   ```
5. Set `SENTRY_RELEASE` to the SHA on every service, so errors name the
   deploy.

## First deploy of an environment

After step 1, seed the store once — **never** `seed.ts` (the demo catalog)
on production:

```bash
docker run --rm --env-file <env> <medusa-image> npx medusa exec ./src/scripts/seed-store.ts
docker run --rm --env-file <env> <medusa-image> npx medusa exec ./src/scripts/seed-serviceability.ts
docker run --rm -it --env-file <env> <medusa-image> npx medusa user -e <owner email> -p <password>
```

`seed-store.ts` prints the publishable key: that is the storefront's
`MEDUSA_PUBLISHABLE_KEY`. The owner then signs in at `/app`, enrols MFA, and
enters provider credentials under Settings → Integrations.

## Rolling back

Fastest first:

1. **Payments kill-switch** — stops new money in seconds, no deploy
   ([incident-runbook.md](incident-runbook.md)).
2. **`SITE_PHASE=coming-soon`** on the storefront and redeploy — closes the
   shop behind the coming-soon page.
3. **Previous version:** Vercel instant rollback for the storefront. For the
   containers, Actions → Deploy → Run workflow at the previous good commit,
   or by hand: `aws ecs update-service --cluster siumora-<env> --service
   <service> --task-definition <family>:<previous revision>` for each of the
   three services.
4. **Restore the database** — only for data corruption, below.

**Migrations are forward-only.** A rollback to an older image runs against
the newer schema; Medusa's migrations are additive, so that works. Never run
a down-migration on production. A migration that must be undone ships as a
new forward migration.

## Restoring the database

Point-in-time recovery is on (plan 18 L2.6) and a nightly `pg_dump` lands
in a separate R2 bucket for 30 days.

1. Pull the kill-switch and set `SITE_PHASE=coming-soon`.
2. Restore to a **new** database at the chosen time — never over the live
   one: `aws rds restore-db-instance-to-point-in-time
   --source-db-instance-identifier siumora-<env> --target-db-instance-identifier
   siumora-<env>-restore --restore-time <UTC time>` (same subnet group and
   security group).
3. Boot one Medusa server against it with `APP_ENV=staging` and check:
   recent orders, the GST invoice series (`gst-recon` on demand), the audit
   log.
4. Repoint `MEDUSA_DATABASE_URL` in the `siumora-<env>/generated` secret to
   it, force a new deployment of all three services, smoke, reopen. Then
   bring Terraform in line (import the restored instance or rename) before
   the next apply.

Record how long the staging drill took here: **(not yet run)**.

## Rotating a secret

| Secret | Effect of rotating |
|---|---|
| `JWT_SECRET`, `COOKIE_SECRET` | Every dashboard and Medusa auth session ends. |
| `SIUMORA_TOKEN_SECRET` | Signed links (email verification, cart resume) stop working. |
| `CLIENT_IP_SECRET` | Must change on the storefront and Medusa **together**, or rate limits key on the storefront's address. |
| `SETTINGS_ENCRYPTION_KEY` | **Do not rotate casually**: every saved provider credential becomes unreadable and must be re-entered in Settings → Integrations. |
| Provider keys (Razorpay, Shiprocket, BSP) | Re-enter in Settings → Integrations; no restart. |

Rotate quarterly (plan 11). Keep `SETTINGS_ENCRYPTION_KEY` and the database
credentials in the founder's password manager as the offline copy.
