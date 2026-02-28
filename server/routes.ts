import type { Express } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SYSTEM_PROMPT = `You are Thrive, a friendly and knowledgeable Canadian personal finance assistant. You help Canadians with:
- TFSA (Tax-Free Savings Account) — contribution room, strategies, eligible investments
- RRSP (Registered Retirement Savings Plan) — contribution limits, spousal RRSP, HBP, LLP
- FHSA (First Home Savings Account) — eligibility, contribution room, withdrawal rules
- RESP (Registered Education Savings Plan) — CESG grants, contribution strategies
- Canadian tax planning — T4, T5, capital gains, dividends, tax credits
- Budgeting in CAD — 50/30/20 rule, envelope method, pay-yourself-first
- Canadian banks and financial institutions — Big 6 banks, credit unions, neobanks
- Investing in Canada — ETFs, index funds, wealthsimple, Questrade, DRIP
- Credit cards in Canada — best rewards cards (Amex Cobalt, Scotiabank, TD etc.)
- Canadian real estate — stress test, CMHC insurance, first-time buyer incentives
- CPP and OAS — retirement planning, deferral strategies

Always use Canadian context: CAD currency, Canadian tax rules, Canadian financial institutions, and refer to CRA (Canada Revenue Agency) not IRS. Keep responses concise, warm, and actionable. Use Canadian spelling where appropriate (e.g., "cheque" not "check"). When mentioning contribution limits, use the most recent known limits but note they may have changed.`;

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const stream = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        stream: true,
        max_completion_tokens: 8192,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Chat failed" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Chat failed" })}\n\n`);
        res.end();
      }
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
