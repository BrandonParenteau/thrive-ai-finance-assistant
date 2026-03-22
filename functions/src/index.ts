import * as admin from "firebase-admin";

// Initialize Firebase Admin once at module load
if (!admin.apps.length) {
  admin.initializeApp();
}

export { chat } from "./chat";
export { plaidLinkToken, plaidLink, plaidExchangeToken, plaidSyncTransactions, plaidDone } from "./plaid";
export { revenuecatWebhook } from "./revenuecat";
export { netWorthSnapshot } from "./netWorthSnapshot";
export { scenarioSummary } from "./scenarioSummary";
export { parseStatement } from "./parseStatement";
