import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  ReactNode,
} from "react";

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
  addAccount: (account: Omit<Account, "id" | "lastUpdated">) => void;
  removeAccount: (id: string) => void;
  addTransaction: (tx: Omit<Transaction, "id">) => void;
  setBudgets: (budgets: Budget[]) => void;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  isLoaded: boolean;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

const DEMO_ACCOUNTS: Account[] = [
  {
    id: "1",
    name: "Everyday Chequing",
    institution: "TD Bank",
    type: "chequing",
    balance: 4821.55,
    currency: "CAD",
    color: "#00D4A0",
    lastUpdated: new Date().toISOString(),
  },
  {
    id: "2",
    name: "Emergency Savings",
    institution: "EQ Bank",
    type: "savings",
    balance: 12350.00,
    currency: "CAD",
    color: "#F5C842",
    lastUpdated: new Date().toISOString(),
  },
  {
    id: "3",
    name: "TFSA",
    institution: "Wealthsimple",
    type: "tfsa",
    balance: 38720.00,
    currency: "CAD",
    color: "#32C86E",
    lastUpdated: new Date().toISOString(),
  },
  {
    id: "4",
    name: "RRSP",
    institution: "Questrade",
    type: "rrsp",
    balance: 51400.00,
    currency: "CAD",
    color: "#6EDDA0",
    lastUpdated: new Date().toISOString(),
  },
  {
    id: "5",
    name: "Visa Infinite",
    institution: "Scotiabank",
    type: "credit",
    balance: -2340.15,
    currency: "CAD",
    color: "#FF5252",
    lastUpdated: new Date().toISOString(),
  },
];

const DEMO_TRANSACTIONS: Transaction[] = [
  { id: "t1", accountId: "1", date: "2026-02-28", description: "Loblaws", amount: -142.38, category: "Groceries", merchant: "Loblaws" },
  { id: "t2", accountId: "1", date: "2026-02-27", description: "Tim Hortons", amount: -8.25, category: "Dining", merchant: "Tim Hortons" },
  { id: "t3", accountId: "1", date: "2026-02-27", description: "TTC Monthly Pass", amount: -156.00, category: "Transport", merchant: "TTC" },
  { id: "t4", accountId: "1", date: "2026-02-26", description: "Netflix CA", amount: -16.99, category: "Entertainment", merchant: "Netflix" },
  { id: "t5", accountId: "1", date: "2026-02-26", description: "Hydro One", amount: -88.44, category: "Utilities", merchant: "Hydro One" },
  { id: "t6", accountId: "1", date: "2026-02-25", description: "Salary Deposit", amount: 3850.00, category: "Income", merchant: "Employer" },
  { id: "t7", accountId: "5", date: "2026-02-24", description: "Canadian Tire", amount: -67.99, category: "Shopping", merchant: "Canadian Tire" },
  { id: "t8", accountId: "5", date: "2026-02-23", description: "Shoppers Drug Mart", amount: -34.12, category: "Health", merchant: "Shoppers" },
  { id: "t9", accountId: "1", date: "2026-02-22", description: "Harvey's", amount: -15.50, category: "Dining", merchant: "Harvey's" },
  { id: "t10", accountId: "1", date: "2026-02-21", description: "Amazon.ca", amount: -45.99, category: "Shopping", merchant: "Amazon" },
  { id: "t11", accountId: "5", date: "2026-02-20", description: "Spotify CA", amount: -10.99, category: "Entertainment", merchant: "Spotify" },
  { id: "t12", accountId: "1", date: "2026-02-19", description: "LCBO", amount: -42.75, category: "Dining", merchant: "LCBO" },
  { id: "t13", accountId: "1", date: "2026-02-18", description: "Cineplex", amount: -28.00, category: "Entertainment", merchant: "Cineplex" },
  { id: "t14", accountId: "1", date: "2026-02-17", description: "Shell Gas", amount: -76.00, category: "Transport", merchant: "Shell" },
  { id: "t15", accountId: "1", date: "2026-02-15", description: "Salary Deposit", amount: 3850.00, category: "Income", merchant: "Employer" },
];

const DEMO_BUDGETS: Budget[] = [
  { category: "Groceries", limit: 600, spent: 372 },
  { category: "Dining", limit: 300, spent: 218 },
  { category: "Transport", limit: 250, spent: 232 },
  { category: "Entertainment", limit: 150, spent: 55 },
  { category: "Shopping", limit: 200, spent: 114 },
  { category: "Utilities", limit: 200, spent: 88 },
  { category: "Health", limit: 100, spent: 34 },
];

const STORAGE_KEY = "thrive_finance_data";

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          setAccounts(data.accounts || DEMO_ACCOUNTS);
          setTransactions(data.transactions || DEMO_TRANSACTIONS);
          setBudgets(data.budgets || DEMO_BUDGETS);
        } else {
          setAccounts(DEMO_ACCOUNTS);
          setTransactions(DEMO_TRANSACTIONS);
          setBudgets(DEMO_BUDGETS);
        }
      } catch {
        setAccounts(DEMO_ACCOUNTS);
        setTransactions(DEMO_TRANSACTIONS);
        setBudgets(DEMO_BUDGETS);
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  const save = async (a: Account[], t: Transaction[], b: Budget[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ accounts: a, transactions: t, budgets: b }));
    } catch {}
  };

  const addAccount = (account: Omit<Account, "id" | "lastUpdated">) => {
    const newAccount: Account = {
      ...account,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 6),
      lastUpdated: new Date().toISOString(),
    };
    const next = [...accounts, newAccount];
    setAccounts(next);
    save(next, transactions, budgets);
  };

  const removeAccount = (id: string) => {
    const next = accounts.filter((a) => a.id !== id);
    setAccounts(next);
    save(next, transactions, budgets);
  };

  const addTransaction = (tx: Omit<Transaction, "id">) => {
    const newTx: Transaction = {
      ...tx,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 6),
    };
    const next = [newTx, ...transactions];
    setTransactions(next);
    save(accounts, next, budgets);
  };

  const handleSetBudgets = (b: Budget[]) => {
    setBudgets(b);
    save(accounts, transactions, b);
  };

  const netWorth = useMemo(
    () => accounts.reduce((sum, a) => sum + a.balance, 0),
    [accounts]
  );
  const totalAssets = useMemo(
    () => accounts.filter((a) => a.balance > 0).reduce((sum, a) => sum + a.balance, 0),
    [accounts]
  );
  const totalLiabilities = useMemo(
    () => Math.abs(accounts.filter((a) => a.balance < 0).reduce((sum, a) => sum + a.balance, 0)),
    [accounts]
  );

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthlyIncome = useMemo(
    () =>
      transactions
        .filter((t) => {
          const d = new Date(t.date);
          return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.amount > 0;
        })
        .reduce((sum, t) => sum + t.amount, 0),
    [transactions, currentMonth, currentYear]
  );

  const monthlyExpenses = useMemo(
    () =>
      Math.abs(
        transactions
          .filter((t) => {
            const d = new Date(t.date);
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.amount < 0;
          })
          .reduce((sum, t) => sum + t.amount, 0)
      ),
    [transactions, currentMonth, currentYear]
  );

  const value = useMemo(
    () => ({
      accounts,
      transactions,
      budgets,
      addAccount,
      removeAccount,
      addTransaction,
      setBudgets: handleSetBudgets,
      netWorth,
      totalAssets,
      totalLiabilities,
      monthlyIncome,
      monthlyExpenses,
      isLoaded,
    }),
    [accounts, transactions, budgets, netWorth, totalAssets, totalLiabilities, monthlyIncome, monthlyExpenses, isLoaded]
  );

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance() {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error("useFinance must be used within FinanceProvider");
  return ctx;
}
