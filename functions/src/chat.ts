import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import OpenAI from "openai";

const SYSTEM_PROMPT = `You are Thrive, a friendly and knowledgeable Canadian personal finance assistant. You help Canadians with:
- TFSA (Tax-Free Savings Account) — contribution room, strategies, eligible investments
- RRSP (Registered Retirement Savings Plan) — contribution limits, spousal RRSP, HBP, LLP
- FHSA (First Home Savings Account) — eligibility, contribution room, withdrawal rules
- RESP (Registered Education Savings Plan) — CESG grants, contribution strategies
- Canadian tax planning — T4, T5, capital gains, dividends, tax credits
- Budgeting in CAD — 50/30/20 rule, envelope method, pay-yourself-first
- Canadian banks and financial institutions — Big 6 banks, credit unions, neobanks
- Investing in Canada — ETFs, index funds, Wealthsimple, Questrade, DRIP
- Credit cards in Canada — best rewards cards (Amex Cobalt, Scotiabank, TD etc.)
- Canadian real estate — stress test, CMHC insurance, first-time buyer incentives
- CPP and OAS — retirement planning, deferral strategies

Always use Canadian context: CAD currency, Canadian tax rules, Canadian financial institutions, and refer to CRA (Canada Revenue Agency) not IRS. Keep responses concise, warm, and actionable. Use Canadian spelling where appropriate (e.g., "cheque" not "check"). When mentioning contribution limits, use the most recent known limits but note they may have changed.`;

export const chat = onRequest(
  {
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    cors: false, // handled manually for SSE
  },
  async (req, res) => {
    // CORS preflight
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // Verify Firebase ID token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      await admin.auth().verifyIdToken(authHeader.slice(7));
    } catch {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length > 50) {
      res.status(400).json({ error: "Invalid messages" });
      return;
    }

    // Sanitize: only user/assistant roles, last 20 messages, max 4000 chars each
    const sanitized: Array<{ role: "user" | "assistant"; content: string }> = messages
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .slice(-20)
      .map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content.slice(0, 4000) : "",
      }));

    // Set SSE headers and flush immediately so the client starts receiving
    res.set("Content-Type", "text/event-stream");
    res.set("Cache-Control", "no-cache, no-transform");
    res.set("X-Accel-Buffering", "no");
    res.set("Connection", "keep-alive");
    res.flushHeaders();

    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const stream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...sanitized],
        stream: true,
        max_completion_tokens: 1024,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      console.error("Chat error:", err);
      res.write(`data: ${JSON.stringify({ error: "Chat failed" })}\n\n`);
      res.end();
    }
  }
);
