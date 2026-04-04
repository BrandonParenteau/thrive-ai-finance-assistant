import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, getAuth, type Persistence } from "firebase/auth";
// getReactNativePersistence ships in the RN build of @firebase/auth but is
// not exposed via the package's exports map. Metro resolves firebase/auth to
// the RN bundle at runtime, so this import works on-device and in TestFlight.
// The cast silences the TS error that stems from the missing type-only export.
const { getReactNativePersistence } =
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("firebase/auth") as {
    getReactNativePersistence: (storage: unknown) => Persistence;
  };
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirestore } from "firebase/firestore";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// On native, persist auth state with AsyncStorage so users stay logged in
// across app restarts. On web, fall back to getAuth (uses localStorage).
export const auth =
  Platform.OS === "web"
    ? getAuth(app)
    : initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });

export const db = getFirestore(app);
