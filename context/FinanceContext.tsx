import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { withRetry } from "@/utils/withRetry";
import toast from "@/utils/toast";
import { mapError } from "@/utils/errorMessages";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: "chequing" | "savings" | "tfsa" | "rrsp" | "fhsa" | "resp" | "investment" | "credit";
  balance: number;
  currency: "CAD";
  color: string;
  lastUpdated: string;
  plaidAccountId?: string;
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

export interface BudgetItem {
  id: string;
  categoryId: string;
  name: string;
  budgetedAmount: number;
  createdAt: number;
}

interface FinanceContextValue {
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  budgetItems: BudgetItem[];
  monthlyIncome: number;
  onboardingIncome: number;
  hasPlaidConnection: boolean;
  addAccount: (account: Omit<Account, "id" | "lastUpdated" | "currency">) => Promise<void>;
  updateAccount: (id: string, updates: Partial<Omit<Account, "id" | "currency">>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  addTransaction: (tx: Omit<Transaction, "id">) => Promise<void>;
  updateTransaction: (id: string, tx: Partial<Omit<Transaction, "id">>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  setBudgets: (budgets: Budget[]) => Promise<void>;
  addBudgetItem: (item: Omit<BudgetItem, "id" | "createdAt">) => Promise<void>;
  updateBudgetItem: (id: string, updates: Partial<Omit<BudgetItem, "id" | "createdAt">>) => Promise<void>;
  deleteBudgetItem: (id: string) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  monthlyExpenses: number;
  isLoaded: boolean;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

/** Sanitises a Firestore amount — returns 0 for null/undefined/NaN. */
function safeAmount(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/** Normalises a transaction category, falling back to "Other". */
function safeCategory(v: unknown): string {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return "Other";
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgetsState] = useState<Budget[]>([]);
  const [budgetItems, setBudgetItemsState] = useState<BudgetItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user) {
      setAccounts([]);
      setTransactions([]);
      setBudgetsState([]);
      setIsLoaded(true);
      return;
    }
    try {
      const userRef = doc(db, "users", user.id);
      const [userSnap, accSnap, txSnap] = await withRetry(() =>
        Promise.all([
          getDoc(userRef),
          getDocs(collection(db, "users", user.id, "accounts")),
          getDocs(collection(db, "users", user.id, "transactions")),
        ])
      );

      let budgetItemsSnap: Awaited<ReturnType<typeof getDocs>>;
      try {
        budgetItemsSnap = await getDocs(collection(db, "users", user.id, "budgetItems"));
      } catch {
        budgetItemsSnap = { docs: [] } as any;
      }

      if (userSnap.exists()) {
        const data = userSnap.data();
        const firestoreBudgets: Budget[] = (data.budgets ?? []).map((b: any) => ({
          category: safeCategory(b.category),
          limit: safeAmount(b.limit),
          spent: 0,
        }));
        setBudgetsState(firestoreBudgets);
      }

      setAccounts(accSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name ?? "Unnamed Account",
          institution: data.institution ?? "Unknown",
          type: data.type ?? "chequing",
          balance: safeAmount(data.balance),
          currency: "CAD",
          color: data.color ?? "#00D4A0",
          lastUpdated: data.lastUpdated || new Date().toISOString(),
          plaidAccountId: data.plaid_account_id || undefined,
        } as Account;
      }));

      setTransactions(txSnap.docs.map((d) => {
        const data = d.data();
        const rawDate = data.date;
        const dateStr =
          typeof rawDate === "string"
            ? rawDate.split("T")[0]
            : rawDate
            ? new Date(rawDate).toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0];
        return {
          id: d.id,
          accountId: data.accountId || "",
          date: dateStr,
          description: data.description ?? "",
          amount: safeAmount(data.amount),
          category: safeCategory(data.category),
          merchant: data.merchant || undefined,
        } as Transaction;
      }));

      setBudgetItemsState(budgetItemsSnap.docs.map((d) => {
        const data = d.data() as Record<string, any>;
        return {
          id: d.id,
          categoryId: data.categoryId ?? "",
          name: data.name ?? "",
          budgetedAmount: safeAmount(data.budgetedAmount),
          createdAt: data.createdAt ?? Date.now(),
        } as BudgetItem;
      }));
    } catch (err) {
      const mapped = mapError(err);
      console.error("[FinanceContext] fetchAll error:", err);
      // Only surface to the user if it's not an expected offline scenario
      if (mapped.severity === "error") {
        toast.warning("Couldn't load your financial data. Using cached information.");
      }
    }
    setIsLoaded(true);
  }, [user]);

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
    if (!user) throw new Error("Not signed in. Please sign in again.");
    const data = {
      name: account.name,
      institution: account.institution,
      type: account.type,
      balance: account.balance,
      color: account.color,
      lastUpdated: new Date().toISOString(),
    };
    try {
      const ref = await addDoc(collection(db, "users", user.id, "accounts"), data);
      setAccounts((prev) => [...prev, { ...data, id: ref.id, currency: "CAD" }]);
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  }, [user]);

  const updateAccount = useCallback(async (id: string, updates: Partial<Omit<Account, "id" | "currency">>) => {
    if (!user) throw new Error("Not signed in. Please sign in again.");
    const data: Record<string, any> = {};
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.institution !== undefined) data.institution = updates.institution;
    if (updates.type !== undefined) data.type = updates.type;
    if (updates.balance !== undefined) data.balance = updates.balance;
    if (updates.color !== undefined) data.color = updates.color;
    data.lastUpdated = new Date().toISOString();
    try {
      await updateDoc(doc(db, "users", user.id, "accounts", id), data);
      setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, ...updates, lastUpdated: data.lastUpdated } : a));
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  }, [user]);

  const removeAccount = useCallback(async (id: string) => {
    if (!user) throw new Error("Not signed in. Please sign in again.");
    try {
      await deleteDoc(doc(db, "users", user.id, "accounts", id));
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  }, [user]);

  const addTransaction = useCallback(async (tx: Omit<Transaction, "id">) => {
    if (!user) throw new Error("Not signed in. Please sign in again.");
    const data = {
      accountId: tx.accountId || null,
      date: tx.date,
      description: tx.description,
      amount: safeAmount(tx.amount),
      category: safeCategory(tx.category),
      merchant: tx.merchant || null,
    };
    try {
      const ref = await addDoc(collection(db, "users", user.id, "transactions"), data);
      setTransactions((prev) => [{ ...tx, amount: data.amount, category: data.category, id: ref.id }, ...prev]);
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  }, [user]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Omit<Transaction, "id">>) => {
    if (!user) throw new Error("Not signed in. Please sign in again.");
    const existing = transactions.find((t) => t.id === id);
    if (!existing) return;
    const merged = { ...existing, ...updates };
    try {
      await updateDoc(doc(db, "users", user.id, "transactions", id), {
        description: merged.description,
        amount: safeAmount(merged.amount),
        category: safeCategory(merged.category),
        merchant: merged.merchant || null,
        date: merged.date,
      });
      setTransactions((prev) => prev.map((t) => t.id === id ? { ...merged } : t));
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  }, [user, transactions]);

  const deleteTransaction = useCallback(async (id: string) => {
    if (!user) throw new Error("Not signed in. Please sign in again.");
    try {
      await deleteDoc(doc(db, "users", user.id, "transactions", id));
      setTransactions((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  }, [user]);

  const handleSetBudgets = useCallback(async (newBudgets: Budget[]) => {
    if (!user) throw new Error("Not signed in. Please sign in again.");
    try {
      await updateDoc(doc(db, "users", user.id), {
        budgets: newBudgets.map((b) => ({ category: b.category, limit: safeAmount(b.limit), spent: 0 })),
      });
      setBudgetsState(newBudgets);
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  }, [user]);

  const addBudgetItem = useCallback(async (item: Omit<BudgetItem, "id" | "createdAt">) => {
    if (!user) throw new Error("Not signed in. Please sign in again.");
    const data = { categoryId: item.categoryId, name: item.name, budgetedAmount: safeAmount(item.budgetedAmount), createdAt: Date.now() };
    try {
      const ref = await addDoc(collection(db, "users", user.id, "budgetItems"), data);
      setBudgetItemsState((prev) => [...prev, { ...data, id: ref.id }]);
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  }, [user]);

  const updateBudgetItem = useCallback(async (id: string, updates: Partial<Omit<BudgetItem, "id" | "createdAt">>) => {
    if (!user) throw new Error("Not signed in. Please sign in again.");
    try {
      await updateDoc(doc(db, "users", user.id, "budgetItems", id), updates as Record<string, any>);
      setBudgetItemsState((prev) => prev.map((i) => i.id === id ? { ...i, ...updates } : i));
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  }, [user]);

  const deleteBudgetItem = useCallback(async (id: string) => {
    if (!user) throw new Error("Not signed in. Please sign in again.");
    try {
      await deleteDoc(doc(db, "users", user.id, "budgetItems", id));
      setBudgetItemsState((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  }, [user]);

  const refreshAccounts = useCallback(() => fetchAll(), [fetchAll]);

  const netWorth = useMemo(() => accounts.reduce((s, a) => s + a.balance, 0), [accounts]);
  const totalAssets = useMemo(() => accounts.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0), [accounts]);
  const totalLiabilities = useMemo(() => Math.abs(accounts.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0)), [accounts]);

  const now = new Date();
  const cm = now.getMonth();
  const cy = now.getFullYear();

  const onboardingIncome = user?.monthly_income ?? 0;
  const hasPlaidConnection = accounts.some((a) => !!a.plaidAccountId);

  const monthlyIncome = useMemo(() => {
    if (hasPlaidConnection) {
      const txIncome = transactions
        .filter((t) => { const d = new Date(t.date); return d.getMonth() === cm && d.getFullYear() === cy && t.amount > 0; })
        .reduce((s, t) => s + t.amount, 0);
      return txIncome > 0 ? txIncome : onboardingIncome;
    }
    return onboardingIncome;
  }, [transactions, onboardingIncome, hasPlaidConnection, cm, cy]);

  const monthlyExpenses = useMemo(() =>
    Math.abs(transactions
      .filter((t) => { const d = new Date(t.date); return d.getMonth() === cm && d.getFullYear() === cy && t.amount < 0; })
      .reduce((s, t) => s + t.amount, 0)),
    [transactions, cm, cy]);

  const value = useMemo(() => ({
    accounts,
    transactions,
    budgets: budgetsWithSpent,
    budgetItems,
    monthlyIncome,
    onboardingIncome,
    hasPlaidConnection,
    addAccount,
    updateAccount,
    removeAccount,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    setBudgets: handleSetBudgets,
    addBudgetItem,
    updateBudgetItem,
    deleteBudgetItem,
    refreshAccounts,
    netWorth,
    totalAssets,
    totalLiabilities,
    monthlyExpenses,
    isLoaded,
  }), [accounts, transactions, budgetsWithSpent, budgetItems, monthlyIncome, onboardingIncome, hasPlaidConnection, addAccount, updateAccount, removeAccount, addTransaction, updateTransaction, deleteTransaction, handleSetBudgets, addBudgetItem, updateBudgetItem, deleteBudgetItem, refreshAccounts, netWorth, totalAssets, totalLiabilities, monthlyExpenses, isLoaded]);

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance() {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error("useFinance must be used within FinanceProvider");
  return ctx;
}
