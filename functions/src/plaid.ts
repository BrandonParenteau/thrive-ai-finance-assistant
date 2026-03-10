import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import {
  PlaidApi,
  PlaidEnvironments,
  Configuration,
  Products,
  CountryCode,
} from "plaid";

// ── Config from environment (set in functions/.env) ───────────────────────────

function getPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) throw new Error("PLAID_CLIENT_ID or PLAID_SECRET not set");
  return makePlaidClient(clientId, secret);
}

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY not set");
  return key;
}

// ── Plaid client factory (created per-request so secrets are available) ───────

function makePlaidClient(clientId: string, secret: string): PlaidApi {
  const env = (process.env.PLAID_ENV || "sandbox").trim().toLowerCase();
  const config = new Configuration({
    basePath:
      PlaidEnvironments[env as keyof typeof PlaidEnvironments] ||
      PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });
  return new PlaidApi(config);
}

// ── Encryption (AES-256-GCM) ──────────────────────────────────────────────────

function encrypt(text: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
}

function decrypt(data: string, keyHex: string): string {
  const [ivHex, encHex, tagHex] = data.split(":");
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

// ── Category / type helpers ───────────────────────────────────────────────────

function mapPlaidType(type: string, subtype: string | null | undefined): string {
  if (type === "credit") return "credit";
  if (subtype === "tfsa") return "tfsa";
  if (subtype === "rrsp") return "rrsp";
  if (subtype === "savings") return "savings";
  if (subtype === "checking") return "chequing";
  if (type === "investment") return "investment";
  return "chequing";
}

function typeColor(type: string): string {
  const colors: Record<string, string> = {
    chequing: "#00D4A0",
    savings: "#F5C842",
    tfsa: "#32C86E",
    rrsp: "#6EDDA0",
    fhsa: "#4FC3F7",
    resp: "#CE93D8",
    investment: "#FFB74D",
    credit: "#FF5252",
  };
  return colors[type] || "#00D4A0";
}

function mapPlaidCategory(primary: string, detailed?: string): string {
  if (detailed) {
    const detailedMap: Record<string, string> = {
      FOOD_AND_DRINK_BEER_WINE_LIQUOR: "Dining",
      FOOD_AND_DRINK_COFFEE: "Dining",
      FOOD_AND_DRINK_FAST_FOOD: "Dining",
      FOOD_AND_DRINK_GROCERIES: "Groceries",
      FOOD_AND_DRINK_RESTAURANT: "Dining",
      FOOD_AND_DRINK_VENDING_MACHINES: "Dining",
      TRANSPORTATION_GAS: "Transport",
      TRANSPORTATION_PARKING: "Transport",
      TRANSPORTATION_PUBLIC_TRANSIT: "Transport",
      TRANSPORTATION_TAXIS: "Transport",
      TRANSPORTATION_RIDE_SHARE: "Transport",
      TRANSPORTATION_CAR_SERVICE: "Transport",
      GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: "Shopping",
      GENERAL_MERCHANDISE_DEPARTMENT_STORES: "Shopping",
      GENERAL_MERCHANDISE_DISCOUNT_STORES: "Shopping",
      GENERAL_MERCHANDISE_ELECTRONICS: "Shopping",
      GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: "Shopping",
      GENERAL_MERCHANDISE_PET_SUPPLIES: "Shopping",
      GENERAL_MERCHANDISE_SPORTING_GOODS: "Health",
      GENERAL_MERCHANDISE_SUPERSTORES: "Shopping",
      MEDICAL_DOCTOR_VISITS: "Health",
      MEDICAL_DENTIST: "Health",
      MEDICAL_EYE_CARE: "Health",
      MEDICAL_PHARMACY: "Health",
      MEDICAL_VETERINARY: "Health",
      PERSONAL_CARE_HAIR_SALONS: "Personal Care",
      PERSONAL_CARE_GYMS_AND_FITNESS: "Health",
      PERSONAL_CARE_SPA_AND_MASSAGE: "Personal Care",
      ENTERTAINMENT_CASINOS_AND_GAMBLING: "Entertainment",
      ENTERTAINMENT_MUSIC_AND_AUDIO: "Subscriptions",
      ENTERTAINMENT_SPORTING_EVENTS: "Entertainment",
      ENTERTAINMENT_TV_AND_MOVIES: "Subscriptions",
      ENTERTAINMENT_VIDEO_GAMES: "Entertainment",
      RENT_AND_UTILITIES_ELECTRICITY: "Utilities",
      RENT_AND_UTILITIES_GAS: "Utilities",
      RENT_AND_UTILITIES_INTERNET_AND_CABLE: "Utilities",
      RENT_AND_UTILITIES_TELEPHONE: "Utilities",
      RENT_AND_UTILITIES_WATER: "Utilities",
      RENT_AND_UTILITIES_RENT: "Housing",
      HOME_IMPROVEMENT_FURNITURE: "Shopping",
      HOME_IMPROVEMENT_HARDWARE: "Shopping",
      HOME_IMPROVEMENT_HOME_SERVICES: "Housing",
      INCOME_DIVIDENDS: "Income",
      INCOME_INTEREST_EARNED: "Income",
      INCOME_RETIREMENT_PENSION: "Income",
      INCOME_TAX_REFUND: "Income",
      INCOME_WAGES: "Income",
      INCOME_OTHER_INCOME: "Income",
      TRANSFER_IN_CASH_ADVANCES_AND_LOANS: "Income",
      TRANSFER_IN_DEPOSIT: "Income",
      TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS: "Savings",
      TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: "Savings",
      LOAN_PAYMENTS_CAR_PAYMENT: "Transport",
      LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: "Other",
      LOAN_PAYMENTS_MORTGAGE_PAYMENT: "Housing",
      LOAN_PAYMENTS_STUDENT_LOAN: "Other",
      INSURANCE_AUTO_INSURANCE: "Other",
      INSURANCE_HEALTH_INSURANCE: "Health",
      INSURANCE_HOME_INSURANCE: "Housing",
      INSURANCE_LIFE_INSURANCE: "Other",
      TRAVEL_FLIGHTS: "Travel",
      TRAVEL_HOTELS_AND_MOTELS: "Travel",
      TRAVEL_RENTAL_CARS: "Travel",
      TRAVEL_VACATION_RENTALS: "Travel",
      EDUCATION_COLLEGE_TUITION: "Other",
      EDUCATION_BOOKS_AND_SUPPLIES: "Other",
    };
    const key = detailed.toUpperCase().replace(/ /g, "_");
    if (detailedMap[key]) return detailedMap[key];
  }

  const primaryMap: Record<string, string> = {
    FOOD_AND_DRINK: "Dining",
    GENERAL_MERCHANDISE: "Shopping",
    TRANSPORTATION: "Transport",
    MEDICAL: "Health",
    PERSONAL_CARE: "Personal Care",
    ENTERTAINMENT: "Entertainment",
    RENT_AND_UTILITIES: "Utilities",
    HOME_IMPROVEMENT: "Housing",
    INCOME: "Income",
    TRANSFER_IN: "Income",
    TRANSFER_OUT: "Savings",
    LOAN_PAYMENTS: "Other",
    INSURANCE: "Other",
    TRAVEL: "Travel",
    EDUCATION: "Other",
    GOVERNMENT_AND_NON_PROFIT: "Other",
    BANK_FEES: "Other",
  };

  return primaryMap[primary.toUpperCase()] || "Other";
}

// ── CORS helper ───────────────────────────────────────────────────────────────

function setCors(res: any) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
}

// ── Functions base URL (for embedding in HTML pages) ─────────────────────────

function getFunctionsBase(): string {
  // GCLOUD_PROJECT is auto-set in Cloud Functions
  const project = process.env.GCLOUD_PROJECT || "fortifyai";
  return `https://us-central1-${project}.cloudfunctions.net`;
}

// ── plaidLinkToken ────────────────────────────────────────────────────────────
// POST — requires Firebase auth. Returns a session_token for use with plaidLink.

export const plaidLinkToken = onRequest(
  {
    region: "us-central1",
    cors: false,
  },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    // Verify Firebase auth
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    let uid: string;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    try {
      const plaid = getPlaidClient();
      const redirectUri = process.env.PLAID_REDIRECT_URI || undefined;

      const linkResp = await plaid.linkTokenCreate({
        user: { client_user_id: uid },
        client_name: "Thrive",
        products: [Products.Transactions],
        country_codes: [CountryCode.Ca],
        language: "en",
        redirect_uri: redirectUri,
      });

      // Store short-lived session in Firestore (expires in 10 minutes)
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await admin.firestore().collection("plaid_sessions").doc(sessionToken).set({
        uid,
        link_token: linkResp.data.link_token,
        expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.json({ session_token: sessionToken });
    } catch (err: any) {
      console.error("plaidLinkToken error:", err?.response?.data?.error_code || err?.message);
      res.status(500).json({ error: "Failed to create Plaid link token" });
    }
  }
);

// ── plaidLink ─────────────────────────────────────────────────────────────────
// GET — serves the Plaid Link web page. Uses session_token, never a JWT.

export const plaidLink = onRequest(
  {
    secrets: [],
    region: "us-central1",
    cors: false,
  },
  async (req, res) => {
    const { session } = req.query;
    if (!session || typeof session !== "string" || !/^[a-f0-9]{64}$/.test(session)) {
      res.status(400).send("Invalid or missing session token.");
      return;
    }

    try {
      const sessionDoc = await admin.firestore().collection("plaid_sessions").doc(session).get();

      if (!sessionDoc.exists) {
        res.status(400).send("Session not found. Return to Thrive and try again.");
        return;
      }

      const data = sessionDoc.data()!;
      const expiresAt: admin.firestore.Timestamp = data.expires_at;

      if (expiresAt.toDate() < new Date()) {
        res.status(400).send("Session expired. Return to Thrive and try again.");
        return;
      }

      const linkToken: string = data.link_token;
      const base = getFunctionsBase();
      const exchangeUrl = `${base}/plaidExchangeToken`;
      const doneUrl = `${base}/plaidDone`;

      res.setHeader("Content-Security-Policy", [
        "default-src 'self'",
        "script-src 'self' https://cdn.plaid.com 'unsafe-inline'",
        "frame-src https://*.plaid.com https://plaid.com",
        "connect-src 'self' https://*.plaid.com https://plaid.com " + base,
        "img-src 'self' https://*.plaid.com data:",
        "style-src 'self' 'unsafe-inline'",
      ].join("; "));

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Connect Your Bank — Thrive</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#080F0C;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#fff;padding:24px}
    .logo{font-size:28px;font-weight:700;color:#00D4A0;margin-bottom:8px}
    .subtitle{font-size:15px;color:#8BA89C;margin-bottom:32px;text-align:center}
    .btn{background:#00D4A0;color:#000;border:none;padding:16px 32px;border-radius:14px;font-size:16px;font-weight:600;cursor:pointer;width:100%;max-width:320px}
    .btn:disabled{opacity:0.5;cursor:default}
    .status{margin-top:20px;font-size:14px;color:#8BA89C;text-align:center;max-width:320px}
  </style>
</head>
<body>
  <div class="logo">Thrive</div>
  <div class="subtitle">Securely connect your bank<br>powered by Plaid</div>
  <button class="btn" id="connectBtn" onclick="openPlaid()">Connect Account</button>
  <div class="status" id="status"></div>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <script>
    const SESSION_TOKEN = ${JSON.stringify(session)};
    const LINK_TOKEN = ${JSON.stringify(linkToken)};
    const EXCHANGE_URL = ${JSON.stringify(exchangeUrl)};
    const DONE_URL = ${JSON.stringify(doneUrl)};
    let handler;

    function openPlaid() {
      if (!handler) {
        document.getElementById('status').textContent = 'Initializing...';
        handler = Plaid.create({
          token: LINK_TOKEN,
          onSuccess: async function(public_token, metadata) {
            document.getElementById('connectBtn').disabled = true;
            document.getElementById('status').textContent = 'Connecting your accounts...';
            try {
              const resp = await fetch(EXCHANGE_URL, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                  session_token: SESSION_TOKEN,
                  public_token,
                  institution_name: metadata.institution?.name || 'Connected Bank'
                })
              });
              const data = await resp.json();
              if (data.success) {
                document.getElementById('status').textContent = data.accounts_synced + ' account(s) connected!';
                setTimeout(function() { window.location.href = DONE_URL; }, 1200);
              } else {
                document.getElementById('status').textContent = 'Error: ' + (data.error || 'Unknown error');
                document.getElementById('connectBtn').disabled = false;
              }
            } catch(e) {
              document.getElementById('status').textContent = 'Connection failed. Please try again.';
              document.getElementById('connectBtn').disabled = false;
            }
          },
          onExit: function(err) {
            if (err) document.getElementById('status').textContent = 'Cancelled.';
            document.getElementById('connectBtn').disabled = false;
          },
          onLoad: function() { document.getElementById('status').textContent = ''; }
        });
      }
      handler.open();
    }

    window.onload = function() { openPlaid(); };
  </script>
</body>
</html>`);
    } catch (err: any) {
      console.error("plaidLink error:", err?.message);
      res.status(500).send("An unexpected error occurred.");
    }
  }
);

// ── plaidExchangeToken ────────────────────────────────────────────────────────
// POST — called from the HTML page. Exchanges public_token, syncs accounts/txns.

export const plaidExchangeToken = onRequest(
  {
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    cors: false,
  },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { session_token, public_token, institution_name } = req.body;
    if (!session_token || !public_token) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    try {
      const db = admin.firestore();

      // Validate and consume session token (single-use)
      const sessionRef = db.collection("plaid_sessions").doc(session_token);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        res.status(401).json({ error: "Invalid or expired session" });
        return;
      }

      const sessionData = sessionDoc.data()!;
      if (sessionData.expires_at.toDate() < new Date()) {
        res.status(401).json({ error: "Session expired" });
        return;
      }

      const uid: string = sessionData.uid;

      // Invalidate session immediately (single-use)
      await sessionRef.delete();

      const plaid = getPlaidClient();

      // Exchange public token for access token
      const exchangeResp = await plaid.itemPublicTokenExchange({ public_token });
      const { access_token, item_id } = exchangeResp.data;

      // Store encrypted access token in Firestore
      const encryptedToken = encrypt(access_token, getEncryptionKey());
      const institutionName = institution_name || "Connected Bank";

      await db.collection("users").doc(uid).collection("plaid_items").doc(item_id).set({
        access_token: encryptedToken,
        item_id,
        institution_name: institutionName,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Sync accounts from Plaid → Firestore
      const accountsResp = await plaid.accountsGet({ access_token });
      const plaidAccounts = accountsResp.data.accounts;

      const batch = db.batch();
      for (const acc of plaidAccounts) {
        const type = mapPlaidType(acc.type, acc.subtype ?? null);
        const balance = acc.balances.current ?? 0;
        const accountRef = db.collection("users").doc(uid).collection("accounts").doc(`plaid_${acc.account_id}`);
        batch.set(accountRef, {
          name: acc.name,
          institution: institutionName,
          type,
          balance,
          color: typeColor(type),
          lastUpdated: new Date().toISOString(),
          plaid_account_id: acc.account_id,
          plaid_item_id: item_id,
        }, { merge: true });
      }
      await batch.commit();

      // Sync last 90 days of transactions
      let totalInserted = 0;
      try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        let offset = 0;
        const count = 250;

        while (true) {
          const txResp = await plaid.transactionsGet({
            access_token,
            start_date: startDate.toISOString().split("T")[0],
            end_date: new Date().toISOString().split("T")[0],
            options: { count, offset },
          });

          const { transactions, total_transactions } = txResp.data;
          const txBatch = db.batch();

          for (const tx of transactions) {
            const amount = tx.amount * -1; // Plaid: positive = debit; flip for our convention
            const primary = (tx.personal_finance_category as any)?.primary || (tx.category as string[] | null)?.[0] || "Other";
            const detailed = (tx.personal_finance_category as any)?.detailed || (tx.category as string[] | null)?.[1] || "";
            const category = mapPlaidCategory(primary, detailed);

            const txRef = db.collection("users").doc(uid).collection("transactions").doc(`plaid_tx_${tx.transaction_id}`);
            txBatch.set(txRef, {
              accountId: `plaid_${tx.account_id}`,
              date: tx.date,
              description: tx.name,
              amount,
              category,
              merchant: tx.merchant_name || null,
              plaid_transaction_id: tx.transaction_id,
            }, { merge: true });
            totalInserted++;
          }

          await txBatch.commit();
          offset += transactions.length;
          if (offset >= total_transactions) break;
        }
      } catch (txErr: any) {
        if (txErr?.response?.data?.error_code === "PRODUCT_NOT_READY") {
          // Accounts were synced; transactions will be available once the bank finishes syncing
          console.log(`[plaidExchangeToken] uid=${uid} accounts=${plaidAccounts.length} transactions=pending`);
          res.json({ success: true, accounts_synced: plaidAccounts.length, transactions_pending: true });
          return;
        }
        throw txErr;
      }

      console.log(`[plaidExchangeToken] uid=${uid} accounts=${plaidAccounts.length} transactions=${totalInserted}`);
      res.json({ success: true, accounts_synced: plaidAccounts.length });
    } catch (err: any) {
      const detail = err?.response?.data?.error_message || err?.message || "Unknown error";
      console.error("plaidExchangeToken error:", err?.response?.data?.error_code || detail);
      res.status(500).json({ error: "Failed to exchange Plaid token", detail });
    }
  }
);

// ── plaidSyncTransactions ─────────────────────────────────────────────────────
// POST — requires Firebase auth. Refreshes balances + syncs recent transactions.

export const plaidSyncTransactions = onRequest(
  {
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    cors: false,
  },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    let uid: string;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    try {
      const db = admin.firestore();
      const plaid = getPlaidClient();

      const itemsSnap = await db.collection("users").doc(uid).collection("plaid_items").get();
      if (itemsSnap.empty) {
        res.json({ success: true, synced: 0 });
        return;
      }

      let totalSynced = 0;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);

      for (const itemDoc of itemsSnap.docs) {
        const itemData = itemDoc.data();
        const access_token = decrypt(itemData.access_token, getEncryptionKey());
        const institutionName: string = itemData.institution_name || "Bank";

        let offset = 0;
        while (true) {
          const txResp = await plaid.transactionsGet({
            access_token,
            start_date: startDate.toISOString().split("T")[0],
            end_date: new Date().toISOString().split("T")[0],
            options: { count: 250, offset },
          });

          const { transactions, total_transactions } = txResp.data;
          const txBatch = db.batch();

          for (const tx of transactions) {
            const amount = tx.amount * -1;
            const primary = (tx.personal_finance_category as any)?.primary || (tx.category as string[] | null)?.[0] || "Other";
            const detailed = (tx.personal_finance_category as any)?.detailed || (tx.category as string[] | null)?.[1] || "";
            const category = mapPlaidCategory(primary, detailed);

            const txRef = db.collection("users").doc(uid).collection("transactions").doc(`plaid_tx_${tx.transaction_id}`);
            txBatch.set(txRef, {
              accountId: `plaid_${tx.account_id}`,
              date: tx.date,
              description: tx.name,
              amount,
              category,
              merchant: tx.merchant_name || null,
              plaid_transaction_id: tx.transaction_id,
            }, { merge: true });
            totalSynced++;
          }

          await txBatch.commit();
          offset += transactions.length;
          if (offset >= total_transactions) break;
        }

        // Refresh account balances
        const accountsResp = await plaid.accountsGet({ access_token });
        const accBatch = db.batch();
        for (const acc of accountsResp.data.accounts) {
          const type = mapPlaidType(acc.type, acc.subtype ?? null);
          const accRef = db.collection("users").doc(uid).collection("accounts").doc(`plaid_${acc.account_id}`);
          accBatch.set(accRef, {
            balance: acc.balances.current ?? 0,
            institution: institutionName,
            type,
            color: typeColor(type),
            lastUpdated: new Date().toISOString(),
          }, { merge: true });
        }
        await accBatch.commit();
      }

      res.json({ success: true, synced: totalSynced });
    } catch (err: any) {
      console.error("plaidSyncTransactions error:", err?.response?.data || err?.message);
      if (err?.response?.data?.error_code === "PRODUCT_NOT_READY") {
        res.status(202).json({ success: false, error: "Your bank is still preparing transaction history. Try again in a few minutes." });
        return;
      }
      res.status(500).json({ error: "Failed to sync transactions" });
    }
  }
);

// ── plaidDone ─────────────────────────────────────────────────────────────────
// GET — success page shown after Plaid Link completes.

export const plaidDone = onRequest(
  { region: "us-central1", cors: false },
  (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Connected — Thrive</title>
  <style>
    body{background:#080F0C;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#fff;text-align:center;padding:24px}
    .check{font-size:64px;margin-bottom:16px}
    h1{color:#00D4A0;font-size:24px;margin-bottom:8px}
    p{color:#8BA89C;font-size:15px}
  </style>
</head>
<body>
  <div class="check">✅</div>
  <h1>Accounts Connected!</h1>
  <p>You can close this page and return to Thrive.</p>
</body>
</html>`);
  }
);
