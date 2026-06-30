// Cloud Function (Gen2) — hard billing cutoff.
//
// Subscribed to the budget's Pub/Sub topic. When the budget notification says
// actual cost has reached/exceeded the budget amount, it DETACHES the billing
// account from the project, which stops ALL paid Google services on that
// project (Generative Language API included). This is the only true hard stop
// Google offers — budget "alerts" alone just email you.
//
// WARNING: detaching billing is project-wide and abrupt. Re-enable later by
// re-attaching a billing account in the Cloud Console. Keep this project
// single-purpose (just the Gemini key) so the cutoff has no collateral.
const functions = require("@google-cloud/functions-framework");
const { CloudBillingClient } = require("@google-cloud/billing");

const billing = new CloudBillingClient();

// Resolved at runtime from the function's environment.
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
const PROJECT_NAME = `projects/${PROJECT_ID}`;

functions.cloudEvent("stopBilling", async (cloudEvent) => {
  const raw = cloudEvent?.data?.message?.data;
  if (!raw) {
    console.log("No Pub/Sub message data; ignoring.");
    return;
  }
  const data = JSON.parse(Buffer.from(raw, "base64").toString());

  // costAmount / budgetAmount are in the budget's currency (INR here).
  const { costAmount, budgetAmount, budgetDisplayName } = data;
  if (!(costAmount >= budgetAmount)) {
    console.log(
      `[${budgetDisplayName}] cost ${costAmount} < budget ${budgetAmount}; no action.`,
    );
    return;
  }

  if (!(await isBillingEnabled(PROJECT_NAME))) {
    console.log("Billing already disabled; nothing to do.");
    return;
  }

  await disableBilling(PROJECT_NAME);
});

async function isBillingEnabled(projectName) {
  try {
    const [res] = await billing.getProjectBillingInfo({ name: projectName });
    return res.billingEnabled;
  } catch (e) {
    // Fail safe: if we can't read state, assume enabled so we still try to cut.
    console.error("getProjectBillingInfo failed; assuming enabled.", e);
    return true;
  }
}

async function disableBilling(projectName) {
  // Empty billingAccountName detaches the billing account → spend stops.
  const [res] = await billing.updateProjectBillingInfo({
    name: projectName,
    projectBillingInfo: { billingAccountName: "" },
  });
  console.log(`Billing DISABLED for ${projectName}:`, JSON.stringify(res));
}
