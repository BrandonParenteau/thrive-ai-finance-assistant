import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { getApiUrl } from "@/lib/query-client";

export interface AuthUser {
  id: string;
  email: string;
  monthly_income: number;
  onboarding_complete: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<Pick<AuthUser, "monthly_income" | "onboarding_complete">>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_STORAGE_KEY = "thrive_auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        if (raw) {
          const { token: t, user: u } = JSON.parse(raw);
          if (t && u) {
            setToken(t);
            setUser(u);
          }
        }
      } catch {}
      setIsLoading(false);
    })();
  }, []);

  const persist = async (t: string, u: AuthUser) => {
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: t, user: u }));
  };

  const login = async (email: string, password: string) => {
    const base = getApiUrl();
    const resp = await fetch(`${base}api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Login failed");
    setToken(data.token);
    setUser(data.user);
    await persist(data.token, data.user);
  };

  const register = async (email: string, password: string) => {
    const base = getApiUrl();
    const resp = await fetch(`${base}api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Registration failed");
    setToken(data.token);
    setUser(data.user);
    await persist(data.token, data.user);
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
  };

  const updateProfile = async (updates: Partial<Pick<AuthUser, "monthly_income" | "onboarding_complete">>) => {
    if (!token) throw new Error("Not authenticated");
    const base = getApiUrl();
    const resp = await fetch(`${base}api/auth/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(updates),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed to update profile");
    const updated = { ...user!, ...data };
    setUser(updated);
    if (token) await persist(token, updated);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
