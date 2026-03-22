import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onIdTokenChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
  signInWithCredential,
  AuthCredential,
  User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { mapError, isCancelledByUser } from "@/utils/errorMessages";

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
  loginWithCredential: (credential: AuthCredential) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<Pick<AuthUser, "monthly_income" | "onboarding_complete">>) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchUserProfile(uid: string): Promise<{ monthly_income: number; onboarding_complete: boolean }> {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const data = snap.data();
      return {
        monthly_income: data.monthly_income ?? 0,
        onboarding_complete: data.onboarding_complete ?? false,
      };
    }
  } catch {
    // Firestore unavailable (offline) — return safe defaults so auth still works
  }
  return { monthly_income: 0, onboarding_complete: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // onIdTokenChanged fires on sign-in, sign-out, and automatic token refresh (every hour).
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        try {
          const idToken = await firebaseUser.getIdToken();
          setToken(idToken);
          // Persist token in SecureStore (encrypted at rest)
          if (Platform.OS !== "web") {
            SecureStore.setItemAsync("auth_token", idToken).catch(() => {});
          }
          const profile = await fetchUserProfile(firebaseUser.uid);
          setUser({
            id: firebaseUser.uid,
            email: firebaseUser.email ?? "",
            monthly_income: profile.monthly_income,
            onboarding_complete: profile.onboarding_complete,
          });
        } catch {
          // Token refresh failed (e.g. account deleted on another device) — sign out silently
          setToken(null);
          setUser(null);
        }
      } else {
        setToken(null);
        setUser(null);
        // Clear token from SecureStore on sign-out
        if (Platform.OS !== "web") {
          SecureStore.deleteItemAsync("auth_token").catch(() => {});
        }
      }
      setIsLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onIdTokenChanged listener handles updating user/token state.
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  };

  const register = async (email: string, password: string) => {
    try {
      const { user: firebaseUser } = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", firebaseUser.uid), {
        email: firebaseUser.email,
        monthly_income: 0,
        onboarding_complete: false,
        created_at: new Date().toISOString(),
      });
      // onIdTokenChanged listener handles updating user/token state.
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  };

  const loginWithCredential = async (credential: AuthCredential) => {
    try {
      const { user: firebaseUser } = await signInWithCredential(auth, credential);
      // Create Firestore doc if this is a new social sign-in user
      const snap = await getDoc(doc(db, "users", firebaseUser.uid));
      if (!snap.exists()) {
        await setDoc(doc(db, "users", firebaseUser.uid), {
          email: firebaseUser.email ?? "",
          monthly_income: 0,
          onboarding_complete: false,
          created_at: new Date().toISOString(),
        });
      }
      // onIdTokenChanged listener handles updating user/token state.
    } catch (err) {
      if (isCancelledByUser(err)) return; // User closed the sign-in sheet — no error needed
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  };

  const updateProfile = async (updates: Partial<Pick<AuthUser, "monthly_income" | "onboarding_complete">>) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error("Not signed in. Please sign in again.");
    try {
      await updateDoc(doc(db, "users", firebaseUser.uid), updates);
      setUser((prev) => (prev ? { ...prev, ...updates } : prev));
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !firebaseUser.email) throw new Error("Not signed in. Please sign in again.");
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  };

  const deleteAccount = async (password: string) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !firebaseUser.email) throw new Error("Not signed in. Please sign in again.");
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email, password);
      await reauthenticateWithCredential(firebaseUser, credential);

      // Cascade cleanup — best-effort deletion of subcollections before the user doc
      const uid = firebaseUser.uid;
      const batch = writeBatch(db);
      const subcollections = ["accounts", "transactions", "budgetItems", "aiUsage"];
      for (const col of subcollections) {
        try {
          const snap = await getDocs(collection(db, "users", uid, col));
          snap.docs.forEach((d) => batch.delete(d.ref));
        } catch {
          // Continue even if a subcollection deletion fails
        }
      }
      try { await batch.commit(); } catch { /* best-effort */ }

      await deleteDoc(doc(db, "users", uid));
      await deleteUser(firebaseUser);
      // onIdTokenChanged listener clears user/token state.
    } catch (err) {
      const mapped = mapError(err);
      throw Object.assign(new Error(mapped.message), { title: mapped.title });
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, loginWithCredential, logout, updateProfile, changePassword, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
