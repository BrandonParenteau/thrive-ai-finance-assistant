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
  onboardingIncome: number;
  hasPlaidConnection: boolean;
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

export function FinanceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgetsState] = useState<Budget[]>([]);
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
      const [userSnap, accSnap, txSnap] = await Promise.all([
        getDoc(userRef),
        getDocs(collection(db, "users", user.id, "accounts")),
        getDocs(collection(db, "users", user.id, "transactions")),
      ]);

      if (userSnap.exists()) {
        const data = userSnap.data();
        const firestoreBudgets: Budget[] = (data.budgets ?? []).map((b: any) => ({
          category: b.category,
          limit: b.limit,
          spent: 0,
        }));
        setBudgetsState(firestoreBudgets);
      }

      setAccounts(accSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name,
          institution: data.institution,
          type: data.type,
          balance: data.balance,
          currency: "CAD",
          color: data.color,
          lastUpdated: data.lastUpdated || new Date().toISOString(),
        } as Account;
      }));

      setTransactions(txSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          accountId: data.accountId || "",
          date: typeof data.date === "string" ? data.date.split("T")[0] : new Date(data.date).toISOString().split("T")[0],
          description: data.description,
          amount: data.amount,
          category: data.category,
          merchant: data.merchant || undefined,
        } as Transaction;
      }));
    } catch (err) {
      console.error("Failed to fetch finance data:", err);
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
    if (!user) throw new Error("Not authenticated");
    const data = {
      name: account.name,
      institution: account.institution,
      type: account.type,
      balance: account.balance,
      color: account.color,
      lastUpdated: new Date().toISOString(),
    };
    const ref = await addDoc(collection(db, "users", user.id, "accounts"), data);
    setAccounts((prev) => [...prev, { ...data, id: ref.id, currency: "CAD" }]);
  }, [user]);

  const removeAccount = useCallback(async (id: string) => {
    if (!user) throw new Error("Not authenticated");
    await deleteDoc(doc(db, "users", user.id, "accounts", id));
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }, [user]);

  const addTransaction = useCallback(async (tx: Omit<Transaction, "id">) => {
    if (!user) throw new Error("Not authenticated");
    const data = {
      accountId: tx.accountId || null,
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      category: tx.category,
      merchant: tx.merchant || null,
    };
    const ref = await addDoc(collection(db, "users", user.id, "transactions"), data);
    setTransactions((prev) => [{ ...tx, id: ref.id }, ...prev]);
  }, [user]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Omit<Transaction, "id">>) => {
    if (!user) throw new Error("Not authenticated");
    const existing = transactions.find((t) => t.id === id);
    if (!existing) return;
    const merged = { ...existing, ...updates };
    await updateDoc(doc(db, "users", user.id, "transactions", id), {
      description: merged.description,
      amount: merged.amount,
      category: merged.category,
      merchant: merged.merchant || null,
      date: merged.date,
    });
    setTransactions((prev) => prev.map((t) => t.id === id ? { ...merged } : t));
  }, [user, transactions]);

  const deleteTransaction = useCallback(async (id: string) => {
    if (!user) throw new Error("Not authenticated");
    await deleteDoc(doc(db, "users", user.id, "transactions", id));
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, [user]);

  const handleSetBudgets = useCallback(async (newBudgets: Budget[]) => {
    if (!user) throw new Error("Not authenticated");
    await updateDoc(doc(db, "users", user.id), {
      budgets: newBudgets.map((b) => ({ category: b.category, limit: b.limit, spent: b.spent })),
    });
    setBudgetsState(newBudgets);
  }, [user]);

  const refreshAccounts = useCallback(() => fetchAll(), [fetchAll]);

  const netWorth = useMemo(() => accounts.reduce((s, a) => s + a.balance, 0), [accounts]);
  const totalAssets = useMemo(() => accounts.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0), [accounts]);
  const totalLiabilities = useMemo(() => Math.abs(accounts.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0)), [accounts]);

  const now = new Date();
  const cm = now.getMonth();
  const cy = now.getFullYear();

  const onboardingIncome = user?.monthly_income ?? 0;
  const hasPlaidConnection = accounts.length > 0;

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
    monthlyIncome,
    onboardingIncome,
    hasPlaidConnection,
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
  }), [accounts, transactions, budgetsWithSpent, monthlyIncome, onboardingIncome, hasPlaidConnection, addAccount, removeAccount, addTransaction, updateTransaction, deleteTransaction, handleSetBudgets, refreshAccounts, netWorth, totalAssets, totalLiabilities, monthlyExpenses, isLoaded]);

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance() {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error("useFinance must be used within FinanceProvider");
  return ctx;
}
