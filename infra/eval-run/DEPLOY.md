# Deploy the eval Cloud Run service

Hosts the single long-running `gemini-3.1-pro` evaluation call. Vercel Hobby
kills any function at 60s, but a full marking pass takes minutes — so it lived
on Vercel only to time out (504 → "Server timed out") while still burning a
daily credit. This service runs it with a 300s request timeout instead. The
browser calls it directly; transcription/extraction stay on Vercel.

It is a faithful port of `app/api/evaluate/route.ts` (same auth, same spend cap),
plus CORS and a refund-on-failure so a timeout no longer eats the daily 3.

## 0. Prereqs

- `gcloud` installed + logged in: `gcloud auth login`
- Same GCP project that holds the Gemini key.

```bash
export PROJECT_ID="your-project-id"
export REGION="asia-south1"        # Mumbai
export SERVICE="cse-eval-run"
gcloud config set project "$PROJECT_ID"
```

## 1. Build, then deploy (run from the REPO ROOT — the build bundles ../../lib + ships data/exemplars)

`gcloud run deploy --source` only auto-detects a Dockerfile at the source root,
and ours is in this subdir, so build the image first with Cloud Build (which
takes an explicit Dockerfile path via the config), then deploy that image.

```bash
export IMAGE="gcr.io/$PROJECT_ID/$SERVICE"

# Build from repo root context using infra/eval-run/Dockerfile.
gcloud builds submit --config infra/eval-run/cloudbuild.yaml \
  --substitutions=_IMAGE="$IMAGE" .

# Deploy the built image.
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --timeout 300 \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 3
```

`--allow-unauthenticated` only opens the HTTP endpoint; the app still enforces
`requireUser` (Supabase JWT + `ALLOWED_EMAILS`) and the hard spend cap, exactly
like the Vercel route did.

## 2. Set env vars (same values as Vercel, plus two)

```bash
gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars \
"GEMINI_API_KEY=...,\
NEXT_PUBLIC_SUPABASE_URL=https://uopdsonmsqujgfleoqzz.supabase.co,\
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...,\
ALLOWED_EMAILS=vigneshanil1297@gmail.com,\
ALLOWED_ORIGIN=https://upsc-study-partner.vercel.app,\
RETRY_BUDGET_MS=200000"
```

- `ALLOWED_ORIGIN` — the Vercel site, for CORS. Must match exactly (scheme + host,
  no trailing slash).
- `RETRY_BUDGET_MS` — lets the Gemini retry loop use the longer budget Cloud Run
  allows (defaults to 45s, tuned for Vercel; see `lib/gemini.ts`).
- `NODE_ENV=production` is baked into the image, so `llmProvider()` picks the
  Gemini backend (not the local `claude` CLI).

## 3. Point the frontend at it

Grab the service URL:

```bash
gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)'
# e.g. https://cse-eval-run-xxxxxxxx-el.a.run.app
```

In Vercel → project → Settings → Environment Variables, add:

```
NEXT_PUBLIC_EVAL_URL = https://cse-eval-run-xxxxxxxx-el.a.run.app
```

(no `/evaluate` suffix — the client appends it). Redeploy Vercel so the new
public env var is baked into the client bundle. With it unset (local dev), the
app falls back to `/api/evaluate` (the `claude` CLI path, no 60s limit).

## 4. Run the budget SQL (once)

`data/eval-budget.sql` now also defines `refund_eval_credit`. Re-run the file
(or just the new function block) in the Supabase SQL editor for project
`uopdsonmsqujgfleoqzz`.

## 5. Smoke test

```bash
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
curl -s "$URL/"                         # -> "eval-run ok"
curl -s -X POST "$URL/evaluate" -H 'content-type: application/json' -d '{}'
# -> 401 {"error":"Not authorized."}  (no Bearer token) — auth guard is live
```

Then run a real evaluation from the deployed site and confirm it returns instead
of timing out.
