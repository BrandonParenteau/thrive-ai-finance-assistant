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
exports.netWorthSnapshot = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
exports.netWorthSnapshot = (0, scheduler_1.onSchedule)({
    schedule: "0 2 1 * *", // 2:00 AM on the 1st of every month
    timeZone: "America/Toronto",
    region: "us-central1",
    memory: "256MiB",
}, async () => {
    const db = admin.firestore();
    const now = new Date();
    const snapshotKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const usersSnap = await db.collection("users").get();
    const promises = usersSnap.docs.map(async (userDoc) => {
        try {
            const uid = userDoc.id;
            const accountsSnap = await db
                .collection("users")
                .doc(uid)
                .collection("accounts")
                .get();
            const netWorth = accountsSnap.docs.reduce((sum, d) => {
                return sum + (d.data().balance || 0);
            }, 0);
            await db
                .collection("users")
                .doc(uid)
                .collection("net_worth_snapshots")
                .doc(snapshotKey)
                .set({
                netWorth,
                month: snapshotKey,
                date: now.toISOString(),
            });
        }
        catch (err) {
            console.error(`Failed to snapshot uid=${userDoc.id}:`, err);
        }
    });
    await Promise.all(promises);
    console.log(`Net worth snapshots saved for ${usersSnap.docs.length} users (${snapshotKey})`);
});
//# sourceMappingURL=netWorthSnapshot.js.map