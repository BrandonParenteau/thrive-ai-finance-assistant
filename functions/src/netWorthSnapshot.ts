import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

export const netWorthSnapshot = onSchedule(
  {
    schedule: "0 2 1 * *", // 2:00 AM on the 1st of every month
    timeZone: "America/Toronto",
    region: "us-central1",
    memory: "256MiB",
  },
  async () => {
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
      } catch (err) {
        console.error(`Failed to snapshot uid=${userDoc.id}:`, err);
      }
    });

    await Promise.all(promises);
    console.log(`Net worth snapshots saved for ${usersSnap.docs.length} users (${snapshotKey})`);
  }
);
