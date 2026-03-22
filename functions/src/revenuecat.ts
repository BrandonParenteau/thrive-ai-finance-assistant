import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

const revenuecatSecret = defineSecret("REVENUECAT_WEBHOOK_SECRET");

// FIX 8 — Remove PII from logs: short hash helper
function shortHash(uid: string): string {
  return crypto.createHash("sha256").update(uid).digest("hex").slice(0, 8);
}

// FIX 19 — Audit logging helper
async function auditLog(db: admin.firestore.Firestore, action: string, uid: string, meta: Record<string, any> = {}) {
  try {
    await db.collection("audit_logs").add({
      action,
      uid_hash: shortHash(uid),
      meta,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch {
    // Non-critical — don't fail request if audit log fails
  }
}

// RevenueCat event types that affect subscription status
const ACTIVE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "BILLING_ISSUE_RESOLVED",
  "UNCANCELLATION",
]);

const INACTIVE_EVENTS = new Set([
  "CANCELLATION",
  "EXPIRATION",
  "BILLING_ISSUE",
]);

export const revenuecatWebhook = onRequest(
  {
    secrets: [revenuecatSecret],
    region: "us-central1",
    cors: false,
    // FIX 3 — rawBody needed for signature verification
    rawBody: true,
  } as any,
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // Verify RevenueCat webhook signature
    const signature = req.headers["x-revenuecat-signature"] as string | undefined;
    if (!signature) {
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    try {
      // FIX 3 — Use rawBody when available for accurate signature verification
      const rawBody = (req as any).rawBody
        ? (req as any).rawBody.toString("utf8")
        : typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      const expected = crypto
        .createHmac("sha256", revenuecatSecret.value())
        .update(rawBody)
        .digest("hex");

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    } catch {
      res.status(401).json({ error: "Signature verification failed" });
      return;
    }

    const event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const eventType: string = event?.event?.type;
    const appUserId: string = event?.event?.app_user_id; // Firebase UID
    const productId: string = event?.event?.product_id || "";

    if (!eventType || !appUserId) {
      res.status(400).json({ error: "Missing event type or user ID" });
      return;
    }

    // FIX 8 — Replace raw UID with shortened hash in logs
    console.log(`[revenuecat] event=${eventType} uid_hash=${shortHash(appUserId)} product=${productId}`);

    try {
      const db = admin.firestore();

      // FIX 10 — Validate user exists before writing subscription data
      const userDoc = await db.collection("users").doc(appUserId).get();
      if (!userDoc.exists) {
        console.warn(`[revenuecat] Webhook for unknown user hash=${shortHash(appUserId)}`);
        res.status(200).json({ ok: true }); // Return 200 to avoid RC retries
        return;
      }

      const userRef = db.collection("users").doc(appUserId);

      if (ACTIVE_EVENTS.has(eventType)) {
        await userRef.set(
          {
            subscription: {
              plan: "Pro",
              product_id: productId,
              active: true,
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          { merge: true }
        );
        // FIX 19 — Audit log subscription activation
        await auditLog(db, "subscription_activated", appUserId, { productId });
      } else if (INACTIVE_EVENTS.has(eventType)) {
        await userRef.set(
          {
            subscription: {
              plan: "Free",
              active: false,
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          { merge: true }
        );
        // FIX 19 — Audit log subscription cancellation
        await auditLog(db, "subscription_cancelled", appUserId, {});
      }
      // Ignore other event types (e.g. TRANSFER, TEST)

      res.status(200).json({ received: true });
    } catch (err: any) {
      console.error("revenuecatWebhook Firestore error:", err?.message);
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);
