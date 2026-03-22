"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.revenuecatWebhook = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const revenuecatSecret = (0, params_1.defineSecret)("REVENUECAT_WEBHOOK_SECRET");
// FIX 8 — Remove PII from logs: short hash helper
function shortHash(uid) {
    return crypto.createHash("sha256").update(uid).digest("hex").slice(0, 8);
}
// FIX 19 — Audit logging helper
async function auditLog(db, action, uid, meta = {}) {
    try {
        await db.collection("audit_logs").add({
            action,
            uid_hash: shortHash(uid),
            meta,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch {
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
exports.revenuecatWebhook = (0, https_1.onRequest)({
    secrets: [revenuecatSecret],
    region: "us-central1",
    cors: false,
    // FIX 3 — rawBody needed for signature verification
    rawBody: true,
}, async (req, res) => {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    // Verify RevenueCat webhook signature
    const signature = req.headers["x-revenuecat-signature"];
    if (!signature) {
        res.status(401).json({ error: "Missing signature" });
        return;
    }
    try {
        // FIX 3 — Use rawBody when available for accurate signature verification
        const rawBody = req.rawBody
            ? req.rawBody.toString("utf8")
            : typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        const expected = crypto
            .createHmac("sha256", revenuecatSecret.value())
            .update(rawBody)
            .digest("hex");
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
            res.status(401).json({ error: "Invalid signature" });
            return;
        }
    }
    catch {
        res.status(401).json({ error: "Signature verification failed" });
        return;
    }
    const event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const eventType = event?.event?.type;
    const appUserId = event?.event?.app_user_id; // Firebase UID
    const productId = event?.event?.product_id || "";
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
            await userRef.set({
                subscription: {
                    plan: "Pro",
                    product_id: productId,
                    active: true,
                    updated_at: admin.firestore.FieldValue.serverTimestamp(),
                },
            }, { merge: true });
            // FIX 19 — Audit log subscription activation
            await auditLog(db, "subscription_activated", appUserId, { productId });
        }
        else if (INACTIVE_EVENTS.has(eventType)) {
            await userRef.set({
                subscription: {
                    plan: "Free",
                    active: false,
                    updated_at: admin.firestore.FieldValue.serverTimestamp(),
                },
            }, { merge: true });
            // FIX 19 — Audit log subscription cancellation
            await auditLog(db, "subscription_cancelled", appUserId, {});
        }
        // Ignore other event types (e.g. TRANSFER, TEST)
        res.status(200).json({ received: true });
    }
    catch (err) {
        console.error("revenuecatWebhook Firestore error:", err?.message);
        res.status(500).json({ error: "Failed to process webhook" });
    }
});
//# sourceMappingURL=revenuecat.js.map