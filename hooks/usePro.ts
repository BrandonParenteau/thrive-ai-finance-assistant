import { useState, useEffect, useCallback, useRef } from "react";
import { Platform, AppState } from "react-native";
import toast from "@/utils/toast";
import { mapError, isCancelledByUser } from "@/utils/errorMessages";

export interface ProState {
  isPro: boolean;
  isLoading: boolean;
  openPaywall: () => void;
  restore: () => Promise<boolean>;
}

let paywallCallback: (() => void) | null = null;

export function registerPaywallCallback(cb: () => void) {
  paywallCallback = cb;
}

export function usePro(): ProState {
  const [isPro, setIsPro] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const refreshStatus = useCallback(async () => {
    if (Platform.OS === "web") { setIsLoading(false); return; }
    try {
      const Purchases = require("react-native-purchases").default;
      const info = await Purchases.getCustomerInfo();
      if (mounted.current) {
        setIsPro(!!info.entitlements.active["monthly"]);
        setIsLoading(false);
      }
    } catch {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refreshStatus();

    // Listen for RevenueCat updates (purchases, renewals, refunds)
    if (Platform.OS !== "web") {
      try {
        const Purchases = require("react-native-purchases").default;
        Purchases.addCustomerInfoUpdateListener((updated: any) => {
          if (mounted.current) {
            setIsPro(!!updated.entitlements.active["monthly"]);
          }
        });
      } catch { /* Expo Go — ignore */ }
    }

    // Re-check entitlement when the app comes back to the foreground.
    // Handles: subscription expired mid-session, grace period ended, refund processed.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshStatus();
    });

    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, [refreshStatus]);

  const openPaywall = useCallback(() => {
    paywallCallback?.();
  }, []);

  const restore = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") return false;
    try {
      const Purchases = require("react-native-purchases").default;
      const info = await Purchases.restorePurchases();
      const active = !!info.entitlements.active["monthly"];
      if (mounted.current) setIsPro(active);
      if (!active) {
        toast.info("No active subscription found on this Apple ID. If you subscribed on a different account, please sign out of the App Store and try again.");
      }
      return active;
    } catch (err) {
      if (isCancelledByUser(err)) return false;
      const mapped = mapError(err);
      toast.error(mapped.message);
      return false;
    }
  }, []);

  return { isPro, isLoading, openPaywall, restore };
}
