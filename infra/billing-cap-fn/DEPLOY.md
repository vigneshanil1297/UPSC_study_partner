# Deploy the billing-cutoff Cloud Function

This subscribes a Gen2 Cloud Function to the budget's Pub/Sub topic
(`billing-cap`) and detaches billing when actual cost ≥ budget amount.

## 0. Prereqs

- `gcloud` installed + logged in: `gcloud auth login`
- You know your GCP **project id** (the one holding the Gemini key) and your
  **billing account id** (Billing → Account management, format `0X0X0X-0X0X0X-0X0X0X`).
- The budget already publishes to a Pub/Sub topic named `billing-cap`
  (Billing → Budgets & alerts → your budget → Manage notifications).

```bash
# Fill these in:
export PROJECT_ID="your-project-id"
export BILLING_ACCOUNT="0X0X0X-0X0X0X-0X0X0X"
export REGION="asia-south1"          # Mumbai; any region is fine
export TOPIC="billing-cap"

gcloud config set project "$PROJECT_ID"
```

## 1. Enable the APIs the function needs

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  pubsub.googleapis.com \
  cloudbilling.googleapis.com \
  --project "$PROJECT_ID"
```

## 2. Deploy (run from this directory: infra/billing-cap-fn)

```bash
gcloud functions deploy billing-cap \
  --gen2 \
  --runtime nodejs22 \
  --region "$REGION" \
  --source . \
  --entry-point stopBilling \
  --trigger-topic "$TOPIC" \
  --project "$PROJECT_ID"
```

## 3. Grant the function permission to disable billing

The function's runtime service account must be able to change billing on the
project. Disabling billing requires the **Billing Account Administrator** role
on the billing account.

```bash
# Find the runtime service account the deploy used:
export SA=$(gcloud functions describe billing-cap --gen2 --region "$REGION" \
  --project "$PROJECT_ID" --format='value(serviceConfig.serviceAccountEmail)')
echo "Runtime SA: $SA"

# Grant it admin on the billing account:
gcloud billing accounts add-iam-policy-binding "$BILLING_ACCOUNT" \
  --member="serviceAccount:$SA" \
  --role="roles/billing.admin"
```

> This is a broad role. The SA is dedicated to this function; don't reuse it
> elsewhere. To narrow scope you can use the default compute SA or create a
> dedicated one with `--service-account` on deploy.

## 4. Test without spending real money

Publish a fake "over budget" notification to the topic:

```bash
gcloud pubsub topics publish "$TOPIC" --project "$PROJECT_ID" \
  --message='{"budgetDisplayName":"test","costAmount":9999,"budgetAmount":1900,"currencyCode":"INR"}'
```

Then check logs — it should report "Billing DISABLED":

```bash
gcloud functions logs read billing-cap --gen2 --region "$REGION" \
  --project "$PROJECT_ID" --limit 20
```

**If the test actually disables billing**, re-enable it:
Console → Billing → (project) → "Link a billing account" → re-attach.
(Or run the test only when you're ready to verify for real.)

## Notes

- Detaching billing is **project-wide** — every paid service on the project
  stops, not just Gemini. Keep this project single-purpose.
- Lag is a few minutes between hitting the budget and the cutoff firing
  (budget data + Pub/Sub propagation). Set the budget below your true ceiling
  (e.g. ₹1900 for a ₹2200 hard limit, leaving room for in-flight + 18% GST).
- Budget amounts in the notification are in your billing currency (INR).
