/**
 * monthlySummaryEmail — Cloud Function (scheduled)
 *
 * Runs at 8:00 AM on the 1st of every month (Toronto time).
 * For each user with monthly_summary_enabled: true:
 *   1. Computes the previous month's income, expenses, savings, and top categories
 *      from their Firestore transactions subcollection.
 *   2. Sends an HTML summary email via nodemailer (SMTP credentials from env).
 *   3. Sends an Expo push notification to their stored expo_push_token.
 *
 * Required env vars (set via `firebase functions:secrets:set` or .env):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function fmt(n: number): string {
  return n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildEmailHtml(params: {
  email: string;
  monthName: string;
  year: number;
  income: number;
  expenses: number;
  savings: number;
  savingsRate: number;
  netWorth: number;
  topCategories: { cat: string; amt: number; pct: number }[];
}): string {
  const { monthName, year, income, expenses, savings, savingsRate, netWorth, topCategories } = params;
  const savingsColour = savings >= 0 ? "#00D4A0" : "#FF6B6B";
  const categoriesRows = topCategories
    .map(
      ({ cat, amt, pct }) => `
      <tr>
        <td style="padding:8px 0;font-family:sans-serif;font-size:14px;color:#ccc;">${cat}</td>
        <td style="padding:8px 0;font-family:sans-serif;font-size:14px;color:#fff;text-align:right;">$${fmt(amt)}</td>
        <td style="padding:8px 0;font-family:sans-serif;font-size:14px;color:#888;text-align:right;">${pct}%</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Thrive Monthly Summary</title></head>
<body style="margin:0;padding:0;background:#0A0F1A;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <tr>
      <td>
        <p style="font-size:13px;color:#00D4A0;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin:0 0 8px;">Thrive</p>
        <h1 style="font-size:26px;color:#fff;margin:0 0 4px;">${monthName} ${year} Summary</h1>
        <p style="font-size:13px;color:#888;margin:0 0 32px;">Your monthly financial recap</p>

        <!-- Key Metrics -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
          <tr>
            <td width="50%" style="padding-right:8px;">
              <div style="background:#131A2B;border:1px solid #1E2D45;border-radius:12px;padding:16px;">
                <p style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 4px;">Income</p>
                <p style="font-size:22px;color:#4ADE80;font-weight:700;margin:0;">$${fmt(income)}</p>
              </div>
            </td>
            <td width="50%" style="padding-left:8px;">
              <div style="background:#131A2B;border:1px solid #1E2D45;border-radius:12px;padding:16px;">
                <p style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 4px;">Expenses</p>
                <p style="font-size:22px;color:#FF6B6B;font-weight:700;margin:0;">$${fmt(expenses)}</p>
              </div>
            </td>
          </tr>
          <tr><td colspan="2" style="height:12px;"></td></tr>
          <tr>
            <td width="50%" style="padding-right:8px;">
              <div style="background:#131A2B;border:1px solid #1E2D45;border-radius:12px;padding:16px;">
                <p style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 4px;">Saved</p>
                <p style="font-size:22px;color:${savingsColour};font-weight:700;margin:0;">${savings < 0 ? "-" : ""}$${fmt(Math.abs(savings))}</p>
                <p style="font-size:11px;color:#888;margin:4px 0 0;">${savingsRate}% savings rate</p>
              </div>
            </td>
            <td width="50%" style="padding-left:8px;">
              <div style="background:#131A2B;border:1px solid #1E2D45;border-radius:12px;padding:16px;">
                <p style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 4px;">Net Worth</p>
                <p style="font-size:22px;color:#FFD700;font-weight:700;margin:0;">$${fmt(netWorth)}</p>
              </div>
            </td>
          </tr>
        </table>

        ${
          categoriesRows
            ? `<!-- Top Categories -->
        <div style="background:#131A2B;border:1px solid #1E2D45;border-radius:12px;padding:16px 20px;margin-bottom:28px;">
          <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 12px;">Top Spending Categories</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <thead>
              <tr>
                <th style="text-align:left;font-size:11px;color:#555;padding-bottom:6px;">Category</th>
                <th style="text-align:right;font-size:11px;color:#555;padding-bottom:6px;">Amount</th>
                <th style="text-align:right;font-size:11px;color:#555;padding-bottom:6px;">% of Spending</th>
              </tr>
            </thead>
            <tbody>${categoriesRows}</tbody>
          </table>
        </div>`
            : ""
        }

        <p style="font-size:12px;color:#555;margin-top:32px;text-align:center;">
          You're receiving this because you enabled Monthly Summary in Thrive.<br>
          Open the Thrive app to manage your notification preferences.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export const monthlySummaryEmail = onSchedule(
  {
    schedule: "0 8 1 * *", // 8:00 AM on the 1st of every month
    timeZone: "America/Toronto",
    region: "us-central1",
    memory: "512MiB",
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();

    // Previous month
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const monthName = MONTH_NAMES[prevMonth];

    // Build SMTP transport
    const smtpHost = process.env.SMTP_HOST ?? "";
    const smtpPort = parseInt(process.env.SMTP_PORT ?? "587");
    const smtpUser = process.env.SMTP_USER ?? "";
    const smtpPass = process.env.SMTP_PASS ?? "";
    const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn("[monthlySummaryEmail] SMTP env vars not configured — skipping email sends.");
    }

    const transporter = smtpHost
      ? nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        })
      : null;

    // Expo Push API endpoint
    const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

    const usersSnap = await db.collection("users").get();

    const promises = usersSnap.docs.map(async (userDoc) => {
      try {
        const userData = userDoc.data();
        if (!userData.monthly_summary_enabled) return;

        const uid = userDoc.id;
        const userEmail: string = userData.email ?? "";
        const pushToken: string = userData.expo_push_token ?? "";

        // Fetch previous month's transactions
        const txSnap = await db
          .collection("users")
          .doc(uid)
          .collection("transactions")
          .get();

        const prevTxs = txSnap.docs
          .map((d) => d.data())
          .filter((t) => {
            try {
              const rawDate = t.date;
              const d =
                typeof rawDate === "string"
                  ? new Date(rawDate)
                  : rawDate?.toDate
                  ? rawDate.toDate()
                  : new Date(rawDate);
              return (
                d.getMonth() === prevMonth && d.getFullYear() === prevYear
              );
            } catch {
              return false;
            }
          });

        const income = prevTxs
          .filter((t) => (t.amount ?? 0) > 0)
          .reduce((s, t) => s + (t.amount ?? 0), 0);

        const expenses = Math.abs(
          prevTxs
            .filter((t) => (t.amount ?? 0) < 0)
            .reduce((s, t) => s + (t.amount ?? 0), 0)
        );

        const savings = income - expenses;
        const savingsRate =
          income > 0 ? Math.round((savings / income) * 100) : 0;

        // Net worth
        const accSnap = await db
          .collection("users")
          .doc(uid)
          .collection("accounts")
          .get();
        const netWorth = accSnap.docs.reduce(
          (s, d) => s + (d.data().balance ?? 0),
          0
        );

        // Top categories
        const categoryMap: Record<string, number> = {};
        prevTxs
          .filter((t) => (t.amount ?? 0) < 0)
          .forEach((t) => {
            const cat = t.category ?? "Other";
            categoryMap[cat] = (categoryMap[cat] ?? 0) + Math.abs(t.amount ?? 0);
          });
        const topCategories = Object.entries(categoryMap)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([cat, amt]) => ({
            cat,
            amt,
            pct: expenses > 0 ? Math.round((amt / expenses) * 100) : 0,
          }));

        // Send email
        if (transporter && userEmail) {
          const html = buildEmailHtml({
            email: userEmail,
            monthName,
            year: prevYear,
            income,
            expenses,
            savings,
            savingsRate,
            netWorth,
            topCategories,
          });
          await transporter.sendMail({
            from: `"Thrive" <${smtpFrom}>`,
            to: userEmail,
            subject: `Your ${monthName} ${prevYear} Financial Summary`,
            html,
          });
        }

        // Send Expo push notification
        if (pushToken && pushToken.startsWith("ExponentPushToken[")) {
          await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              to: pushToken,
              title: "Your Monthly Financial Summary",
              body: `See your ${monthName} ${prevYear} income, expenses, and savings — tap to review.`,
              data: { type: "monthly_summary" },
            }),
          });
        }
      } catch (err) {
        console.error(`[monthlySummaryEmail] Error processing user ${userDoc.id}:`, err);
      }
    });

    await Promise.allSettled(promises);
    console.log("[monthlySummaryEmail] Completed for", usersSnap.size, "users.");
  }
);
