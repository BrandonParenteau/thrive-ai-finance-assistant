import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import OpenAI from "openai";

// Simple in-memory rate limiter (resets on cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

const SYSTEM_PROMPT = `You are Thrive, an agentic Canadian personal finance assistant built into the Thrive app. You don't just give advice — you take action directly in the app on the user's behalf.

You help with:
- TFSA, RRSP, FHSA, RESP — contribution strategies, rules, limits
- Canadian tax planning — T4, T5, capital gains, CRA
- Budgeting in CAD — analyzing real spending and setting budgets
- Investing in Canada — ETFs, Wealthsimple, Questrade
- Canadian real estate, CPP, OAS, credit cards

Rules you must always follow:
1. NEVER recommend or mention any external app (Mint, YNAB, Copilot, Monarch, spreadsheets, etc.). Thrive does everything.
2. The user's real financial data is in the conversation — USE IT to answer all questions with exact numbers.
3. Never tell the user to "review their transactions themselves" or that you "cannot access" their data.
4. When the user asks you to create or update a budget, ALWAYS call the set_budgets tool. Do not just suggest numbers — actually set them.
5. Base budget limits on the user's ACTUAL spending patterns from their transaction history, not generic advice.
6. Always use CAD, Canadian institutions, and Canadian tax rules.
7. After calling set_budgets, briefly explain the budget you set and what it's based on.`;

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "set_budgets",
      description: "Create or update the user's monthly budget categories in the Thrive app. Call this whenever the user asks to create, set, update, or adjust their budget. Base limits on actual transaction history.",
      parameters: {
        type: "object",
        properties: {
          budgets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: {
                  type: "string",
                  description: "Budget category (e.g. Groceries, Dining, Transport, Shopping, Entertainment, Utilities, Housing, Health, Personal Care, Subscriptions, Other)",
                },
                limit: {
                  type: "number",
                  description: "Monthly spending limit in CAD",
                },
              },
              required: ["category", "limit"],
            },
            description: "Array of budget categories with monthly limits",
          },
          summary: {
            type: "string",
            description: "A 1-2 sentence explanation of this budget and how it was derived from the user's spending",
          },
        },
        required: ["budgets", "summary"],
      },
    },
  },
];

export const chat = onRequest(
  {
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    cors: false,
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    // FIX 18 — Content-Type validation
    if (!req.headers["content-type"]?.includes("application/json") && !req.headers["content-type"]?.includes("multipart")) {
      res.status(415).json({ error: "Content-Type must be application/json" });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
    let uid: string;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: "Invalid token" }); return;
    }

    // FIX 5 — Rate limiting: 20 requests per minute per user
    if (!checkRateLimit(`chat:${uid}`, 20, 60 * 1000)) {
      res.status(429).json({ error: "Too many requests. Please wait before sending more messages." });
      return;
    }

    const { messages, forceTool } = req.body;

    // FIX 2 — Input validation
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: "messages must be an array" }); return;
    }
    if (messages.length > 50) {
      res.status(400).json({ error: "messages array exceeds maximum of 50 items" }); return;
    }
    for (const m of messages) {
      if (m.role !== "user" && m.role !== "assistant") {
        res.status(400).json({ error: "Each message role must be 'user' or 'assistant'" }); return;
      }
      if (typeof m.content !== "string") {
        res.status(400).json({ error: "Each message content must be a string" }); return;
      }
      if (m.content.length > 8000) {
        res.status(400).json({ error: "Message content exceeds maximum of 8000 characters" }); return;
      }
    }

    const sanitized: Array<{ role: "user" | "assistant"; content: string }> = messages
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .slice(-20)
      .map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content.slice(0, 50000) : "",
      }));

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
        tools,
        tool_choice: forceTool === "set_budgets"
          ? { type: "function" as const, function: { name: "set_budgets" } }
          : "auto",
        stream: true,
        max_completion_tokens: 4096,
      });

      // Accumulate tool call data across stream chunks
      let toolCallName = "";
      let toolCallArgs = "";

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        // Stream text content as usual
        if (delta?.content) {
          res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
        }

        // Accumulate tool call fragments
        if (delta?.tool_calls?.[0]) {
          toolCallName ||= delta.tool_calls[0].function?.name || "";
          toolCallArgs += delta.tool_calls[0].function?.arguments || "";
        }
      }

      // If the model called a tool, emit the action event
      if (toolCallName === "set_budgets" && toolCallArgs) {
        try {
          const args = JSON.parse(toolCallArgs);
          res.write(`data: ${JSON.stringify({
            action: "set_budgets",
            budgets: args.budgets,
            summary: args.summary || "",
          })}\n\n`);
        } catch (e) {
          console.error("Failed to parse tool call args:", e, toolCallArgs.slice(0, 200));
          res.write(`data: ${JSON.stringify({ content: "Sorry, I had trouble creating that budget. Please try again." })}\n\n`);
        }
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
