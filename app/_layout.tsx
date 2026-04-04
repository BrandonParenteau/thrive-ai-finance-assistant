import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

// ─── Splash screen ────────────────────────────────────────────────────────────
// expo-router 6+ calls SplashScreen.preventAutoHideAsync() internally via its
// own entry point before this module evaluates. Calling it again here is a
// duplicate void TurboModule invocation that throws
// ObjCTurboModule::performVoidMethodInvocation under New Architecture.
// We rely on the router's built-in call and only call hideAsync() when ready.

import { GestureHandlerRootView } from "react-native-gesture-handler";
// react-native-keyboard-controller removed: bindings.native.js runs
// new NativeEventEmitter(KeyboardControllerNative) at module-evaluation time,
// which calls getConstants() on the KeyboardController TurboModule before Fabric
// is ready — causing ObjCTurboModule::performVoidMethodInvocation to throw.
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/Toast";
import { OfflineBanner } from "@/components/OfflineBanner";
import { queryClient } from "@/lib/query-client";
import { FinanceProvider } from "@/context/FinanceContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  useFonts,
} from "@expo-google-fonts/dm-sans";
import Constants from "expo-constants";
import Colors from "@/constants/colors";
import { registerPaywallCallback } from "@/hooks/usePro";
import { initializeRevenueCat, setAppUserId } from "@/services/revenueCat";
import { initIAP, setupPurchaseListeners, teardownIAP } from "@/services/iapService";
import PaywallModal from "@/components/PaywallModal";
import MonthlySummaryModal from "@/components/MonthlySummaryModal";
import { registerMonthlySummaryCallback, openMonthlySummary } from "@/utils/monthlySummaryState";

// ─── Global error interceptors ────────────────────────────────────────────────
// Log unhandled promise rejections so they surface in crash logs instead of
// silently dropping.
if (typeof global !== "undefined") {
  const _originalHandler = (global as any).onunhandledrejection;
  (global as any).onunhandledrejection = (event: any) => {
    const reason = event?.reason ?? event;
    console.warn("[Unhandled Promise Rejection]", reason?.message ?? reason);
    _originalHandler?.(event);
  };

  // Intercept the global ErrorUtils handler so any synchronous JS exception
  // (including TurboModule crashes that bubble up as JS errors) is logged with
  // a full stack trace before the process terminates. The original handler is
  // still called so Sentry / Crashlytics integrations keep working.
  const errorUtils = (global as any).ErrorUtils;
  if (errorUtils) {
    const _prev = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler?.((error: Error, isFatal: boolean) => {
      console.error(
        `[GlobalErrorHandler] fatal=${isFatal} module=${(error as any)?.nativeStackIOS?.[0] ?? "unknown"}\n` +
        `message: ${error?.message}\n` +
        `stack: ${error?.stack}`
      );
      _prev?.(error, isFatal);
    });
  }
}

// ─── Root navigation ──────────────────────────────────────────────────────────

function RootLayoutNav({ fontsReady }: { fontsReady: boolean }) {
  const { user, token, isLoading } = useAuth();
  const segments = useSegments();
  const ready = fontsReady && !isLoading;
  const splashHidden = useRef(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [monthlySummaryOpen, setMonthlySummaryOpen] = useState(false);

  // Register notification display behaviour once the module is ready.
  // Must be inside a component (not module-level) to avoid calling the
  // TurboModule before Fabric registers it under New Architecture.
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }, []);

  // Register global paywall callback so usePro().openPaywall() works anywhere.
  useEffect(() => {
    registerPaywallCallback(() => setPaywallOpen(true));
  }, []);

  // Register global monthly summary callback so notification taps can open it.
  useEffect(() => {
    registerMonthlySummaryCallback(() => setMonthlySummaryOpen(true));
  }, []);

  // Navigate to the correct screen when the user taps a notification.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data ?? {};
      // Monthly summary notification → open the in-app summary modal
      if (data.type === "monthly_summary") {
        openMonthlySummary();
        return;
      }
      const screen = data.screen as string | undefined;
      if (screen && typeof screen === "string") {
        router.push(screen as any);
      }
    });
    return () => sub.remove();
  }, []);

  // Initialize IAP + RevenueCat once the user is known.
  // Uses REST API + react-native-iap — no RevenueCat native module.
  // Skip in Expo Go — StoreKit is unavailable there.
  useEffect(() => {
    if (!user?.id || Platform.OS === "web") return;
    if (Constants.appOwnership === "expo") return; // Expo Go
    (async () => {
      try {
        // 1. Store the user ID for all subsequent RevenueCat REST calls.
        initializeRevenueCat();
        setAppUserId(user.id);

        // 2. Open the StoreKit / Play Billing connection.
        const iapReady = await initIAP();
        if (!iapReady) {
          console.warn("[IAP] initConnection failed — purchases unavailable");
          return;
        }

        // 3. Register purchase listeners so receipts are posted to RevenueCat
        //    automatically when any purchase completes or is restored.
        setupPurchaseListeners(
          user.id,
          (isPro) => console.log("[RevenueCat] purchase validated, isPro=", isPro),
          (err) => console.warn("[IAP] purchase error:", err.message),
        );

        console.log("[RevenueCat] ready — REST mode, uid=", user.id);
      } catch (err: any) {
        console.error("[RevenueCat] init failed:", err?.message ?? err);
      }
    })();

    return () => {
      teardownIAP().catch(() => {});
    };
  }, [user?.id]);

  // Hide splash only once — guard with a ref to prevent duplicate calls.
  useEffect(() => {
    if (ready && !splashHidden.current) {
      splashHidden.current = true;
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  // Redirect based on auth state, but only after everything is ready.
  useEffect(() => {
    if (!ready) return;

    const inAuth = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "onboarding";

    if (!token) {
      // Not logged in → login screen
      if (!inAuth) router.replace("/(auth)/login");
    } else if (!user?.onboarding_complete) {
      // Logged in but onboarding not done → onboarding
      if (!inOnboarding) router.replace("/onboarding/income");
    } else {
      // Fully authenticated → main app
      if (inAuth || inOnboarding) router.replace("/(tabs)");
    }
  }, [ready, token, user, segments]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ presentation: "modal", headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ presentation: "modal", headerShown: false }} />
      </Stack>
      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        onSubscribed={() => setPaywallOpen(false)}
      />
      <MonthlySummaryModal
        visible={monthlySummaryOpen}
        onClose={() => setMonthlySummaryOpen(false)}
      />
      {/* Global toast + offline banner float above all screens */}
      <ToastContainer />
      <OfflineBanner />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    "DM_Sans_400Regular": DMSans_400Regular,
    "DM_Sans_500Medium": DMSans_500Medium,
    "DM_Sans_600SemiBold": DMSans_600SemiBold,
    "DM_Sans_700Bold": DMSans_700Bold,
  });

  const fontsReady = fontsLoaded || !!fontError;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <FinanceProvider>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.dark.background }}>
              <RootLayoutNav fontsReady={fontsReady} />
            </GestureHandlerRootView>
          </FinanceProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
