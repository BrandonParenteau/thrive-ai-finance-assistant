import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
import Colors from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

// Merged into one component so it can access both fontsReady and auth state.
// This lets us hold the splash screen until both are settled, preventing any
// flash of the wrong screen when the app reopens with a persisted session.
function RootLayoutNav({ fontsReady }: { fontsReady: boolean }) {
  const { user, token, isLoading } = useAuth();
  const segments = useSegments();
  const ready = fontsReady && !isLoading;

  // Hide splash only once fonts AND Firebase auth state are both resolved.
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
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
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ presentation: "modal", headerShown: false }} />
    </Stack>
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
              <KeyboardProvider>
                <RootLayoutNav fontsReady={fontsReady} />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </FinanceProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
