import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import OpenAI from "openai";

// Simple in-memory rate limiter (resets on cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) { rateLimitMap.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

const CATEGORIES = [
  "Groceries","Dining","Coffee","Transport","Shopping","Clothing",
  "Housing","Utilities","Insurance","Childcare","Pets",
  "Health","Fitness","Personal Care",
  "Entertainment","Travel","Subscriptions","Alcohol","Gifts",
  "Income","Investments","Taxes","Education","Electronics","Other",
];

// Extract year from statement period line if present
// Matches: "From April 17, 2025 to May 16, 2025" or "For the period ending January 31, 2022"
function extractStatementYear(text: string): number {
  const periodMatch = text.match(/(?:from|for the period|ending|statement date)[^\n]*\b(20\d{2})\b/i)
  if (periodMatch) {
    const year = parseInt(periodMatch[1])
    console.log(`Detected statement year from period header: ${year}`)
    return year
  }
  const anyYearMatch = text.match(/\b(20\d{2})\b/)
  if (anyYearMatch) {
    const year = parseInt(anyYearMatch[1])
    console.log(`Detected statement year from first year found: ${year}`)
    return year
  }
  const fallback = new Date().getFullYear()
  console.log(`No year found in statement — falling back to current year: ${fallback}`)
  return fallback
}

function isPageBoilerplate(line: string): boolean {
  const t = line.trim()
  if (!t || t.length < 2) return true

  return (
    // Page number indicators: "2 of 6", "Page 2 of 6", "- 2 -"
    /^-?\s*\d+\s*-?$/.test(t) ||
    /^page\s+\d+/i.test(t) ||
    /^\d+\s+of\s+\d+$/i.test(t) ||

    // Statement period headers: "From April 17, 2025 to May 16, 2025"
    /^from\s+\w+\s+\d/i.test(t) ||
    /^for\s+the\s+period/i.test(t) ||
    /^statement\s+(period|date|for)/i.test(t) ||
    /^account\s+activity/i.test(t) ||

    // Column headers (any line that looks like a table header with $ symbols or "Withdrawals"/"Deposits"/"Balance")
    /withdrawals?.*deposits?/i.test(t) ||
    /debits?.*credits?/i.test(t) ||
    /date.*description.*balance/i.test(t) ||
    /^DateDescription/i.test(t) ||

    // "Continued" markers
    /continued$/i.test(t) ||
    /^-+\s*continued/i.test(t) ||

    // Bank name + "personal/business banking" lines that repeat on each page
    /personal\s+banking/i.test(t) ||
    /business\s+banking/i.test(t) ||

    // Internal reference codes with dashes/underscores — "RBPDA10020_5783883_016- 0077967 8732"
    /^[A-Z0-9]{4,}[_-][A-Z0-9]/.test(t) ||

    // Internal bank reference codes: long alphanumeric strings with no spaces that aren't transaction descriptions
    // (8+ chars, all uppercase letters and digits, no spaces — these are batch/file reference codes)
    /^[A-Z0-9]{8,}$/.test(t) ||

    // Account summary lines that repeat on each page
    /^(total\s+)?(deposits|withdrawals|debits|credits)\s+(into|from|to)/i.test(t) ||
    /^(opening|closing)\s+balance/i.test(t) ||
    /^your\s+(opening|closing)/i.test(t) ||

    // Bank address/contact boilerplate
    /^(P\.?O\.?\s*Bag|P\.?O\.?\s*Box)\s+\d/i.test(t) ||
    /^1-8(00|88)-\d{3}/i.test(t) ||   // toll-free numbers
    /^www\./i.test(t) ||               // website URLs
    /^@/i.test(t) ||                   // social handles

    // Lines that are purely noise after PDF extraction
    /^[\W_]+$/.test(t) ||              // only punctuation/symbols
    /^\*+\d+\*+$/.test(t)             // *35000000* style reference codes
  )
}

function preprocessStatementText(text: string): string {
  const lines = text.split('\n')

  const DATE_PATTERN = /^(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\s*/i
  const BMO_DATE_PATTERN = /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{2}/i
  const HAS_AMOUNT = /[\d,]+\.\d{2}/

  const linesWithDates = lines.filter(l => DATE_PATTERN.test(l.trim()) || BMO_DATE_PATTERN.test(l.trim())).length
  if (linesWithDates > lines.length * 0.3) {
    console.log('Statement format: date-per-line (no preprocessing needed)')
    return text
  }

  console.log('Statement format: RBC-style date inheritance — preprocessing to add dates to dateless lines')

  // Pre-pass: strip all non-transaction lines before date inheritance
  // This must run FIRST — boilerplate on page 2+ has no date, so it must be
  // removed before the date inheritance loop or it will absorb the current date
  const transactionLines = lines.filter(line => {
    const t = line.trim()
    return t.length > 1 && !isPageBoilerplate(t)
  })

  // Truncate the pre-transaction header block (bank address, account holder name, etc.)
  // Everything before the first dated transaction line is useless to GPT-4o and
  // causes hallucinations — GPT-4o invents transactions from header text.
  const firstDateIndex = transactionLines.findIndex(line =>
    DATE_PATTERN.test(line.trim()) || BMO_DATE_PATTERN.test(line.trim())
  )
  // Keep a small window before the first date for context (e.g. column headers)
  // but drop the full page header block
  const contextStart = Math.max(0, firstDateIndex - 3)
  const trimmedLines = firstDateIndex > 5
    ? transactionLines.slice(contextStart)
    : transactionLines

  // Pass 1: inherit dates (now runs on clean lines only)
  let currentDate = ''
  const dated: string[] = []

  for (const raw of trimmedLines) {
    const line = raw.trim()
    if (!line) continue

    const dateMatch = line.match(DATE_PATTERN)
    if (dateMatch) {
      currentDate = dateMatch[1]
      dated.push(line)
    } else if (currentDate) {
      dated.push(`${currentDate} ${line}`)
    } else {
      dated.push(line)
    }
  }

  // Pass 2: merge two-line transactions
  // RBC pattern: line 1 has a date but no amount (description only)
  //              line 2 has the same date and the amount (merchant continuation + amount)
  // These must be combined into one line before GPT-4o sees them
  const merged: string[] = []
  let i = 0
  while (i < dated.length) {
    const line = dated[i]
    const dateMatch = line.match(DATE_PATTERN)

    if (dateMatch && !HAS_AMOUNT.test(line)) {
      // Line has a date but no amount — look ahead for the continuation
      const next = dated[i + 1]
      if (next && HAS_AMOUNT.test(next)) {
        // Strip the date prefix from the next line and append it to this one
        const nextContent = next.replace(DATE_PATTERN, '').trim()
        merged.push(`${line.trim()} ${nextContent}`)
        i += 2
        continue
      }
    }
    merged.push(line)
    i++
  }

  // Pass 3: separate concatenated amounts from description text
  // Handles letter-before: "Muffler1,921.48" → "Muffler 1,921.48"
  // Handles digit-before:  "SE7KN7100.00"   → "SE7KN7 100.00"
  // Safety: only matches amounts ≥ 0.01 with exactly 2 decimal places
  // to avoid splitting inside legitimate numbers like account numbers
  const normalized = merged.map(line => {
    if (!DATE_PATTERN.test(line)) return line
    return line.replace(/([A-Za-z0-9])(\d{1,3}(?:,\d{3})*\.\d{2})(?!\d)/g, (_match, before, amount) => {
      return `${before} ${amount}`
    })
  })

  // Pass 4: strip running balance glued to end of transaction amount
  // Only strip when: amount + optional whitespace + optional minus + amount at end of line
  // Be conservative — only match when there's a clear second amount immediately after the first
  const stripped = normalized.map(line => {
    if (!DATE_PATTERN.test(line)) return line
    // Match: digits.digits followed immediately (no space) by digits.digits at end of line
    // e.g. "100.00408.36" or "100.00-141.64" but NOT "100.00 - 141.64" (already separated)
    return line
      .replace(/(\d+\.\d{2})-?\s*\d{1,3}(?:,\d{3})*\.\d{2}\s*$/, '$1')
      .trim()
  })

  const result = stripped.join('\n')
  console.log(`Preprocessing: ${lines.length} lines → ${stripped.length} lines`)
  return result
}

function buildPrompt(year: number) {
  return `You are a Canadian bank statement parser. Extract transactions ONLY from the text below — do not invent, guess, or add any transaction that is not explicitly present in the text.

STRICT RULES:
- Output ONLY transactions that appear word-for-word in the provided text.
- If the text contains no transactions (e.g. it's a page header, footer, or summary), return {"transactions":[]}.
- Do NOT fabricate, hallucinate, or fill in any data.
- Skip: opening/closing balance, running balance, totals, subtotals, page numbers, headers, account info, interest summaries.
- If a line has no clear merchant name and dollar amount, skip it.
- If the same amount appears twice on the same date, include it twice.
- If you see multiple lines with the same merchant name and amount on the same date, they are SEPARATE transactions — include every single one. e-Transfers and Interac transactions frequently repeat. The reference code at the end of each line is what makes them distinct.

For each real transaction output:
- "date": ISO date string (YYYY-MM-DD). If year is missing use ${year}.
- "description": the transaction description only — do NOT include the dollar amount in the description field. The amount belongs only in the "amount" field. Strip any trailing number that is the transaction amount. Keep ALL reference codes, confirmation numbers, and suffixes (e.g. "e-Transfer Request Fulfilled Payper Inc. MLHYMQ", "e-Transfer sent roo GRD7AP") — these codes make each transaction unique. Only trim leading/trailing whitespace.
- "amount": number. Apply these Canadian e-Transfer direction rules exactly:
  - "e-Transfer sent [name]" → NEGATIVE (you sent money out)
  - "e-Transfer Request Fulfilled [name]" → NEGATIVE (someone requested money from you, you paid it — this is NOT income)
  - "e-Transfer received [name]" → POSITIVE (someone sent money to you)
  - "Payroll Deposit" → POSITIVE (income received)
  - "ATM deposit" → POSITIVE (deposit into account)
  - "Contactless Interac purchase" / "Interac purchase" → NEGATIVE (spending)
  - "Business PAD" → NEGATIVE (pre-authorized debit, money leaving)
  - "Loan [reference code]" → NEGATIVE (loan payment going out)
  - All other purchases, withdrawals, fees → NEGATIVE
  - All other deposits, credits, refunds → POSITIVE
- "category": one of: ${CATEGORIES.join(", ")}

Category hints: Tim Hortons/Starbucks/Second Cup → Coffee, Netflix/Spotify/Disney → Subscriptions, Uber/TTC/Presto → Transport, Loblaws/Metro/Sobeys/No Frills → Groceries, Amazon/Walmart/Best Buy → Shopping, PAYMENT/ONLINE PAYMENT → Other (positive amount).

Return ONLY valid JSON:
{"transactions":[{"date":"YYYY-MM-DD","description":"...","amount":-12.50,"category":"Dining","rawLine":"exact input line"},...]}`;
}

function extractTransactions(raw: string): any[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.transactions)) return parsed.transactions;
  } catch {}
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
  return [];
}

async function runGpt(openai: OpenAI, text: string, year: number): Promise<any[]> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "You are a precise bank statement parser. You extract transactions exactly as they appear — never invent data. If a section has no transactions, return an empty array.",
      },
      { role: "user", content: `${buildPrompt(year)}\n\nStatement text:\n${text}` },
    ],
    max_completion_tokens: 16000,
    temperature: 0,
  });
  const raw = completion.choices[0]?.message?.content ?? ""
  return extractTransactions(raw);
}

export const parseStatement = onRequest(
  { timeoutSeconds: 300, memory: "1GiB", region: "us-central1", cors: false },
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
    let uid: string;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: "Invalid token" }); return;
    }

    // FIX 5 — Rate limiting: 5 requests per minute per user
    if (!checkRateLimit(`parseStatement:${uid}`, 5, 60 * 1000)) {
      res.status(429).json({ error: "Too many requests. Please wait before uploading another statement." }); return;
    }

    const { text, pdfBase64 } = req.body;
    if (!text && !pdfBase64) {
      res.status(400).json({ error: "No statement content provided" }); return;
    }

    // FIX 13 — Request size limits
    const MAX_PDF_B64 = 20 * 1024 * 1024; // 20MB base64 (~15MB PDF)
    const MAX_TEXT = 500 * 1024; // 500KB text
    if (pdfBase64 && typeof pdfBase64 === "string" && pdfBase64.length > MAX_PDF_B64) {
      res.status(413).json({ error: "PDF too large. Maximum size is 15MB." }); return;
    }
    if (text && typeof text === "string" && text.length > MAX_TEXT) {
      res.status(413).json({ error: "Text too large. Maximum size is 500KB." }); return;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    try {
      let statementText: string;

      if (pdfBase64) {
        // Lazy require inside handler — avoids Firebase CLI module-load crash
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfParseModule = require("pdf-parse");
        const pdfParse = pdfParseModule.default ?? pdfParseModule;
        const buffer = Buffer.from(pdfBase64 as string, "base64");

        // FIX 14 — Validate PDF magic bytes (%PDF)
        if (buffer.length < 4 || buffer.toString("ascii", 0, 4) !== "%PDF") {
          res.status(400).json({ error: "Invalid file format. Only PDF files are accepted." });
          return;
        }
        const data = await pdfParse(buffer);
        statementText = data.text as string;

        if (!statementText || statementText.trim().length < 20) {
          res.status(400).json({ error: "Could not extract text from PDF. Try exporting as CSV instead." });
          return;
        }
        console.log(`PDF extracted: ${statementText.length} chars`);
      } else {
        statementText = text as string;
      }

      // Extract year from raw text before preprocessing strips the period header line
      const year = extractStatementYear(statementText);
      statementText = preprocessStatementText(statementText);
      console.log(`After preprocessing: ${statementText.length} chars`);

      const allTransactions: any[] = [];
      const MAX_SINGLE = 60000;

      console.log(`Text: ${statementText.length} chars`);

      if (statementText.length <= MAX_SINGLE) {
        const txs = await runGpt(openai, statementText, year);
        console.log(`Single call: ${txs.length} transactions`);
        allTransactions.push(...txs);
      } else {
        const CHUNK = 15000;
        const OVERLAP_LINES = 15;
        const lines = statementText.split("\n").filter((l) => l.trim().length > 0);
        const chunks: string[] = [];
        let chunkLines: string[] = [];
        for (const line of lines) {
          chunkLines.push(line);
          if (chunkLines.join("\n").length >= CHUNK) {
            chunks.push(chunkLines.join("\n"));
            chunkLines = chunkLines.slice(-OVERLAP_LINES);
          }
        }
        if (chunkLines.length > 0) chunks.push(chunkLines.join("\n"));
        console.log(`Chunked into ${chunks.length} segments`);
        for (let i = 0; i < chunks.length; i++) {
          const txs = await runGpt(openai, chunks[i], year);
          console.log(`Chunk ${i + 1}: ${txs.length} transactions`);
          allTransactions.push(...txs);
        }
      }

      // Log only transactions with amounts that match known balance column artifacts
      const suspiciousAmounts = [930, 969, 720, 650, 425, 350, 370, 730, 950, 630, 625, 320, 450]
      allTransactions.forEach(t => {
        const absAmt = Math.abs(Number(t.amount))
        if (suspiciousAmounts.some(s => Math.abs(s - absAmt) < 0.5)) {
          console.warn(`SUSPICIOUS TRANSACTION: ${t.date} | ${t.amount} | "${t.description}" | raw: "${t.rawLine ?? 'none'}"`)
        }
      })

      const DATE_IN_RAW = /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{2})\b/i

      // Deduplicate — normalize case, whitespace, and round cents to handle overlap duplicates
      const seen = new Set<string>();
      const result = allTransactions
        .filter((t) => t.date && t.description && typeof t.amount === "number")
        .filter((t) => {
          // Drop transactions where rawLine exists but contains no date — likely a hallucination
          if (t.rawLine && !DATE_IN_RAW.test(t.rawLine)) {
            console.warn(`Dropping likely hallucination — rawLine has no date: "${t.rawLine}"`)
            return false
          }
          return true
        })
        .filter((t) => {
          const desc = String(t.description).trim().toLowerCase().replace(/\s+/g, " ");
          const amt = Math.round(Number(t.amount) * 100);
          const key = `${t.date}|${desc}|${amt}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((t) => ({
          date: String(t.date),
          description: String(t.description).trim(),
          amount: Number(t.amount),
          category: CATEGORIES.includes(t.category) ? t.category : "Other",
        }));

      res.json({ transactions: result });
    } catch (err: any) {
      console.error("parseStatement error:", err?.message ?? err);
      res.status(500).json({ error: err?.message ?? "Failed to parse statement" });
    }
  }
);
