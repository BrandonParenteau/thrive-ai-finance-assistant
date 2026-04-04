import { useState, useEffect, useCallback, useRef } from "react";
import { Platform, AppState } from "react-native";
import toast from "@/utils/toast";
import { mapError, isCancelledByUser } from "@/utils/errorMessages";
import { getCustomerInfo, getAppUserId } from "@/services/revenueCat";

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
    const userId = getAppUserId();
    if (!userId) { setIsLoading(false); return; }
    try {
      const info = await getCustomerInfo(userId);
      if (mounted.current) {
        setIsPro(info.isPro);
        setIsLoading(false);
      }
    } catch {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refreshStatus();

    // Re-check entitlement when the app comes back to the foreground.
    // Handles: subscription renewed, refund processed, restore completed.
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
    const userId = getAppUserId();
    if (!userId) return false;
    try {
      const { restoreAndValidate } = await import("@/services/iapService");
      const active = await restoreAndValidate(userId);
      if (mounted.current) setIsPro(active);
      if (!active) {
        toast.info(
          "No active subscription found on this Apple ID. If you subscribed on a different account, please sign out of the App Store and try again.",
        );
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
