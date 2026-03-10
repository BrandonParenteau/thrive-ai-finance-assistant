import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

const revenuecatSecret = defineSecret("REVENUECAT_WEBHOOK_SECRET");

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
  },
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
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
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

    console.log(`[revenuecat] event=${eventType} uid=${appUserId} product=${productId}`);

    try {
      const db = admin.firestore();
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
      }
      // Ignore other event types (e.g. TRANSFER, TEST)

      res.status(200).json({ received: true });
    } catch (err: any) {
      console.error("revenuecatWebhook Firestore error:", err?.message);
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);
