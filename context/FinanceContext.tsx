import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import { getApiUrl } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: "chequing" | "savings" | "tfsa" | "rrsp" | "fhsa" | "resp" | "investment" | "credit";
  balance: number;
  currency: "CAD";
  color: string;
  lastUpdated: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  merchant?: string;
}

export interface Budget {
  category: string;
  limit: number;
  spent: number;
}

interface FinanceContextValue {
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  monthlyIncome: number;
  addAccount: (account: Omit<Account, "id" | "lastUpdated" | "currency">) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  addTransaction: (tx: Omit<Transaction, "id">) => Promise<void>;
  updateTransaction: (id: string, tx: Partial<Omit<Transaction, "id">>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  setBudgets: (budgets: Budget[]) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  monthlyExpenses: number;
  isLoaded: boolean;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

function normalizeAccount(row: any): Account {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    type: row.type,
    balance: parseFloat(row.balance),
    currency: "CAD",
    color: row.color,
    lastUpdated: row.last_updated || new Date().toISOString(),
  };
}

function normalizeTx(row: any): Transaction {
  return {
    id: row.id,
    accountId: row.account_id || "",
    date: typeof row.date === "string" ? row.date.split("T")[0] : new Date(row.date).toISOString().split("T")[0],
    description: row.description,
    amount: parseFloat(row.amount),
    category: row.category,
    merchant: row.merchant || undefined,
  };
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgetsState] = useState<Budget[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const apiHeaders = useCallback(() => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  const base = getApiUrl();

  const fetchAll = useCallback(async () => {
    if (!token) {
      setAccounts([]);
      setTransactions([]);
      setBudgetsState([]);
      setIsLoaded(true);
      return;
    }
    try {
      const [accResp, txResp, budResp] = await Promise.all([
        fetch(`${base}api/accounts`, { headers: apiHeaders() }),
        fetch(`${base}api/transactions`, { headers: apiHeaders() }),
        fetch(`${base}api/budgets`, { headers: apiHeaders() }),
      ]);
      if (accResp.ok) {
        const data = await accResp.json();
        setAccounts(data.map(normalizeAccount));
      }
      if (txResp.ok) {
        const data = await txResp.json();
        setTransactions(data.map(normalizeTx));
      }
      if (budResp.ok) {
        const data = await budResp.json();
        const cats = ["Groceries", "Dining", "Transport", "Entertainment", "Shopping", "Utilities", "Health"];
        const serverBudgets: Budget[] = data.map((b: any) => ({
          category: b.category,
          limit: parseFloat(b.limit_amount),
          spent: 0,
        }));
        setBudgetsState(serverBudgets);
      }
    } catch (err) {
      console.error("Failed to fetch finance data:", err);
    }
    setIsLoaded(true);
  }, [token, base]);

  useEffect(() => {
    setIsLoaded(false);
    fetchAll();
  }, [fetchAll]);

  const budgetsWithSpent = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthTxs = transactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.amount < 0;
    });
    return budgets.map((b) => ({
      ...b,
      spent: Math.abs(monthTxs.filter((t) => t.category === b.category).reduce((s, t) => s + t.amount, 0)),
    }));
  }, [budgets, transactions]);

  const addAccount = useCallback(async (account: Omit<Account, "id" | "lastUpdated" | "currency">) => {
    const resp = await fetch(`${base}api/accounts`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        name: account.name,
        institution: account.institution,
        type: account.type,
        balance: account.balance,
        color: account.color,
      }),
    });
    if (!resp.ok) throw new Error("Failed to add account");
    const newAcc = await resp.json();
    setAccounts((prev) => [...prev, normalizeAccount(newAcc)]);
  }, [base, apiHeaders]);

  const removeAccount = useCallback(async (id: string) => {
    await fetch(`${base}api/accounts/${id}`, { method: "DELETE", headers: apiHeaders() });
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }, [base, apiHeaders]);

  const addTransaction = useCallback(async (tx: Omit<Transaction, "id">) => {
    const resp = await fetch(`${base}api/transactions`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        account_id: tx.accountId || null,
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        category: tx.category,
        merchant: tx.merchant || null,
      }),
    });
    if (!resp.ok) throw new Error("Failed to add transaction");
    const newTx = await resp.json();
    setTransactions((prev) => [normalizeTx(newTx), ...prev]);
  }, [base, apiHeaders]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Omit<Transaction, "id">>) => {
    const existing = transactions.find((t) => t.id === id);
    if (!existing) return;
    const merged = { ...existing, ...updates };
    const resp = await fetch(`${base}api/transactions/${id}`, {
      method: "PUT",
      headers: apiHeaders(),
      body: JSON.stringify({
        description: merged.description,
        amount: merged.amount,
        category: merged.category,
        merchant: merged.merchant || null,
        date: merged.date,
      }),
    });
    if (!resp.ok) throw new Error("Failed to update transaction");
    const updated = await resp.json();
    setTransactions((prev) => prev.map((t) => t.id === id ? normalizeTx(updated) : t));
  }, [base, apiHeaders, transactions]);

  const deleteTransaction = useCallback(async (id: string) => {
    await fetch(`${base}api/transactions/${id}`, { method: "DELETE", headers: apiHeaders() });
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, [base, apiHeaders]);

  const handleSetBudgets = useCallback(async (newBudgets: Budget[]) => {
    await fetch(`${base}api/budgets`, {
      method: "PUT",
      headers: apiHeaders(),
      body: JSON.stringify({ budgets: newBudgets.map((b) => ({ category: b.category, limit_amount: b.limit })) }),
    });
    setBudgetsState(newBudgets);
  }, [base, apiHeaders]);

  const refreshAccounts = useCallback(() => fetchAll(), [fetchAll]);

  const netWorth = useMemo(() => accounts.reduce((s, a) => s + a.balance, 0), [accounts]);
  const totalAssets = useMemo(() => accounts.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0), [accounts]);
  const totalLiabilities = useMemo(() => Math.abs(accounts.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0)), [accounts]);

  const now = new Date();
  const cm = now.getMonth();
  const cy = now.getFullYear();

  const monthlyIncome = useMemo(() => {
    const serverIncome = user?.monthly_income ?? 0;
    const txIncome = transactions
      .filter((t) => { const d = new Date(t.date); return d.getMonth() === cm && d.getFullYear() === cy && t.amount > 0; })
      .reduce((s, t) => s + t.amount, 0);
    return serverIncome > 0 ? serverIncome : txIncome;
  }, [transactions, user, cm, cy]);

  const monthlyExpenses = useMemo(() =>
    Math.abs(transactions
      .filter((t) => { const d = new Date(t.date); return d.getMonth() === cm && d.getFullYear() === cy && t.amount < 0; })
      .reduce((s, t) => s + t.amount, 0)),
    [transactions, cm, cy]);

  const value = useMemo(() => ({
    accounts,
    transactions,
    budgets: budgetsWithSpent,
    monthlyIncome,
    addAccount,
    removeAccount,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    setBudgets: handleSetBudgets,
    refreshAccounts,
    netWorth,
    totalAssets,
    totalLiabilities,
    monthlyExpenses,
    isLoaded,
  }), [accounts, transactions, budgetsWithSpent, monthlyIncome, addAccount, removeAccount, addTransaction, updateTransaction, deleteTransaction, handleSetBudgets, refreshAccounts, netWorth, totalAssets, totalLiabilities, monthlyExpenses, isLoaded]);

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance() {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error("useFinance must be used within FinanceProvider");
  return ctx;
}
