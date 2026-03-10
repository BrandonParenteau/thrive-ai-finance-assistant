import type { Express } from "express";
import { createServer, type Server } from "node:http";
import crypto from "node:crypto";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "./db";
import { PlaidApi, PlaidEnvironments, Configuration, Products, CountryCode } from "plaid";
import { z } from "zod";
import rateLimit from "express-rate-limit";

// ── Startup validation — crash immediately if critical secrets are missing ──

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) throw new Error("SESSION_SECRET environment variable is required. Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"");

const ENCRYPTION_KEY_HEX = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY_HEX) throw new Error("ENCRYPTION_KEY environment variable is required. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
if (ENCRYPTION_KEY_HEX.length !== 64) throw new Error("ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, "hex");

// ── Encryption helpers for Plaid access tokens ────────────────────────────

function encryptToken(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  const encrypted = cipher.update(text, "utf8", "hex") + cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decryptToken(encrypted: string): string {
  const [ivHex, data] = encrypted.split(":");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, Buffer.from(ivHex, "hex"));
  return decipher.update(data, "hex", "utf8") + decipher.final("utf8");
}

// ── OpenAI ────────────────────────────────────────────────────────────────

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ── Plaid ─────────────────────────────────────────────────────────────────

const PLAID_CONFIGURED = !!process.env.PLAID_CLIENT_ID && !!process.env.PLAID_SECRET;

let plaidClient: PlaidApi | null = null;
if (PLAID_CONFIGURED) {
  const plaidEnv = (process.env.PLAID_ENV || "sandbox").trim().toLowerCase();
  console.log(`Plaid initializing with environment: ${plaidEnv}`);
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

// ── Auth middleware ───────────────────────────────────────────────────────

function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET!) as any;
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ── Rate limiters ─────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "Too many attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: "Too many messages. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

const plaidLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many Plaid requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Validation schemas ────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email("Invalid email address").max(255),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be under 128 characters"),
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

const profileSchema = z.object({
  monthly_income: z.number().positive().finite().optional(),
  onboarding_complete: z.boolean().optional(),
});

const createAccountSchema = z.object({
  name: z.string().min(1).max(100),
  institution: z.string().min(1).max(100),
  type: z.enum(["chequing", "savings", "tfsa", "rrsp", "fhsa", "resp", "investment", "credit"]),
  balance: z.number().finite(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const createTransactionSchema = z.object({
  account_id: z.string().max(100).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
  description: z.string().min(1).max(255),
  amount: z.number().finite(),
  category: z.string().max(50).optional(),
  merchant: z.string().max(255).optional().nullable(),
});

const updateTransactionSchema = z.object({
  description: z.string().min(1).max(255),
  amount: z.number().finite(),
  category: z.string().max(50),
  merchant: z.string().max(255).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
});

const budgetSchema = z.object({
  budgets: z.array(z.object({
    category: z.string().min(1).max(50),
    limit_amount: z.number().positive().finite(),
  })).max(50),
});

// ── AI System prompt ──────────────────────────────────────────────────────

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

  app.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
      const result = registerSchema.safeParse(req.body);
      if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });
      const { email, password } = result.data;

      const existing = await query("SELECT id FROM thrive_users WHERE email = $1", [email.toLowerCase()]);
      if (existing.length > 0) return res.status(409).json({ error: "An account with this email already exists" });

      const hash = await bcrypt.hash(password, 12);
      const users = await query(
        "INSERT INTO thrive_users (email, password_hash) VALUES ($1, $2) RETURNING id, email, monthly_income, onboarding_complete",
        [email.toLowerCase(), hash]
      );
      const user = users[0];
      const token = jwt.sign({ userId: user.id }, JWT_SECRET!, { expiresIn: "7d" });
      res.status(201).json({ token, user });
    } catch (err) {
      console.error("Register error");
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const result = loginSchema.safeParse(req.body);
      if (!result.success) return res.status(400).json({ error: "Invalid email or password" });
      const { email, password } = result.data;

      const users = await query(
        "SELECT id, email, password_hash, monthly_income, onboarding_complete FROM thrive_users WHERE email = $1",
        [email.toLowerCase()]
      );

      // Constant-time comparison — always run bcrypt even if user doesn't exist
      // to prevent user enumeration via timing attacks
      const dummyHash = "$2a$12$dummy.hash.to.prevent.timing.attacks.padding.padding";
      const hash = users.length > 0 ? (users[0] as any).password_hash : dummyHash;
      const valid = await bcrypt.compare(password, hash);

      if (users.length === 0 || !valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const user = users[0] as any;
      const token = jwt.sign({ userId: user.id }, JWT_SECRET!, { expiresIn: "7d" });
      res.json({ token, user: { id: user.id, email: user.email, monthly_income: user.monthly_income, onboarding_complete: user.onboarding_complete } });
    } catch (err) {
      console.error("Login error");
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
      const result = profileSchema.safeParse(req.body);
      if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });
      const { monthly_income, onboarding_complete } = result.data;

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
      console.error("Profile update error");
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.put("/api/auth/password", authMiddleware, async (req: any, res) => {
    try {
      const { current_password, new_password } = req.body;
      if (!current_password || !new_password) return res.status(400).json({ error: "Both current and new password are required" });
      if (new_password.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });

      const users = await query("SELECT password_hash FROM thrive_users WHERE id = $1", [req.userId]);
      if (users.length === 0) return res.status(404).json({ error: "User not found" });

      const valid = await bcrypt.compare(current_password, (users[0] as any).password_hash);
      if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

      const hash = await bcrypt.hash(new_password, 12);
      await query("UPDATE thrive_users SET password_hash = $1 WHERE id = $2", [hash, req.userId]);
      res.json({ success: true });
    } catch (err) {
      console.error("Password change error");
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // Account deletion — PIPEDA compliance
  app.delete("/api/auth/account", authMiddleware, async (req: any, res) => {
    try {
      // Revoke all Plaid items first
      if (plaidClient) {
        const items = await query("SELECT * FROM thrive_plaid_items WHERE user_id = $1", [req.userId]);
        for (const item of items as any[]) {
          try {
            await plaidClient.itemRemove({ access_token: decryptToken(item.access_token) });
          } catch { /* best effort */ }
        }
      }
      // Delete all user data
      await query("DELETE FROM thrive_transactions WHERE user_id = $1", [req.userId]);
      await query("DELETE FROM thrive_user_budgets WHERE user_id = $1", [req.userId]);
      await query("DELETE FROM thrive_accounts WHERE user_id = $1", [req.userId]);
      await query("DELETE FROM thrive_plaid_items WHERE user_id = $1", [req.userId]);
      await query("DELETE FROM thrive_plaid_sessions WHERE user_id = $1", [req.userId]);
      await query("DELETE FROM thrive_users WHERE id = $1", [req.userId]);
      res.json({ success: true });
    } catch (err) {
      console.error("Account deletion error");
      res.status(500).json({ error: "Failed to delete account" });
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
      const result = createAccountSchema.safeParse(req.body);
      if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });
      const { name, institution, type, balance, color } = result.data;

      const id = `acc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const accounts = await query(
        "INSERT INTO thrive_accounts (id, user_id, name, institution, type, balance, color) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [id, req.userId, name, institution, type, balance, color || "#00D4A0"]
      );
      res.status(201).json(accounts[0]);
    } catch (err) {
      console.error("Add account error");
      res.status(500).json({ error: "Failed to add account" });
    }
  });

  app.delete("/api/accounts/:id", authMiddleware, async (req: any, res) => {
    try {
      // Validate ID format to prevent path traversal
      if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
        return res.status(400).json({ error: "Invalid account ID" });
      }
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
      const result = createTransactionSchema.safeParse(req.body);
      if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });
      const { account_id, date, description, amount, category, merchant } = result.data;

      const id = `tx_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const txs = await query(
        "INSERT INTO thrive_transactions (id, user_id, account_id, date, description, amount, category, merchant) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [id, req.userId, account_id || null, date, description, amount, category || "Other", merchant || null]
      );
      res.status(201).json(txs[0]);
    } catch (err) {
      console.error("Add tx error");
      res.status(500).json({ error: "Failed to add transaction" });
    }
  });

  app.put("/api/transactions/:id", authMiddleware, async (req: any, res) => {
    try {
      if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
        return res.status(400).json({ error: "Invalid transaction ID" });
      }
      const result = updateTransactionSchema.safeParse(req.body);
      if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });
      const { description, amount, category, merchant, date } = result.data;

      const txs = await query(
        `UPDATE thrive_transactions SET description=$1, amount=$2, category=$3, merchant=$4, date=$5 WHERE id=$6 AND user_id=$7 RETURNING *`,
        [description, amount, category, merchant || null, date, req.params.id, req.userId]
      );
      if (txs.length === 0) return res.status(404).json({ error: "Transaction not found" });
      res.json(txs[0]);
    } catch (err) {
      console.error("Update tx error");
      res.status(500).json({ error: "Failed to update transaction" });
    }
  });

  app.delete("/api/transactions/:id", authMiddleware, async (req: any, res) => {
    try {
      if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
        return res.status(400).json({ error: "Invalid transaction ID" });
      }
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
      const result = budgetSchema.safeParse(req.body);
      if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });

      for (const b of result.data.budgets) {
        await query(
          `INSERT INTO thrive_user_budgets (user_id, category, limit_amount) VALUES ($1,$2,$3)
           ON CONFLICT (user_id, category) DO UPDATE SET limit_amount = $3`,
          [req.userId, b.category, b.limit_amount]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Budgets update error");
      res.status(500).json({ error: "Failed to update budgets" });
    }
  });

  // ── Plaid ─────────────────────────────────────────────────────────────────

  app.post("/api/plaid/link-token", authMiddleware, plaidLimiter, async (req: any, res) => {
    if (!plaidClient) {
      return res.status(503).json({ error: "Plaid not configured." });
    }
    try {
      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: String(req.userId) },
        client_name: "Thrive",
        products: [Products.Transactions],
        country_codes: [CountryCode.Ca],
        language: "en",
        redirect_uri: (process.env.PLAID_REDIRECT_URI || process.env.PLAID_PRODUCTION_REDIRECT_URI) ?? undefined,
      });

      // Create a short-lived single-use session token — never expose JWT in URLs
      const sessionToken = crypto.randomBytes(32).toString("hex");
      await query(
        "INSERT INTO thrive_plaid_sessions (token, user_id, link_token, expires_at) VALUES ($1,$2,$3, NOW() + INTERVAL '10 minutes')",
        [sessionToken, req.userId, response.data.link_token]
      );

      res.json({ session_token: sessionToken });
    } catch (err: any) {
      console.error("Plaid link token error:", err?.response?.data?.error_code || "unknown");
      res.status(500).json({ error: "Failed to create Plaid link token" });
    }
  });

  app.post("/api/plaid/exchange-token", authMiddleware, plaidLimiter, async (req: any, res) => {
    if (!plaidClient) return res.status(503).json({ error: "Plaid not configured" });
    try {
      const { public_token, institution_name } = req.body;
      if (!public_token || typeof public_token !== "string") {
        return res.status(400).json({ error: "Missing public_token" });
      }

      const exchangeResp = await plaidClient.itemPublicTokenExchange({ public_token });
      const { access_token, item_id } = exchangeResp.data;

      // Encrypt access token before storing
      const encryptedToken = encryptToken(access_token);

      await query(
        "INSERT INTO thrive_plaid_items (user_id, access_token, item_id, institution_name) VALUES ($1,$2,$3,$4)",
        [req.userId, encryptedToken, item_id, institution_name || "Connected Bank"]
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
      console.error("Plaid exchange error:", err?.response?.data?.error_code || "unknown");
      res.status(500).json({ error: "Failed to exchange Plaid token" });
    }
  });

  app.post("/api/plaid/sync-transactions", authMiddleware, plaidLimiter, async (req: any, res) => {
    if (!plaidClient) return res.status(503).json({ error: "Plaid not configured" });
    try {
      const items = await query("SELECT * FROM thrive_plaid_items WHERE user_id = $1", [req.userId]);
      let totalSynced = 0;
      let totalInserted = 0;

      for (const item of items as any[]) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const accessToken = decryptToken(item.access_token);

        // Paginate through all transactions
        let offset = 0;
        const count = 250;
        let hasMore = true;

        while (hasMore) {
          const txResp = await plaidClient.transactionsGet({
            access_token: accessToken,
            start_date: startDate.toISOString().split("T")[0],
            end_date: new Date().toISOString().split("T")[0],
            options: { count, offset },
          });

          const { transactions, total_transactions } = txResp.data;
          console.log(`[sync] offset=${offset} fetched=${transactions.length} total=${total_transactions}`);

          for (const tx of transactions) {
            const amount = tx.amount * -1;
            const primary = tx.personal_finance_category?.primary || tx.category?.[0] || "Other";
            const detailed = tx.personal_finance_category?.detailed || tx.category?.[1] || "";
            const mappedCategory = mapPlaidCategory(primary, detailed);

            // Log anything that still falls to Other so we can improve mappings
            if (mappedCategory === "Other") {
              console.log(`[sync] unmapped category — primary="${primary}" detailed="${detailed}" merchant="${tx.merchant_name}" name="${tx.name}"`);
            }

            await query(
              `INSERT INTO thrive_transactions (id, user_id, account_id, date, description, amount, category, merchant, plaid_transaction_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (id) DO UPDATE SET amount=$6, category=$7, merchant=$8`,
              [`plaid_tx_${tx.transaction_id}`, req.userId, `plaid_${tx.account_id}`, tx.date, tx.name, amount, mappedCategory, tx.merchant_name || null, tx.transaction_id]
            );
            totalInserted++;
          }

          totalSynced += transactions.length;
          offset += transactions.length;
          hasMore = offset < total_transactions;
        }

        // Refresh account balances for this item
        const accountsResp = await plaidClient.accountsGet({ access_token: accessToken });
        for (const acc of accountsResp.data.accounts) {
          const balance = acc.balances.current ?? 0;
          await query(
            `UPDATE thrive_accounts SET balance=$1, last_updated=NOW() WHERE plaid_account_id=$2 AND user_id=$3`,
            [balance, acc.account_id, req.userId]
          );
        }
        console.log(`[sync] balances refreshed for ${accountsResp.data.accounts.length} accounts`);
      }

      console.log(`[sync] complete — fetched=${totalSynced} inserted/updated=${totalInserted}`);
      res.json({ success: true, synced: totalSynced });
    } catch (err: any) {
      const plaidError = err?.response?.data;
      console.error("Plaid sync error:", plaidError || err?.message || err);
      // Return meaningful error to client
      if (plaidError?.error_code === "PRODUCT_NOT_READY") {
        return res.status(202).json({ 
          success: false, 
          error: "Your bank is still preparing your transaction history. Please try again in a few minutes." 
        });
      }
      res.status(500).json({ error: "Failed to sync Plaid transactions" });
    }
  });

  // ── Plaid Link hosted page — uses session token, never JWT ───────────────

  app.get("/plaid-link", async (req, res) => {
    const { session } = req.query;
    if (!session || typeof session !== "string" || !/^[a-f0-9]{64}$/.test(session)) {
      return res.status(400).send(`Invalid or missing session token. Got: ${JSON.stringify(session)}`);
    }

    try {
      // Validate session token
      const sessions = await query(
        "SELECT * FROM thrive_plaid_sessions WHERE token = $1 AND expires_at > NOW()",
        [session]
      ) as any[];

      console.log(`[plaid-link] session lookup for token=${session.slice(0,8)}... found=${sessions.length} rows`);

      if (sessions.length === 0) {
        // Debug: check if token exists at all (ignoring expiry)
        const anySession = await query(
          "SELECT token, expires_at, NOW() as now FROM thrive_plaid_sessions WHERE token = $1",
          [session]
        ) as any[];
        console.log(`[plaid-link] token exists ignoring expiry: ${anySession.length > 0}`, anySession[0] || "not found");
        return res.status(400).send("Session expired or invalid. Please return to the app and try again.");
      }

      const { link_token, user_id } = sessions[0];

    res.setHeader("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self' https://cdn.plaid.com 'unsafe-inline'",
      "frame-src https://*.plaid.com https://plaid.com",
      "connect-src 'self' https://*.plaid.com https://plaid.com",
      "img-src 'self' https://*.plaid.com data:",
      "style-src 'self' 'unsafe-inline'",
    ].join("; "));
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
    const SESSION_TOKEN = ${JSON.stringify(session)};
    const LINK_TOKEN = ${JSON.stringify(link_token)};
    let handler;
    function openPlaid() {
      if (!handler) {
        document.getElementById('status').textContent = 'Initializing...';
        handler = Plaid.create({
          token: LINK_TOKEN,
          onSuccess: async function(public_token, metadata) {
            document.getElementById('status').textContent = 'Connecting your accounts...';
            document.getElementById('connectBtn').disabled = true;
            try {
              const resp = await fetch('/api/plaid/exchange-token-session', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({
                  session_token: SESSION_TOKEN,
                  public_token,
                  institution_name: metadata.institution?.name
                })
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
          onLoad: function() { document.getElementById('status').textContent = ''; }
        });
      }
      handler.open();
    }
    window.onload = function() { openPlaid(); };
  </script>
</body>
</html>`);
    } catch (err: any) {
      console.error("[plaid-link] unexpected error:", err?.message || err);
      res.status(500).send("An unexpected error occurred. Check server logs.");
    }
  });

  // Exchange token via session (no JWT in URL needed)
  app.post("/api/plaid/exchange-token-session", plaidLimiter, async (req, res) => {
    if (!plaidClient) return res.status(503).json({ error: "Plaid not configured" });
    try {
      const { session_token, public_token, institution_name } = req.body;
      if (!session_token || !public_token) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Validate and consume session token (single-use)
      const sessions = await query(
        "SELECT * FROM thrive_plaid_sessions WHERE token = $1 AND expires_at > NOW()",
        [session_token]
      ) as any[];

      if (sessions.length === 0) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      const userId = sessions[0].user_id;

      // Invalidate session immediately (single-use)
      await query("DELETE FROM thrive_plaid_sessions WHERE token = $1", [session_token]);

      const exchangeResp = await plaidClient.itemPublicTokenExchange({ public_token });
      const { access_token, item_id } = exchangeResp.data;

      const encryptedToken = encryptToken(access_token);
      await query(
        "INSERT INTO thrive_plaid_items (user_id, access_token, item_id, institution_name) VALUES ($1,$2,$3,$4)",
        [userId, encryptedToken, item_id, institution_name || "Connected Bank"]
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
          [id, userId, acc.name, institution_name || "Bank", type, balance, typeColor(type), acc.account_id]
        );
      }

      res.json({ success: true, accounts_synced: plaidAccounts.length });
    } catch (err: any) {
      console.error("Plaid session exchange error:", err?.response?.data?.error_code || "unknown");
      res.status(500).json({ error: "Failed to exchange Plaid token" });
    }
  });

  app.get("/plaid-done", (_req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><title>Connected — Thrive</title>
<style>body{background:#080F0C;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#fff}h1{color:#00D4A0;font-size:24px;margin-bottom:8px}p{color:#8BA89C;font-size:15px}</style>
</head>
<body><h1>Accounts Connected!</h1><p>You can close this page and return to Thrive.</p></body>
</html>`);
  });

  // ── AI Chat — authenticated + rate limited ────────────────────────────────

  app.post("/api/chat", authMiddleware, chatLimiter, async (req: any, res) => {
    try {
      const { messages } = req.body;
      if (!Array.isArray(messages) || messages.length > 50) {
        return res.status(400).json({ error: "Invalid messages" });
      }

      // Strip any system messages injected by client
      const sanitized = messages
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .slice(-20) // only last 20 messages for context window safety
        .map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content.slice(0, 4000) : "",
        }));

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

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
    } catch (error) {
      console.error("Chat error");
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

function mapPlaidCategory(primary: string, detailed?: string): string {
  // First try detailed category for more precision
  if (detailed) {
    const detailedMap: Record<string, string> = {
      // Food & Drink
      "FOOD_AND_DRINK_BEER_WINE_LIQUOR": "Alcohol",
      "FOOD_AND_DRINK_COFFEE": "Coffee",
      "FOOD_AND_DRINK_FAST_FOOD": "Dining",
      "FOOD_AND_DRINK_GROCERIES": "Groceries",
      "FOOD_AND_DRINK_RESTAURANT": "Dining",
      "FOOD_AND_DRINK_VENDING_MACHINES": "Dining",
      // Transport
      "TRANSPORTATION_GAS": "Transport",
      "TRANSPORTATION_PARKING": "Transport",
      "TRANSPORTATION_PUBLIC_TRANSIT": "Transport",
      "TRANSPORTATION_TAXIS": "Transport",
      "TRANSPORTATION_RIDE_SHARE": "Transport",
      "TRANSPORTATION_CAR_SERVICE": "Transport",
      // Shopping
      "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES": "Clothing",
      "GENERAL_MERCHANDISE_DEPARTMENT_STORES": "Shopping",
      "GENERAL_MERCHANDISE_DISCOUNT_STORES": "Shopping",
      "GENERAL_MERCHANDISE_ELECTRONICS": "Electronics",
      "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES": "Shopping",
      "GENERAL_MERCHANDISE_PET_SUPPLIES": "Pets",
      "GENERAL_MERCHANDISE_SPORTING_GOODS": "Fitness",
      "GENERAL_MERCHANDISE_SUPERSTORES": "Shopping",
      // Health
      "MEDICAL_DOCTOR_VISITS": "Health",
      "MEDICAL_DENTIST": "Health",
      "MEDICAL_EYE_CARE": "Health",
      "MEDICAL_PHARMACY": "Health",
      "MEDICAL_VETERINARY": "Pets",
      // Personal care
      "PERSONAL_CARE_HAIR_SALONS": "Personal Care",
      "PERSONAL_CARE_GYMS_AND_FITNESS": "Fitness",
      "PERSONAL_CARE_SPA_AND_MASSAGE": "Personal Care",
      // Entertainment
      "ENTERTAINMENT_CASINOS_AND_GAMBLING": "Entertainment",
      "ENTERTAINMENT_MUSIC_AND_AUDIO": "Subscriptions",
      "ENTERTAINMENT_SPORTING_EVENTS": "Entertainment",
      "ENTERTAINMENT_TV_AND_MOVIES": "Subscriptions",
      "ENTERTAINMENT_VIDEO_GAMES": "Entertainment",
      // Bills & Utilities
      "RENT_AND_UTILITIES_ELECTRICITY": "Utilities",
      "RENT_AND_UTILITIES_GAS": "Utilities",
      "RENT_AND_UTILITIES_INTERNET_AND_CABLE": "Utilities",
      "RENT_AND_UTILITIES_TELEPHONE": "Utilities",
      "RENT_AND_UTILITIES_WATER": "Utilities",
      "RENT_AND_UTILITIES_RENT": "Housing",
      // Home
      "HOME_IMPROVEMENT_FURNITURE": "Shopping",
      "HOME_IMPROVEMENT_HARDWARE": "Shopping",
      "HOME_IMPROVEMENT_HOME_SERVICES": "Housing",
      // Income
      "INCOME_DIVIDENDS": "Income",
      "INCOME_INTEREST_EARNED": "Income",
      "INCOME_RETIREMENT_PENSION": "Income",
      "INCOME_TAX_REFUND": "Income",
      "INCOME_WAGES": "Income",
      "INCOME_OTHER_INCOME": "Income",
      // Transfer
      "TRANSFER_IN_CASH_ADVANCES_AND_LOANS": "Income",
      "TRANSFER_IN_DEPOSIT": "Income",
      "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS": "Investments",
      "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS": "Investments",
      // Loan & insurance
      "LOAN_PAYMENTS_CAR_PAYMENT": "Transport",
      "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT": "Other",
      "LOAN_PAYMENTS_MORTGAGE_PAYMENT": "Housing",
      "LOAN_PAYMENTS_STUDENT_LOAN": "Education",
      "INSURANCE_AUTO_INSURANCE": "Insurance",
      "INSURANCE_HEALTH_INSURANCE": "Insurance",
      "INSURANCE_HOME_INSURANCE": "Insurance",
      "INSURANCE_LIFE_INSURANCE": "Insurance",
      // Travel
      "TRAVEL_FLIGHTS": "Travel",
      "TRAVEL_HOTELS_AND_MOTELS": "Travel",
      "TRAVEL_RENTAL_CARS": "Travel",
      "TRAVEL_VACATION_RENTALS": "Travel",
      // Government & taxes
      "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT": "Taxes",
      // Education
      "EDUCATION_COLLEGE_TUITION": "Education",
      "EDUCATION_BOOKS_AND_SUPPLIES": "Education",
    };
    const detailedKey = detailed.toUpperCase().replace(/ /g, "_");
    if (detailedMap[detailedKey]) return detailedMap[detailedKey];
  }

  // Fall back to primary category mapping
  const primaryMap: Record<string, string> = {
    // Plaid primary categories (new personal_finance_category format)
    "FOOD_AND_DRINK": "Dining",
    "GROCERIES": "Groceries",
    "TRANSPORTATION": "Transport",
    "TRAVEL": "Travel",
    "ENTERTAINMENT": "Entertainment",
    "GENERAL_MERCHANDISE": "Shopping",
    "CLOTHING_AND_ACCESSORIES": "Clothing",
    "PERSONAL_CARE": "Personal Care",
    "MEDICAL": "Health",
    "HEALTH_WELLNESS": "Health",
    "RENT_AND_UTILITIES": "Utilities",
    "HOME_IMPROVEMENT": "Housing",
    "INCOME": "Income",
    "TRANSFER_IN": "Income",
    "TRANSFER_OUT": "Other",
    "LOAN_PAYMENTS": "Housing",
    "INSURANCE": "Insurance",
    "GOVERNMENT_AND_NON_PROFIT": "Taxes",
    "EDUCATION": "Education",
    "GENERAL_SERVICES": "Other",
    "BANK_FEES": "Other",
    "ENTERTAINMENT_AND_RECREATION": "Entertainment",

    // Legacy Plaid category array format (tx.category[0])
    "Food and Drink": "Dining",
    "Shops": "Shopping",
    "Travel": "Travel",
    "Recreation": "Entertainment",
    "Healthcare": "Health",
    "Service": "Other",
    "Community": "Other",
    "Bank Fees": "Other",
    "Cash Advance": "Other",
    "Interest": "Other",
    "Payment": "Other",
    "Tax": "Taxes",
    "Transfer": "Other",
    "Deposit": "Income",
  };

  const key = primary?.trim();
  return primaryMap[key] || "Other";
}