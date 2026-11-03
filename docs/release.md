# Production release runbook

Fastidious has one production environment on Cloudflare Workers. Run these steps from the repository root. Do not put production secrets, exported data, or access links in terminal output, commits, issue comments, or log searches.

## 1. Verify the release candidate

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run deploy -- --dry-run
FASTIDIOUS_WORKER=notifications npx cf deploy --dry-run
git diff --check
```

The checked-in `cloudflare.config.ts` falls back to a zero D1 placeholder so it cannot accidentally target a local or test database. Do not deploy until step 3 exports the production ID returned in step 2.

Rehearse all migrations against isolated local D1 state:

```bash
rm -rf .cloudflare/release-migration-rehearsal
npx cf d1 migrations apply 11111111-1111-4111-8111-111111111111 \
  --local \
  --persist-to .cloudflare/release-migration-rehearsal \
  --dir migrations
```

The UUID above names only the ignored local simulation. It must never be copied into `cloudflare.config.ts`.

## 2. Authenticate and create the production D1 database

```bash
npx cf auth login
npx cf d1 create --name fastidious --primary-location-hint enam
```

`enam` places the primary in eastern North America. Record the returned database ID in the release record; the ID is configuration, not a secret.

## 3. Bind the production database

Export the returned ID for every migration, dry run, and deployment command. `cloudflare.config.ts` reads `D1_DATABASE_ID` and otherwise keeps the non-deployable zero placeholder. Confirm the exported ID is neither the local rehearsal UUID nor a test resource.

Apply the checked-in migrations before either Worker is deployed:

```bash
export D1_DATABASE_ID='<production D1 database ID>'
npx cf d1 migrations apply "$D1_DATABASE_ID" --dir migrations
```

The command is remote unless `--local` is supplied. Confirm that `0001_initial.sql`, `0002_revoked_secrets.sql`, and `0003_web_push.sql` report as applied.

## 4. Generate production secrets

Set a monitored `mailto:` contact, then generate one VAPID P-256 key pair and a separate random digest pepper. The script writes ignored files and prints no values.

```bash
export VAPID_SUBJECT='mailto:operator@example.com'
node --input-type=module <<'NODE'
import { createECDH, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const subject = process.env.VAPID_SUBJECT;
if (!subject?.startsWith("mailto:")) throw new Error("Set VAPID_SUBJECT to a monitored mailto: address.");
const vapid = createECDH("prime256v1");
vapid.generateKeys();
const publicKey = vapid.getPublicKey(undefined, "uncompressed").toString("base64url");
const privateKey = vapid.getPrivateKey().toString("base64url");
const pepper = randomBytes(32).toString("base64url");
writeFileSync(".env.production-app", `SECRET_DIGEST_PEPPER=${pepper}\nVAPID_PUBLIC_KEY=${publicKey}\n`, { mode: 0o600 });
writeFileSync(".env.production-notifications", `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=${subject}\n`, { mode: 0o600 });
NODE
```

Never rotate `SECRET_DIGEST_PEPPER` independently: changing it invalidates every existing access link. Keep the ignored files only in an approved local secret store for the duration of the deployment, then delete them.

## 5. Deploy both Workers

Deploy with the secret files in the same operation so no public version runs without its required configuration:

```bash
D1_DATABASE_ID="$D1_DATABASE_ID" npx cf deploy --secrets-file .env.production-app
D1_DATABASE_ID="$D1_DATABASE_ID" FASTIDIOUS_WORKER=notifications npx cf deploy --secrets-file .env.production-notifications
rm .env.production-app .env.production-notifications
```

Record the generated `https://<deployment>.workers.dev` origin and both version IDs. Confirm in Cloudflare that both Workers bind the same production D1 database and that `fastidious-notifications` has these triggers:

- `* * * * *` — reminder delivery;
- `0 3 * * *` — expiration cleanup.

No local or test database identifier may appear in either deployed binding.

## 6. Production smoke and privacy checks

Use a new test log containing no real health data. Complete every row in [`release-checklist.md`](./release-checklist.md), including physical iOS/iPadOS and Android devices. Confirm manifest `start_url` and `scope` are `/` on the generated origin.

Tail only aggregate operational output. Never search for or paste an access link, authorization value, request body, fast timestamp, or weight:

```bash
npx wrangler tail fastidious --format pretty --status error
npx wrangler tail fastidious-notifications --format pretty
```

Leave the scheduled tail open through a minute boundary and the 03:00 UTC cleanup invocation (or inspect Workers dashboard invocation history). Expected scheduled entries contain aggregate counts, `success`, and `version`, never record IDs or payloads. Review Worker exception/request metrics and D1 rows read/written in the dashboard.

## 7. Roll back Worker code

List versions and deployments before changing traffic:

```bash
npx cf workers versions list --worker-id fastidious
npx cf workers versions list --worker-id fastidious-notifications
npx cf workers deployments list --worker fastidious
npx cf workers deployments list --worker fastidious-notifications
```

Promote a recorded previous compatible version to 100% traffic, one Worker at a time:

```bash
npx cf workers deployments create \
  --worker fastidious \
  --strategy percentage \
  --versions '[{"version_id":"<previous app version UUID>","percentage":100}]'

npx cf workers deployments create \
  --worker fastidious-notifications \
  --strategy percentage \
  --versions '[{"version_id":"<previous scheduled version UUID>","percentage":100}]'
```

Do not roll code back across an incompatible migration. Re-run the smoke checks after promotion.

## 8. Restore D1 with Time Travel

D1 Time Travel is the only server backup. A restore rewinds the entire database and can resurrect deleted or revoked data, so use it only for disaster recovery.

```bash
npx wrangler d1 time-travel info fastidious --remote
npx wrangler d1 time-travel info fastidious --timestamp='<UTC timestamp>' --remote
npx wrangler d1 time-travel restore fastidious --bookmark='<bookmark>' --remote
```

Before restore, disable both Workers or otherwise stop writes. Record deployed versions and the restore bookmark, perform the restore, redeploy compatible versions, then verify log open, sync, and scheduled work. Consult current Cloudflare documentation before a real incident because recovery flags can change.

## Free-tier launch estimate

Verify current Cloudflare limits on release day. At implementation time, Workers Free documents 100,000 requests/day; D1 Free documents 5 million rows read/day, 100,000 rows written/day, 5 GB storage, and seven days of Time Travel.

- Reminder cron: 1,440 invocations/day.
- Cleanup cron: 1 invocation/day.
- Scheduled total: 1,441 invocations/day, leaving 98,559 Worker requests/day before foreground traffic under the documented Workers request limit.
- Notification work is bounded to 25 due jobs per minute. Cleanup is bounded to 25 logs and 25 expired markers per day; backlog waits for a later run.
- Sync accepts at most 50 mutations and returns at most 500 journal changes. A normal active-fast mutation reads authentication/current-log state, mutation receipt state, and same-log fast state; it writes the record, receipt, revision/change journal, and at most two reminder jobs. A conservative 50-mutation batch therefore remains on the order of hundreds—not thousands—of D1 row reads/writes, plus at most 500 returned change rows.
- Starting or editing one active fast schedules at most two jobs. Ending it cancels those jobs. One opted-in subscription adds one delivery attempt per due job.
- Hashed static assets and the app shell are served through the asset binding/service-worker cache. Authenticated API responses use `no-store` and are never the service-worker data source.

At 1,000 worst-case full 50-mutation sync batches/day, the conservative write estimate can approach or exceed the 100,000-row daily D1 Free allowance. Treat sustained high batch volume or cleanup backlog as an operational capacity signal; do not reduce reminder correctness or silently drop mutations to stay under quota.
