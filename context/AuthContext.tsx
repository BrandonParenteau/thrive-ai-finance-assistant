import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
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
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

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
  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists()) {
    const data = snap.data();
    return {
      monthly_income: data.monthly_income ?? 0,
      onboarding_complete: data.onboarding_complete ?? false,
    };
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
        const idToken = await firebaseUser.getIdToken();
        setToken(idToken);
        const profile = await fetchUserProfile(firebaseUser.uid);
        setUser({
          id: firebaseUser.uid,
          email: firebaseUser.email ?? "",
          monthly_income: profile.monthly_income,
          onboarding_complete: profile.onboarding_complete,
        });
      } else {
        setToken(null);
        setUser(null);
      }
      setIsLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    // onIdTokenChanged listener handles updating user/token state.
  };

  const register = async (email: string, password: string) => {
    const { user: firebaseUser } = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", firebaseUser.uid), {
      email: firebaseUser.email,
      monthly_income: 0,
      onboarding_complete: false,
      created_at: new Date().toISOString(),
    });
    // onIdTokenChanged listener handles updating user/token state.
  };

  const loginWithCredential = async (credential: AuthCredential) => {
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
  };

  const logout = async () => {
    await signOut(auth);
  };

  const updateProfile = async (updates: Partial<Pick<AuthUser, "monthly_income" | "onboarding_complete">>) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error("Not authenticated");
    await updateDoc(doc(db, "users", firebaseUser.uid), updates);
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !firebaseUser.email) throw new Error("Not authenticated");
    const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
    await reauthenticateWithCredential(firebaseUser, credential);
    await updatePassword(firebaseUser, newPassword);
  };

  const deleteAccount = async (password: string) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !firebaseUser.email) throw new Error("Not authenticated");
    const credential = EmailAuthProvider.credential(firebaseUser.email, password);
    await reauthenticateWithCredential(firebaseUser, credential);
    await deleteDoc(doc(db, "users", firebaseUser.uid));
    await deleteUser(firebaseUser);
    // onIdTokenChanged listener clears user/token state.
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
