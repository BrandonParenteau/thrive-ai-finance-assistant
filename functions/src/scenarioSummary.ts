import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import OpenAI from "openai";

export const scenarioSummary = onRequest(
  { timeoutSeconds: 30, memory: "256MiB", region: "us-central1", cors: false },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    // FIX 18 — Content-Type validation
    if (!req.headers["content-type"]?.includes("application/json")) {
      res.status(415).json({ error: "Content-Type must be application/json" }); return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      await admin.auth().verifyIdToken(authHeader.slice(7));
    } catch {
      res.status(401).json({ error: "Invalid token" }); return;
    }

    // FIX 2 — Input validation
    const { scenarioLabel, monthlyIncomeChange, monthlyExpenseChange, oneTimeCost,
      durationMonths, currentNetWorth, monthlyIncome, monthlyExpenses, netImpact,
      breakEvenMonths, lowestPoint } = req.body;

    if (typeof scenarioLabel !== "string" || !scenarioLabel.trim()) {
      res.status(400).json({ error: "scenarioLabel must be a non-empty string" }); return;
    }
    if (scenarioLabel.length > 200) {
      res.status(400).json({ error: "scenarioLabel too long" }); return;
    }
    const numericFields = { monthlyIncomeChange, monthlyExpenseChange, oneTimeCost, durationMonths, currentNetWorth, monthlyIncome, monthlyExpenses };
    for (const [field, val] of Object.entries(numericFields)) {
      if (typeof val !== "number" || !isFinite(val)) {
        res.status(400).json({ error: `${field} must be a finite number` }); return;
      }
    }

    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const monthlySavings = monthlyIncome - monthlyExpenses;
      const prompt = `You are Thrive, a Canadian personal finance assistant. Summarize this financial scenario in 2-3 plain sentences. Be specific with dollar amounts (CAD). Do not use bullet points.

Scenario: ${scenarioLabel}
Current net worth: $${Math.round(currentNetWorth).toLocaleString("en-CA")} CAD
Monthly income: $${Math.round(monthlyIncome).toLocaleString("en-CA")} | Monthly expenses: $${Math.round(monthlyExpenses).toLocaleString("en-CA")} | Monthly savings: $${Math.round(monthlySavings).toLocaleString("en-CA")}
Income change: ${monthlyIncomeChange >= 0 ? "+" : ""}$${Math.round(monthlyIncomeChange).toLocaleString("en-CA")}/mo for ${durationMonths} months
Expense change: ${monthlyExpenseChange >= 0 ? "+" : ""}$${Math.round(monthlyExpenseChange).toLocaleString("en-CA")}/mo
One-time cost: $${Math.round(oneTimeCost).toLocaleString("en-CA")}
Net worth impact at end of projection: ${netImpact >= 0 ? "+" : ""}$${Math.round(netImpact).toLocaleString("en-CA")}
${lowestPoint < currentNetWorth ? `Lowest net worth during scenario: $${Math.round(lowestPoint).toLocaleString("en-CA")}` : ""}
${breakEvenMonths ? `Break-even: ${breakEvenMonths} months` : "Scenario does not break even within projection"}

Write a concise, practical 2-3 sentence summary of what this scenario means for the user's finances.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 200,
      });

      const summary = completion.choices[0]?.message?.content ?? "Unable to generate summary.";
      res.json({ summary });
    } catch (err) {
      console.error("scenarioSummary error:", err);
      res.status(500).json({ error: "Failed to generate summary" });
    }
  }
);
