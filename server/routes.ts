import type { Express } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "./db";
import { PlaidApi, PlaidEnvironments, Configuration, Products, CountryCode } from "plaid";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const JWT_SECRET = process.env.SESSION_SECRET || "thrive-jwt-secret-fallback";

const PLAID_CONFIGURED =
  !!process.env.PLAID_CLIENT_ID && !!process.env.PLAID_SECRET;

let plaidClient: PlaidApi | null = null;
if (PLAID_CONFIGURED) {
  const plaidEnv = process.env.PLAID_ENV || "sandbox";
  const config = new Configuration({
    basePath:
      PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] ||
      PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
        "PLAID-SECRET": process.env.PLAID_SECRET!,
      },
    },
  });
  plaidClient = new PlaidApi(config);
}

function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

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

  // ── Auth ──────────────────────────────────────────────────────────────────

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: "Email and password required" });
      if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

      const existing = await query("SELECT id FROM thrive_users WHERE email = $1", [email.toLowerCase()]);
      if (existing.length > 0) return res.status(409).json({ error: "An account with this email already exists" });

      const hash = await bcrypt.hash(password, 12);
      const users = await query(
        "INSERT INTO thrive_users (email, password_hash) VALUES ($1, $2) RETURNING id, email, monthly_income, onboarding_complete",
        [email.toLowerCase(), hash]
      );
      const user = users[0];
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
      res.json({ token, user });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: "Email and password required" });

      const users = await query(
        "SELECT id, email, password_hash, monthly_income, onboarding_complete FROM thrive_users WHERE email = $1",
        [email.toLowerCase()]
      );
      if (users.length === 0) return res.status(401).json({ error: "Invalid email or password" });

      const user = users[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: "Invalid email or password" });

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
      res.json({ token, user: { id: user.id, email: user.email, monthly_income: user.monthly_income, onboarding_complete: user.onboarding_complete } });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", authMiddleware, async (req: any, res) => {
    try {
      const users = await query(
        "SELECT id, email, monthly_income, onboarding_complete FROM thrive_users WHERE id = $1",
        [req.userId]
      );
      if (users.length === 0) return res.status(404).json({ error: "User not found" });
      res.json(users[0]);
    } catch {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.put("/api/auth/profile", authMiddleware, async (req: any, res) => {
    try {
      const { monthly_income, onboarding_complete } = req.body;
      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;
      if (monthly_income !== undefined) { updates.push(`monthly_income = $${idx++}`); params.push(monthly_income); }
      if (onboarding_complete !== undefined) { updates.push(`onboarding_complete = $${idx++}`); params.push(onboarding_complete); }
      if (updates.length === 0) return res.json({});
      params.push(req.userId);
      const users = await query(
        `UPDATE thrive_users SET ${updates.join(", ")} WHERE id = $${idx} RETURNING id, email, monthly_income, onboarding_complete`,
        params
      );
      res.json(users[0]);
    } catch (err) {
      console.error("Profile update error:", err);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // ── Accounts ──────────────────────────────────────────────────────────────

  app.get("/api/accounts", authMiddleware, async (req: any, res) => {
    try {
      const accounts = await query(
        "SELECT * FROM thrive_accounts WHERE user_id = $1 ORDER BY last_updated DESC",
        [req.userId]
      );
      res.json(accounts);
    } catch {
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  app.post("/api/accounts", authMiddleware, async (req: any, res) => {
    try {
      const { name, institution, type, balance, color } = req.body;
      const id = `acc_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      const accounts = await query(
        "INSERT INTO thrive_accounts (id, user_id, name, institution, type, balance, color) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [id, req.userId, name, institution, type, balance || 0, color || "#00D4A0"]
      );
      res.json(accounts[0]);
    } catch (err) {
      console.error("Add account error:", err);
      res.status(500).json({ error: "Failed to add account" });
    }
  });

  app.delete("/api/accounts/:id", authMiddleware, async (req: any, res) => {
    try {
      await query("DELETE FROM thrive_accounts WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  // ── Transactions ──────────────────────────────────────────────────────────

  app.get("/api/transactions", authMiddleware, async (req: any, res) => {
    try {
      const txs = await query(
        "SELECT * FROM thrive_transactions WHERE user_id = $1 ORDER BY date DESC, id DESC",
        [req.userId]
      );
      res.json(txs);
    } catch {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  app.post("/api/transactions", authMiddleware, async (req: any, res) => {
    try {
      const { account_id, date, description, amount, category, merchant } = req.body;
      const id = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      const txs = await query(
        "INSERT INTO thrive_transactions (id, user_id, account_id, date, description, amount, category, merchant) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [id, req.userId, account_id || null, date, description, amount, category || "Other", merchant || null]
      );
      res.json(txs[0]);
    } catch (err) {
      console.error("Add tx error:", err);
      res.status(500).json({ error: "Failed to add transaction" });
    }
  });

  app.put("/api/transactions/:id", authMiddleware, async (req: any, res) => {
    try {
      const { description, amount, category, merchant, date } = req.body;
      const txs = await query(
        `UPDATE thrive_transactions SET description=$1, amount=$2, category=$3, merchant=$4, date=$5 WHERE id=$6 AND user_id=$7 RETURNING *`,
        [description, amount, category, merchant || null, date, req.params.id, req.userId]
      );
      if (txs.length === 0) return res.status(404).json({ error: "Transaction not found" });
      res.json(txs[0]);
    } catch (err) {
      console.error("Update tx error:", err);
      res.status(500).json({ error: "Failed to update transaction" });
    }
  });

  app.delete("/api/transactions/:id", authMiddleware, async (req: any, res) => {
    try {
      await query("DELETE FROM thrive_transactions WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete transaction" });
    }
  });

  // ── Budgets ───────────────────────────────────────────────────────────────

  app.get("/api/budgets", authMiddleware, async (req: any, res) => {
    try {
      const budgets = await query(
        "SELECT * FROM thrive_user_budgets WHERE user_id = $1 ORDER BY category",
        [req.userId]
      );
      res.json(budgets);
    } catch {
      res.status(500).json({ error: "Failed to fetch budgets" });
    }
  });

  app.put("/api/budgets", authMiddleware, async (req: any, res) => {
    try {
      const { budgets } = req.body as { budgets: { category: string; limit_amount: number }[] };
      for (const b of budgets) {
        await query(
          `INSERT INTO thrive_user_budgets (user_id, category, limit_amount) VALUES ($1,$2,$3)
           ON CONFLICT (user_id, category) DO UPDATE SET limit_amount = $3`,
          [req.userId, b.category, b.limit_amount]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Budgets update error:", err);
      res.status(500).json({ error: "Failed to update budgets" });
    }
  });

  // ── Plaid ─────────────────────────────────────────────────────────────────

  app.post("/api/plaid/link-token", authMiddleware, async (req: any, res) => {
    if (!plaidClient) {
      return res.status(503).json({ error: "Plaid not configured. Add PLAID_CLIENT_ID and PLAID_SECRET environment variables." });
    }
    try {
      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: req.userId },
        client_name: "Thrive",
        products: [Products.Transactions],
        country_codes: [CountryCode.Ca],
        language: "en",
        redirect_uri: process.env.PLAID_REDIRECT_URI,
      });
      res.json({ link_token: response.data.link_token });
    } catch (err: any) {
      console.error("Plaid link token error:", err?.response?.data || err);
      res.status(500).json({ error: "Failed to create Plaid link token" });
    }
  });

  app.post("/api/plaid/exchange-token", authMiddleware, async (req: any, res) => {
    if (!plaidClient) return res.status(503).json({ error: "Plaid not configured" });
    try {
      const { public_token, institution_name } = req.body;
      const exchangeResp = await plaidClient.itemPublicTokenExchange({ public_token });
      const { access_token, item_id } = exchangeResp.data;

      await query(
        "INSERT INTO thrive_plaid_items (user_id, access_token, item_id, institution_name) VALUES ($1,$2,$3,$4)",
        [req.userId, access_token, item_id, institution_name || "Connected Bank"]
      );

      const accountsResp = await plaidClient.accountsGet({ access_token });
      const plaidAccounts = accountsResp.data.accounts;

      for (const acc of plaidAccounts) {
        const id = `plaid_${acc.account_id}`;
        const type = mapPlaidType(acc.type, acc.subtype);
        const balance = acc.balances.current ?? 0;
        await query(
          `INSERT INTO thrive_accounts (id, user_id, name, institution, type, balance, color, plaid_account_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET balance=$6, last_updated=NOW()`,
          [id, req.userId, acc.name, institution_name || "Bank", type, balance, typeColor(type), acc.account_id]
        );
      }

      res.json({ success: true, accounts_synced: plaidAccounts.length });
    } catch (err: any) {
      console.error("Plaid exchange error:", err?.response?.data || err);
      res.status(500).json({ error: "Failed to exchange Plaid token" });
    }
  });

  app.post("/api/plaid/sync-transactions", authMiddleware, async (req: any, res) => {
    if (!plaidClient) return res.status(503).json({ error: "Plaid not configured" });
    try {
      const items = await query("SELECT * FROM thrive_plaid_items WHERE user_id = $1", [req.userId]);
      let totalSynced = 0;
      for (const item of items) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const txResp = await plaidClient.transactionsGet({
          access_token: item.access_token,
          start_date: startDate.toISOString().split("T")[0],
          end_date: new Date().toISOString().split("T")[0],
        });
        for (const tx of txResp.data.transactions) {
          const amount = tx.amount * -1;
          const cat = tx.personal_finance_category?.primary || "Other";
          await query(
            `INSERT INTO thrive_transactions (id, user_id, account_id, date, description, amount, category, merchant, plaid_transaction_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO NOTHING`,
            [`plaid_tx_${tx.transaction_id}`, req.userId, `plaid_${tx.account_id}`, tx.date, tx.name, amount, mapPlaidCategory(cat), tx.merchant_name || null, tx.transaction_id]
          );
        }
        totalSynced += txResp.data.transactions.length;
      }
      res.json({ success: true, synced: totalSynced });
    } catch (err: any) {
      console.error("Plaid sync error:", err?.response?.data || err);
      res.status(500).json({ error: "Failed to sync Plaid transactions" });
    }
  });

  // ── Plaid Link hosted page ────────────────────────────────────────────────

  app.get("/plaid-link", (req, res) => {
    const { token, userId, authToken } = req.query;
    if (!token) return res.status(400).send("Missing link token");
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Connect Your Bank — Thrive</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#080F0C;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#fff;padding:24px}
    .logo{font-size:28px;font-weight:700;color:#00D4A0;margin-bottom:8px}
    .subtitle{font-size:15px;color:#8BA89C;margin-bottom:32px;text-align:center}
    .btn{background:#00D4A0;color:#000;border:none;padding:16px 32px;border-radius:14px;font-size:16px;font-weight:600;cursor:pointer;width:100%;max-width:320px}
    .status{margin-top:20px;font-size:14px;color:#8BA89C;text-align:center}
  </style>
</head>
<body>
  <div class="logo">Thrive</div>
  <div class="subtitle">Securely connect your bank<br>powered by Plaid</div>
  <button class="btn" id="connectBtn" onclick="openPlaid()">Connect Account</button>
  <div class="status" id="status"></div>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <script>
    let handler;
    function openPlaid() {
      if (!handler) {
        document.getElementById('status').textContent = 'Initializing...';
        handler = Plaid.create({
          token: '${token}',
          onSuccess: async function(public_token, metadata) {
            document.getElementById('status').textContent = 'Connecting your accounts...';
            document.getElementById('connectBtn').disabled = true;
            try {
              const resp = await fetch('/api/plaid/exchange-token', {
                method: 'POST',
                headers: {'Content-Type':'application/json','Authorization':'Bearer ${authToken}'},
                body: JSON.stringify({public_token, institution_name: metadata.institution?.name})
              });
              const data = await resp.json();
              if (data.success) {
                document.getElementById('status').textContent = 'Success! ' + data.accounts_synced + ' accounts connected.';
                document.getElementById('connectBtn').textContent = 'Done!';
                setTimeout(() => { window.location.href = '/plaid-done'; }, 1500);
              } else {
                document.getElementById('status').textContent = 'Error: ' + (data.error || 'Unknown error');
                document.getElementById('connectBtn').disabled = false;
              }
            } catch(e) {
              document.getElementById('status').textContent = 'Connection failed. Please try again.';
              document.getElementById('connectBtn').disabled = false;
            }
          },
          onExit: function(err) {
            if (err) document.getElementById('status').textContent = 'Cancelled.';
            document.getElementById('connectBtn').disabled = false;
          },
          onLoad: function() {
            document.getElementById('status').textContent = '';
          }
        });
      }
      handler.open();
    }
    window.onload = function() { openPlaid(); };
  </script>
</body>
</html>`);
  });

  app.get("/plaid-done", (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><title>Connected — Thrive</title>
<style>body{background:#080F0C;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#fff}h1{color:#00D4A0;font-size:24px;margin-bottom:8px}p{color:#8BA89C;font-size:15px}</style>
</head>
<body><h1>Accounts Connected!</h1><p>You can close this page and return to Thrive.</p></body>
</html>`);
  });

  // ── AI Chat ───────────────────────────────────────────────────────────────

  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const stream = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        stream: true,
        max_completion_tokens: 8192,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      if (!res.headersSent) res.status(500).json({ error: "Chat failed" });
      else { res.write(`data: ${JSON.stringify({ error: "Chat failed" })}\n\n`); res.end(); }
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

function mapPlaidType(type: string, subtype: string | null | undefined): string {
  if (type === "credit") return "credit";
  if (subtype === "tfsa") return "tfsa";
  if (subtype === "rrsp") return "rrsp";
  if (subtype === "savings") return "savings";
  if (subtype === "checking") return "chequing";
  if (type === "investment") return "investment";
  return "chequing";
}

function typeColor(type: string): string {
  const colors: Record<string, string> = {
    chequing: "#00D4A0", savings: "#F5C842", tfsa: "#32C86E",
    rrsp: "#6EDDA0", fhsa: "#4FC3F7", resp: "#CE93D8",
    investment: "#FFB74D", credit: "#FF5252",
  };
  return colors[type] || "#00D4A0";
}

function mapPlaidCategory(cat: string): string {
  const map: Record<string, string> = {
    FOOD_AND_DRINK: "Dining", GROCERIES: "Groceries", TRANSPORTATION: "Transport",
    ENTERTAINMENT: "Entertainment", SHOPPING: "Shopping", UTILITIES: "Utilities",
    HEALTH_WELLNESS: "Health", INCOME: "Income", TRANSFER_IN: "Income",
    TRAVEL: "Travel", RENT: "Housing", HOME_IMPROVEMENT: "Housing",
  };
  return map[cat] || "Other";
}
